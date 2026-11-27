/**
 * Event emitter with per-listener backpressure.
 *
 * A listener may return a promise. The emitter does not invoke that listener
 * with its next event until the promise settles, so slow consumers naturally
 * apply backpressure instead of accumulating concurrent handler work.
 *
 * Optionally accepts a CursorStore and cursor key so streams can checkpoint
 * their position after acknowledged delivery and resume from the durable store
 * on reconnect — surviving server restarts without gaps or replays.
 */

import type { CursorStore } from "./cursorStore";

export type StreamEventMap = Record<string, unknown>;
export type StreamEventListener<Payload> = (payload: Payload) => void | Promise<void>;
export type StreamEventUnsubscribe = () => void;

/** Options accepted by the StreamEventEmitter constructor. */
export interface StreamEventEmitterOptions {
  /**
   * Durable cursor store. When provided alongside `cursorKey`, the emitter
   * can checkpoint and resume its stream position across process restarts.
   */
  cursorStore?: CursorStore;
  /**
   * Key used to identify this stream's cursor within the store.
   * Required when `cursorStore` is provided; ignored otherwise.
   */
  cursorKey?: string;
}

type ListenerState<Payload> = {
  listener: StreamEventListener<Payload>;
  tail: Promise<void>;
};

export class StreamEventEmitter<Events extends StreamEventMap> {
  private readonly listeners = new Map<keyof Events, Set<ListenerState<Events[keyof Events]>>>();
  private readonly cursorStore?: CursorStore | undefined;
  private readonly cursorKey?: string | undefined;

  /**
   * @param options - Optional cursor store and key for durable stream resumption.
   *
   * @example
   * // Durable emitter — survives restarts
   * const store = new FileCursorStore("/var/data/cursors.json");
   * const emitter = new StreamEventEmitter({ cursorStore: store, cursorKey: "my-stream" });
   *
   * // On startup, resume from the last confirmed position:
   * const startCursor = await emitter.resumeCursor();
   *
   * // After each acknowledged delivery:
   * await emitter.checkpointCursor(event.id);
   *
   * @example
   * // Backward-compatible: no args behaves exactly like before
   * const emitter = new StreamEventEmitter();
   */
  constructor(options?: StreamEventEmitterOptions) {
    this.cursorStore = options?.cursorStore;
    this.cursorKey = options?.cursorKey;
  }

  on<Event extends keyof Events>(
    event: Event,
    listener: StreamEventListener<Events[Event]>,
  ): StreamEventUnsubscribe {
    const state: ListenerState<Events[Event]> = { listener, tail: Promise.resolve() };
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(state as ListenerState<Events[keyof Events]>);
    return () => {
      listeners?.delete(state as ListenerState<Events[keyof Events]>);
    };
  }

  off<Event extends keyof Events>(event: Event, listener: StreamEventListener<Events[Event]>): void {
    for (const state of this.listeners.get(event) ?? []) {
      if (state.listener === listener) this.listeners.get(event)?.delete(state);
    }
  }

  /** Queue an event and resolve when all current listeners have consumed it. */
  async emit<Event extends keyof Events>(event: Event, payload: Events[Event]): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const state of [...(this.listeners.get(event) ?? [])]) {
      const next = state.tail.then(async () => {
        await state.listener(payload as Events[keyof Events]);
      });
      state.tail = next.catch(() => undefined);
      pending.push(next);
    }
    await Promise.allSettled(pending);
  }

  removeAllListeners(event?: keyof Events): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }

  listenerCount(event?: keyof Events): number {
    return event === undefined
      ? [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
      : this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Checkpoint the stream cursor after acknowledged event delivery.
   *
   * Call this after a listener has successfully processed an event to durably
   * record the current position. On the next startup, `resumeCursor()` returns
   * this value so the stream can skip already-processed events.
   *
   * No-op when no cursor store was provided at construction.
   *
   * @param cursor - The cursor value to persist (e.g. event ID or ledger sequence).
   */
  async checkpointCursor(cursor: string): Promise<void> {
    if (!this.cursorStore || !this.cursorKey) return;
    const fn = this.cursorStore.checkpoint ?? this.cursorStore.save;
    await fn.call(this.cursorStore, this.cursorKey, cursor);
  }

  /**
   * Resume from the last checkpointed cursor position.
   *
   * Returns the cursor value saved by the most recent `checkpointCursor` call,
   * or `undefined` when no checkpoint exists (first run, or store was cleared).
   *
   * Pass the returned value to your stream source as the starting cursor so
   * the stream picks up where it left off after a restart.
   *
   * No-op (returns `undefined`) when no cursor store was provided.
   */
  async resumeCursor(): Promise<string | undefined> {
    if (!this.cursorStore || !this.cursorKey) return undefined;
    return this.cursorStore.load(this.cursorKey);
  }
}
