/**
 * mockStream — controllable mock stream test helpers.
 *
 * Provides a controllable stream source for testing stream consumers,
 * reconnect behaviors, cursor persistence, deduplication, and resource cleanup.
 *
 * Pure utility module without hardcoded test runner dependencies.
 */

import type { EventDeduplicationStore } from "../streaming/cursorStore";

export interface MockStreamRecord<T = unknown> {
  id: string;
  cursor: string;
  data: T;
  timestamp?: number;
}

export interface ControllableStreamOptions<T = unknown> {
  /** Initial items queued in the stream buffer */
  initialItems?: Array<{ id?: string; cursor?: string; data: T }>;
  /** Callback fired when a consumer connects or resumes */
  onConnect?: (cursor?: string) => void;
  /** Callback fired when a consumer disconnects */
  onDisconnect?: (reason?: unknown) => void;
  /** Callback fired when resources are cleaned up */
  onCleanup?: () => void;
}

export interface StreamConsumerOptions {
  /** Resume from this cursor position (skipping items up to and including this cursor) */
  cursor?: string;
  /** Signal to abort consumption and trigger cleanup */
  signal?: AbortSignal;
  /** Optional deduplication store to flag/filter replayed items */
  deduplicationStore?: EventDeduplicationStore;
}

export interface StreamConsumerMessage<T = unknown> {
  record: MockStreamRecord<T>;
  cursor: string;
  isDuplicate: boolean;
}

interface PendingWaiter<T> {
  resolve: (value: IteratorResult<StreamConsumerMessage<T>>) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Controllable mock stream for exercising stream consumers under network
 * instability, disconnects, reconnects with cursors, and cleanup teardowns.
 */
export class ControllableStream<T = unknown> {
  private readonly items: MockStreamRecord<T>[] = [];
  private readonly listeners = new Set<PendingWaiter<T>>();
  private _activeConsumers = 0;
  private _disconnected = false;
  private _closed = false;
  private _disconnectError: Error | null = null;
  private counter = 0;

  constructor(private readonly options?: ControllableStreamOptions<T>) {
    if (options?.initialItems) {
      for (const item of options.initialItems) {
        this.emit(item.data, item.cursor, item.id);
      }
    }
  }

  /** Current number of active consumer generators. */
  get activeConsumers(): number {
    return this._activeConsumers;
  }

  /** Total number of items emitted so far. */
  get emittedCount(): number {
    return this.items.length;
  }

  /** Whether the stream is currently in a disconnected state. */
  get isDisconnected(): boolean {
    return this._disconnected;
  }

  /** Whether the stream has been permanently closed. */
  get isClosed(): boolean {
    return this._closed;
  }

  /** The cursor of the most recently emitted record, or undefined if empty. */
  get currentCursor(): string | undefined {
    return this.items[this.items.length - 1]?.cursor;
  }

  /**
   * Emit a new data item to the stream.
   * If cursor is omitted, an auto-incrementing cursor is generated.
   */
  emit(data: T, cursor?: string, id?: string): MockStreamRecord<T> {
    if (this._closed) {
      throw new Error("Cannot emit to a closed ControllableStream");
    }

    this.counter++;
    const recordCursor = cursor ?? `cursor_${this.counter}`;
    const recordId = id ?? `rec_${this.counter}`;
    const record: MockStreamRecord<T> = {
      id: recordId,
      cursor: recordCursor,
      data,
      timestamp: Date.now(),
    };

    this.items.push(record);

    // If there are waiting consumers, dispatch to the first waiter
    if (this.listeners.size > 0 && !this._disconnected) {
      const waiter = this.listeners.values().next().value;
      if (waiter) {
        this.listeners.delete(waiter);
        waiter.resolve({
          done: false,
          value: {
            record,
            cursor: recordCursor,
            isDuplicate: false,
          },
        });
      }
    }

    return record;
  }

  /**
   * Emit a batch of data items sequentially.
   */
  emitBatch(items: Array<{ data: T; cursor?: string; id?: string }>): MockStreamRecord<T>[] {
    return items.map((item) => this.emit(item.data, item.cursor, item.id));
  }

  /**
   * Simulate a stream disconnect or transport failure.
   * Active consumers waiting for new events will reject with the disconnect error.
   */
  disconnect(error?: Error): void {
    if (this._disconnected || this._closed) return;
    this._disconnected = true;
    this._disconnectError = error ?? new Error("Stream connection dropped");

    this.options?.onDisconnect?.(this._disconnectError);

    // Reject all waiting consumers
    for (const waiter of this.listeners) {
      waiter.reject(this._disconnectError);
    }
    this.listeners.clear();
  }

  /**
   * Simulate a stream reconnection.
   * Clears the disconnect error and allows new or resuming consumers to pull events.
   */
  reconnect(): void {
    if (this._closed) {
      throw new Error("Cannot reconnect a closed ControllableStream");
    }
    this._disconnected = false;
    this._disconnectError = null;
  }

  /**
   * Permanently close the stream and notify all listeners.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._disconnected = false;

    for (const waiter of this.listeners) {
      waiter.resolve({ done: true, value: undefined as any });
    }
    this.listeners.clear();
    this.options?.onCleanup?.();
  }

  /**
   * Consume the stream as an async generator.
   *
   * @param options.cursor Optional starting cursor to resume from (skips items at or before this cursor).
   * @param options.signal Optional AbortSignal to cleanly cancel consumption.
   * @param options.deduplicationStore Optional store to detect and handle replayed items.
   */
  async *consume(
    options?: StreamConsumerOptions,
  ): AsyncGenerator<StreamConsumerMessage<T>> {
    if (this._closed) return;

    this._activeConsumers++;
    this.options?.onConnect?.(options?.cursor);

    let lastCursor = options?.cursor;
    // Find index of starting cursor in existing items
    let itemIndex = 0;
    if (lastCursor !== undefined) {
      const existingIdx = this.items.findIndex((item) => item.cursor === lastCursor);
      if (existingIdx !== -1) {
        itemIndex = existingIdx + 1; // start after the matched cursor
      }
    }

    const abortHandler = (): void => {
      // Aborting triggers cleanup
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      while (!this._closed && !options?.signal?.aborted) {
        if (this._disconnected) {
          throw this._disconnectError ?? new Error("Stream disconnected");
        }

        // Deliver any available buffered items first
        if (itemIndex < this.items.length) {
          const item = this.items[itemIndex]!;
          itemIndex++;

          let isDuplicate = false;
          if (options?.deduplicationStore) {
            isDuplicate = await options.deduplicationStore.has(item.id);
            if (!isDuplicate) {
              await options.deduplicationStore.add(item.id);
            }
          }

          lastCursor = item.cursor;
          yield {
            record: item,
            cursor: item.cursor,
            isDuplicate,
          };
          continue;
        }

        // No buffered items available; wait for next item or disconnect
        const message = await new Promise<IteratorResult<StreamConsumerMessage<T>>>(
          (resolve, reject) => {
            const waiter: PendingWaiter<T> = { resolve, reject };
            this.listeners.add(waiter);

            if (options?.signal) {
              const onAbort = () => {
                this.listeners.delete(waiter);
                resolve({ done: true, value: undefined as any });
              };
              options.signal.addEventListener("abort", onAbort, { once: true });
            }
          },
        );

        if (message.done) break;

        itemIndex = this.items.length;
        let isDuplicate = false;
        if (options?.deduplicationStore) {
          isDuplicate = await options.deduplicationStore.has(message.value.record.id);
          if (!isDuplicate) {
            await options.deduplicationStore.add(message.value.record.id);
          }
        }

        lastCursor = message.value.cursor;
        yield {
          record: message.value.record,
          cursor: message.value.cursor,
          isDuplicate,
        };
      }
    } finally {
      this._activeConsumers--;
      if (options?.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
      this.options?.onCleanup?.();
    }
  }
}

/**
 * Factory for creating a ControllableStream instance.
 */
export function createControllableStream<T = unknown>(
  options?: ControllableStreamOptions<T>,
): ControllableStream<T> {
  return new ControllableStream<T>(options);
}

/**
 * Controllable mock fetch for Horizon transaction streaming and SSE endpoints.
 */
export interface MockHorizonStreamFetchOptions {
  pages: Array<Array<{ hash: string; paging_token: string; [key: string]: unknown }>>;
  disconnectAfterCalls?: number;
  disconnectError?: Error;
}

export function createMockHorizonStreamFetch(
  options: MockHorizonStreamFetchOptions,
): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  disconnect: (error?: Error) => void;
  reconnect: () => void;
  getCallCount: () => number;
  getLastRequestedCursor: () => string | null;
} {
  let callCount = 0;
  let lastRequestedCursor: string | null = null;
  let isDisconnected = false;
  let disconnectError = options.disconnectError ?? new Error("Horizon connection dropped");
  let currentPageIndex = 0;

  const fetchFn = async (url: string, _init?: RequestInit): Promise<Response> => {
    callCount++;
    const parsedUrl = new URL(url);
    lastRequestedCursor = parsedUrl.searchParams.get("cursor");

    if (
      isDisconnected ||
      (options.disconnectAfterCalls !== undefined &&
        callCount > options.disconnectAfterCalls)
    ) {
      throw disconnectError;
    }

    // Determine records to return based on cursor
    let recordsToReturn: Array<{ hash: string; paging_token: string; [key: string]: unknown }> = [];
    if (currentPageIndex < options.pages.length) {
      recordsToReturn = options.pages[currentPageIndex] ?? [];
      currentPageIndex++;
    }

    const payload = {
      _embedded: {
        records: recordsToReturn.map((rec) => ({
          ...rec,
          successful: rec.successful ?? true,
          ledger_attr: rec.ledger_attr ?? 100,
          created_at: rec.created_at ?? new Date().toISOString(),
          fee_charged: rec.fee_charged ?? "100",
          envelope_xdr: rec.envelope_xdr ?? "AAAA...",
          result_xdr: rec.result_xdr ?? "AAAA...",
        })),
      },
    };

    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  };

  return {
    fetch: fetchFn,
    disconnect: (err?: Error) => {
      isDisconnected = true;
      if (err) disconnectError = err;
    },
    reconnect: () => {
      isDisconnected = false;
    },
    getCallCount: () => callCount,
    getLastRequestedCursor: () => lastRequestedCursor,
  };
}
