/**
 * Time-windowed request batching, complementary to requestDedup.ts.
 *
 * requestDedup.ts coalesces truly concurrent, identical in-flight calls
 * (two callers asking for the same key *while the first request is still
 * pending* share one promise). createRequestBatcher generalizes this to
 * calls that arrive over a short time window rather than strictly
 * concurrently: every request() call for a distinct key made within
 * `windowMs` of the first is collected and handed to a single caller-supplied
 * `batchFetcher` in one call, once, instead of each key triggering its own
 * fetch. Identical keys within a window are deduped to one entry (matching
 * the "identical requests over a short window" case), same as
 * requestDedup.ts's concurrent case, just widened to a window instead of
 * strict overlap.
 *
 * The batcher has no knowledge of Horizon, Soroban RPC, or any specific
 * transport — `batchFetcher` decides how (or whether) N distinct keys become
 * fewer network round trips. For genuinely identical keys (the common case:
 * many callers requesting the same account/resource within a few
 * milliseconds of each other) that's always exactly one underlying call
 * regardless of what batchFetcher does, since the batch only ever contains
 * one entry per distinct key.
 *
 * ## Adaptive windowing
 *
 * When `adaptiveWindow: true` is set, the batcher automatically adjusts its
 * collection window based on observed inter-arrival times of `request()` calls:
 *
 * - Under HIGH load (avg inter-arrival < `minWindowMs * 2`): the window widens
 *   toward `maxWindowMs` to coalesce more keys per round trip.
 * - Under LOW load (avg inter-arrival > `targetLatencyMs / 2`): the window
 *   shrinks toward `minWindowMs` to bound tail latency.
 * - The window never exceeds `targetLatencyMs`, which acts as a hard latency cap.
 *
 * The `onFlush` callback (if provided) fires after each batch with the batch
 * size and the fill time (ms from first enqueue to flush). Use it to feed
 * external telemetry without introducing a circular dependency on
 * `src/performance/telemetry.ts`.
 */

export interface RequestBatcherConfig {
  enabled?: boolean;
  /** Time window in ms to collect requests before firing the batch. Default: 10. */
  windowMs?: number;
  /** Maximum distinct keys per batch; reaching it fires immediately without waiting for windowMs. Default: 20. */
  maxBatch?: number;
  /**
   * Enable adaptive windowing. When true, the window shrinks and grows
   * between `minWindowMs` and `maxWindowMs` based on observed inter-arrival
   * rate. Default: false.
   */
  adaptiveWindow?: boolean;
  /** Minimum window size (ms) in adaptive mode. Default: 5. */
  minWindowMs?: number;
  /** Maximum window size (ms) in adaptive mode. Default: 50. */
  maxWindowMs?: number;
  /**
   * Hard latency cap (ms). The adaptive window never exceeds this value.
   * Default: 100.
   */
  targetLatencyMs?: number;
  /**
   * Number of recent inter-arrival samples used to estimate request rate.
   * Default: 8.
   */
  rateWindowSamples?: number;
  /**
   * Optional callback fired after each batch flush. Receives the number of
   * distinct keys and the fill time (ms from the first enqueue in the batch
   * to the flush). Use this to integrate with telemetry without creating a
   * circular import on `src/performance/telemetry.ts`.
   */
  onFlush?: (stats: { batchSize: number; fillTimeMs: number }) => void;
}

export interface RequestBatcherStats {
  /** Total request() calls made, including ones that shared a batch/window with another. */
  totalRequests: number;
  /** Total batchFetcher invocations — i.e. actual underlying calls made. */
  totalBatches: number;
  /** requestCount of the most recently completed batch. */
  lastBatchSize: number;
  /** Running average of keys per batch across all completed batches. */
  avgBatchSize: number;
  /** Running average of fill time (ms) across all completed batches. */
  avgBatchFillMs: number;
}

export type BatchFetcher<K, V> = (keys: readonly K[]) => Promise<Map<K, V> | ReadonlyMap<K, V>>;

interface PendingEntry<V> {
  resolve: (value: V) => void;
  reject: (reason: unknown) => void;
}

export interface RequestBatcher<K, V> {
  /** Enqueues `key`; resolves once the batch containing it has been fetched and split. */
  request(key: K): Promise<V>;
  /** Cumulative stats since the batcher was created. */
  getStats(): RequestBatcherStats;
}

/**
 * Creates a batcher for one logical resource type (e.g. "get account").
 * Each distinct `keyFn(key)` result gets exactly one batchFetcher entry per
 * window; every caller requesting that same key within the window receives
 * the same resolved value (or the same rejection).
 *
 * When `config.adaptiveWindow` is true the collection window adjusts
 * automatically between `minWindowMs` and `min(maxWindowMs, targetLatencyMs)`
 * based on observed inter-arrival times so high-throughput servers coalesce
 * more reads while low-throughput servers keep tail latency bounded.
 */
export function createRequestBatcher<K, V>(
  batchFetcher: BatchFetcher<K, V>,
  config?: RequestBatcherConfig,
  keyFn: (key: K) => string = (key) => JSON.stringify(key),
): RequestBatcher<K, V> {
  const enabled = config?.enabled ?? true;
  const baseWindowMs = config?.windowMs ?? 10;
  const maxBatch = config?.maxBatch ?? 20;
  const adaptiveWindow = config?.adaptiveWindow ?? false;
  const minWindowMs = config?.minWindowMs ?? 5;
  const targetLatencyMs = config?.targetLatencyMs ?? 100;
  const maxWindowMs = Math.min(config?.maxWindowMs ?? 50, targetLatencyMs);
  const rateWindowSamples = config?.rateWindowSamples ?? 8;
  const onFlush = config?.onFlush;

  // Adaptive rate tracking
  const arrivalTimes: number[] = [];
  let currentWindowMs = baseWindowMs;

  function recordArrival(now: number): void {
    if (!adaptiveWindow) return;
    arrivalTimes.push(now);
    if (arrivalTimes.length > rateWindowSamples + 1) {
      arrivalTimes.shift();
    }
  }

  function updateWindow(): void {
    if (!adaptiveWindow || arrivalTimes.length < 2) return;
    // Compute average inter-arrival time from the recorded samples.
    let totalGap = 0;
    for (let i = 1; i < arrivalTimes.length; i++) {
      totalGap += (arrivalTimes[i] as number) - (arrivalTimes[i - 1] as number);
    }
    const avgInterArrivalMs = totalGap / (arrivalTimes.length - 1);

    if (avgInterArrivalMs < minWindowMs * 2) {
      // High load: widen toward maxWindowMs.
      currentWindowMs = Math.min(currentWindowMs + 2, maxWindowMs);
    } else if (avgInterArrivalMs > targetLatencyMs / 2) {
      // Low load: shrink toward minWindowMs.
      currentWindowMs = Math.max(currentWindowMs - 2, minWindowMs);
    }
    // Clamp to the latency cap.
    currentWindowMs = Math.min(currentWindowMs, targetLatencyMs);
  }

  const stats: RequestBatcherStats = {
    totalRequests: 0,
    totalBatches: 0,
    lastBatchSize: 0,
    avgBatchSize: 0,
    avgBatchFillMs: 0,
  };

  let pendingKeys: Map<string, K> | null = null;
  let pendingEntries: Map<string, PendingEntry<V>[]> | null = null;
  let batchStartTime: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const keysMap = pendingKeys;
    const entriesMap = pendingEntries;
    const startedAt = batchStartTime;
    pendingKeys = null;
    pendingEntries = null;
    batchStartTime = null;
    if (!keysMap || !entriesMap || keysMap.size === 0) return;

    const keys = Array.from(keysMap.values());
    const batchSize = keys.length;
    const fillTimeMs = startedAt !== null ? Date.now() - startedAt : 0;

    stats.totalBatches += 1;
    stats.lastBatchSize = batchSize;
    // Update running averages.
    const n = stats.totalBatches;
    stats.avgBatchSize = stats.avgBatchSize + (batchSize - stats.avgBatchSize) / n;
    stats.avgBatchFillMs = stats.avgBatchFillMs + (fillTimeMs - stats.avgBatchFillMs) / n;

    onFlush?.({ batchSize, fillTimeMs });

    // Update adaptive window for the next batch using samples recorded so far.
    updateWindow();

    batchFetcher(keys)
      .then((results) => {
        for (const [keyId, key] of keysMap) {
          const waiters = entriesMap.get(keyId) ?? [];
          if (results.has(key)) {
            const value = results.get(key) as V;
            for (const waiter of waiters) waiter.resolve(value);
          } else {
            const error = new Error(`requestBatching: batchFetcher did not return a result for key ${keyId}`);
            for (const waiter of waiters) waiter.reject(error);
          }
        }
      })
      .catch((error: unknown) => {
        for (const waiters of entriesMap.values()) {
          for (const waiter of waiters) waiter.reject(error);
        }
      });
  }

  function request(key: K): Promise<V> {
    stats.totalRequests += 1;

    if (!enabled) {
      return batchFetcher([key]).then((results) => {
        if (!results.has(key)) {
          throw new Error("requestBatching: batchFetcher did not return a result for the requested key");
        }
        return results.get(key) as V;
      });
    }

    const now = Date.now();
    recordArrival(now);

    const keyId = keyFn(key);

    return new Promise<V>((resolve, reject) => {
      if (!pendingKeys) {
        pendingKeys = new Map();
        pendingEntries = new Map();
        batchStartTime = now;
      }
      pendingKeys.set(keyId, key);
      const existingWaiters = pendingEntries!.get(keyId);
      if (existingWaiters) {
        existingWaiters.push({ resolve, reject });
      } else {
        pendingEntries!.set(keyId, [{ resolve, reject }]);
      }

      if (pendingKeys.size >= maxBatch) {
        flush();
        return;
      }

      if (timer === null) {
        const windowToUse = adaptiveWindow ? currentWindowMs : baseWindowMs;
        timer = setTimeout(flush, windowToUse);
      }
    });
  }

  return { request, getStats: () => ({ ...stats }) };
}
