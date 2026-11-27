/**
 * Opt-in coalescing of concurrent reads within one client instance.
 *
 * Implements cancellation-safe deduplication under concurrency races (#76),
 * ensuring that independent caller cancellation signals (e.g. timeouts or unmounts)
 * do not cancel or corrupt in-flight requests still awaited by other callers.
 */

export interface DedupConfig {
  enabled?: boolean;
}

export interface RequestDeduplicator {
  deduplicate<T>(
    keyParts: unknown[],
    fetcher: (signal?: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal,
  ): Promise<T>;
  getInFlightCount(): number;
  clear(): void;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}

interface Subscriber<T> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface InFlightEntry<T> {
  sharedPromise: Promise<T>;
  controller: AbortController;
  subscribers: Set<Subscriber<T>>;
}

export function createRequestDeduplicator(config?: DedupConfig): RequestDeduplicator {
  const inFlight = new Map<string, InFlightEntry<any>>();

  function deduplicate<T>(
    keyParts: unknown[],
    fetcher: (signal?: AbortSignal) => Promise<T>,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    if (!config?.enabled) {
      return fetcher(callerSignal);
    }

    if (callerSignal?.aborted) {
      const reason =
        callerSignal.reason ??
        (typeof DOMException !== "undefined"
          ? new DOMException("The operation was aborted.", "AbortError")
          : new Error("Aborted"));
      return Promise.reject(reason);
    }

    const key = JSON.stringify(stableValue(keyParts));
    let entry = inFlight.get(key) as InFlightEntry<T> | undefined;

    if (!entry) {
      const controller = new AbortController();
      const subscribers = new Set<Subscriber<T>>();

      const sharedPromise = Promise.resolve()
        .then(() => fetcher(controller.signal))
        .finally(() => {
          inFlight.delete(key);
        });

      entry = {
        sharedPromise,
        controller,
        subscribers,
      };

      inFlight.set(key, entry);

      sharedPromise.then(
        (val) => {
          for (const sub of subscribers) {
            if (sub.signal && sub.onAbort) {
              sub.signal.removeEventListener("abort", sub.onAbort);
            }
            sub.resolve(val);
          }
          subscribers.clear();
        },
        (err) => {
          for (const sub of subscribers) {
            if (sub.signal && sub.onAbort) {
              sub.signal.removeEventListener("abort", sub.onAbort);
            }
            sub.reject(err);
          }
          subscribers.clear();
        },
      );
    }

    return new Promise<T>((resolve, reject) => {
      const currentEntry = entry!;
      const subscriber: Subscriber<T> = {
        resolve,
        reject,
        signal: callerSignal,
      };

      if (callerSignal) {
        subscriber.onAbort = () => {
          if (callerSignal.removeEventListener && subscriber.onAbort) {
            callerSignal.removeEventListener("abort", subscriber.onAbort);
          }
          currentEntry.subscribers.delete(subscriber);

          const reason =
            callerSignal.reason ??
            (typeof DOMException !== "undefined"
              ? new DOMException("The operation was aborted.", "AbortError")
              : new Error("Aborted"));
          reject(reason);

          // If all concurrent callers cancelled, abort shared network operation & cleanup
          if (currentEntry.subscribers.size === 0) {
            currentEntry.controller.abort();
            inFlight.delete(key);
          }
        };

        callerSignal.addEventListener("abort", subscriber.onAbort, { once: true });
      }

      currentEntry.subscribers.add(subscriber);
    });
  }

  function getInFlightCount(): number {
    return inFlight.size;
  }

  function clear(): void {
    for (const [, entry] of inFlight) {
      entry.controller.abort();
    }
    inFlight.clear();
  }

  return { deduplicate, getInFlightCount, clear };
}
