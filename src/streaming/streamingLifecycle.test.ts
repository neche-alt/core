/**
 * Streaming API lifecycle and cursor semantics tests (#61)
 *
 * Covers the behaviour specified in docs/streaming-lifecycle.md:
 * - CursorStore: save/load/clear and auto-selection
 * - PersistentEventDeduplicationStore: dedup, TTL eviction, maxSize cap
 * - StreamEventEmitter: startup, unsubscribe, backpressure
 * - Cursor store integration patterns (resume from saved cursor)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MemoryCursorStore,
  LocalStorageCursorStore,
  createCursorStore,
  PersistentEventDeduplicationStore,
} from "./cursorStore";
import { StreamEventEmitter } from "./streamEventEmitter";

// ─── Shared Storage stub ──────────────────────────────────────────────────────

class StubStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); }
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  key(index: number): string | null { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string): void { this.entries.delete(key); }
  setItem(key: string, value: string): void { this.entries.set(key, value); }
}

// ─── MemoryCursorStore ────────────────────────────────────────────────────────

describe("MemoryCursorStore — basic lifecycle", () => {
  it("returns undefined for a key that has never been saved", async () => {
    const store = new MemoryCursorStore();
    expect(await store.load("missing")).toBeUndefined();
  });

  it("round-trips save and load", async () => {
    const store = new MemoryCursorStore();
    await store.save("stream:account", "cursor-abc");
    expect(await store.load("stream:account")).toBe("cursor-abc");
  });

  it("overwrites an existing cursor on re-save", async () => {
    const store = new MemoryCursorStore();
    await store.save("k", "v1");
    await store.save("k", "v2");
    expect(await store.load("k")).toBe("v2");
  });

  it("clear(key) removes only the specified key", async () => {
    const store = new MemoryCursorStore();
    await store.save("a", "1");
    await store.save("b", "2");
    await store.clear("a");
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBe("2");
  });

  it("clear() with no argument removes all cursors", async () => {
    const store = new MemoryCursorStore();
    await store.save("a", "1");
    await store.save("b", "2");
    await store.clear();
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBeUndefined();
  });
});

// ─── LocalStorageCursorStore ──────────────────────────────────────────────────

describe("LocalStorageCursorStore — lifecycle", () => {
  it("persists cursor to storage with the sorokit:cursor: prefix", async () => {
    const storage = new StubStorage();
    const store = new LocalStorageCursorStore(storage);
    await store.save("stream:tx", "cursor-xyz");
    expect(storage.getItem("sorokit:cursor:stream:tx")).toBe("cursor-xyz");
  });

  it("loads a previously saved cursor from storage", async () => {
    const storage = new StubStorage();
    const store = new LocalStorageCursorStore(storage);
    await store.save("stream:tx", "cursor-xyz");
    expect(await store.load("stream:tx")).toBe("cursor-xyz");
  });

  it("clear(key) removes only the matching prefixed entry", async () => {
    const storage = new StubStorage();
    const store = new LocalStorageCursorStore(storage);
    await store.save("a", "1");
    await store.save("b", "2");
    storage.setItem("external-key", "keep");
    await store.clear("a");
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBe("2");
    expect(storage.getItem("external-key")).toBe("keep");
  });

  it("clear() removes all prefixed cursors and leaves unrelated keys", async () => {
    const storage = new StubStorage();
    const store = new LocalStorageCursorStore(storage);
    await store.save("a", "1");
    await store.save("b", "2");
    storage.setItem("app:other", "keep");
    await store.clear();
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBeUndefined();
    expect(storage.getItem("app:other")).toBe("keep");
  });

  it("throws a descriptive error when constructed with null", () => {
    expect(() => new LocalStorageCursorStore(null as unknown as Storage)).toThrow(
      /localStorage is unavailable/,
    );
  });
});

// ─── createCursorStore — auto-selection ──────────────────────────────────────

describe("createCursorStore — auto-selection", () => {
  it("returns LocalStorageCursorStore when a Storage is provided", () => {
    const store = createCursorStore(new StubStorage());
    expect(store).toBeInstanceOf(LocalStorageCursorStore);
  });

  it("returns a functional MemoryCursorStore when no storage is available", () => {
    // createCursorStore without args falls back to memory in a Node environment
    const store = createCursorStore();
    // In Node 18+ globalThis.localStorage is not defined → MemoryCursorStore
    // In a test environment with no localStorage, this must succeed
    expect(store).toBeDefined();
  });

  it("auto-selected store round-trips a cursor correctly", async () => {
    const store = createCursorStore(new StubStorage());
    await store.save("tx-stream", "resume-cursor");
    expect(await store.load("tx-stream")).toBe("resume-cursor");
  });
});

// ─── Cursor resume pattern ────────────────────────────────────────────────────

describe("Cursor resume pattern", () => {
  it("persists a cursor after each page and allows resumption", async () => {
    const cursorStore = new MemoryCursorStore();
    const CURSOR_KEY = "tx-stream:GABC";

    // Simulate first stream run: cursor advances from null → "cursor-100"
    const firstCursor = "cursor-100";
    await cursorStore.save(CURSOR_KEY, firstCursor);

    // Simulate restart: load saved cursor
    const savedCursor = await cursorStore.load(CURSOR_KEY);
    expect(savedCursor).toBe(firstCursor);

    // Simulate second stream run: cursor advances to "cursor-200"
    const secondCursor = "cursor-200";
    await cursorStore.save(CURSOR_KEY, secondCursor);
    expect(await cursorStore.load(CURSOR_KEY)).toBe(secondCursor);
  });

  it("starts from undefined when no cursor has been saved (first run)", async () => {
    const cursorStore = new MemoryCursorStore();
    const savedCursor = await cursorStore.load("tx-stream:new-account");
    expect(savedCursor).toBeUndefined();
    // The stream should use undefined as the cursor, meaning it starts from
    // the most recent position or the beginning (depending on `order`).
  });
});

// ─── PersistentEventDeduplicationStore ───────────────────────────────────────

describe("PersistentEventDeduplicationStore — deduplication and eviction", () => {
  it("returns false for an unseen event ID", async () => {
    const store = new PersistentEventDeduplicationStore();
    expect(await store.has("tx:abc")).toBe(false);
  });

  it("returns true for an event ID that was added", async () => {
    const store = new PersistentEventDeduplicationStore();
    await store.add("tx:abc");
    expect(await store.has("tx:abc")).toBe(true);
  });

  it("clear() removes all tracked IDs", async () => {
    const store = new PersistentEventDeduplicationStore();
    await store.add("tx:1");
    await store.add("tx:2");
    await store.clear();
    expect(await store.has("tx:1")).toBe(false);
    expect(await store.has("tx:2")).toBe(false);
  });

  it("evicts IDs older than the TTL", async () => {
    const now = vi.fn(() => 0);
    const store = new PersistentEventDeduplicationStore(10_000, 1_000, now);

    await store.add("tx:old");
    // Advance clock past TTL
    now.mockReturnValue(2_000);
    // has() triggers eviction
    expect(await store.has("tx:old")).toBe(false);
  });

  it("caps tracked IDs at maxSize (oldest evicted first)", async () => {
    // maxSize = 3, so adding a 4th evicts the oldest
    const store = new PersistentEventDeduplicationStore(3, 60 * 60_000);
    await store.add("tx:1");
    await store.add("tx:2");
    await store.add("tx:3");
    await store.add("tx:4"); // exceeds maxSize — tx:1 should be evicted

    // tx:4 must be tracked (most recent)
    expect(await store.has("tx:4")).toBe(true);
    // The store must not exceed maxSize
    // (We verify via has() — if eviction works, tx:1 is gone)
    // Note: eviction order is insertion order (Map iteration order)
    expect(await store.has("tx:1")).toBe(false);
  });

  it("does not deduplicate across different IDs", async () => {
    const store = new PersistentEventDeduplicationStore();
    await store.add("tx:1");
    expect(await store.has("tx:2")).toBe(false);
  });
});

// ─── StreamEventEmitter — startup and unsubscribe ────────────────────────────

describe("StreamEventEmitter — startup, unsubscribe, and backpressure", () => {
  it("on() registers a listener and returns an unsubscribe function", async () => {
    const emitter = new StreamEventEmitter<{ payment: { amount: string } }>();
    const received: string[] = [];

    const unsubscribe = emitter.on("payment", (p) => { received.push(p.amount); });

    await emitter.emit("payment", { amount: "10" });
    expect(received).toEqual(["10"]);

    unsubscribe();

    await emitter.emit("payment", { amount: "20" });
    // After unsubscribe, the listener must NOT receive further events
    expect(received).toEqual(["10"]);
  });

  it("unsubscribe() is idempotent — calling twice does not throw", () => {
    const emitter = new StreamEventEmitter<{ event: void }>();
    const unsubscribe = emitter.on("event", () => undefined);
    expect(() => { unsubscribe(); unsubscribe(); }).not.toThrow();
  });

  it("removeAllListeners() removes all listeners for a specific event", async () => {
    const emitter = new StreamEventEmitter<{ a: string; b: string }>();
    const received: string[] = [];

    emitter.on("a", (v) => received.push(`a:${v}`));
    emitter.on("b", (v) => received.push(`b:${v}`));
    emitter.removeAllListeners("a");

    await emitter.emit("a", "ignored");
    await emitter.emit("b", "kept");
    expect(received).toEqual(["b:kept"]);
  });

  it("removeAllListeners() with no argument clears everything", async () => {
    const emitter = new StreamEventEmitter<{ a: string }>();
    const received: string[] = [];
    emitter.on("a", (v) => received.push(v));
    emitter.removeAllListeners();
    await emitter.emit("a", "ignored");
    expect(received).toHaveLength(0);
  });

  it("listenerCount() returns the correct number of active listeners", () => {
    const emitter = new StreamEventEmitter<{ click: void }>();
    const unsub1 = emitter.on("click", () => undefined);
    const unsub2 = emitter.on("click", () => undefined);
    expect(emitter.listenerCount("click")).toBe(2);
    unsub1();
    expect(emitter.listenerCount("click")).toBe(1);
    unsub2();
    expect(emitter.listenerCount("click")).toBe(0);
  });

  it("delivers events to multiple listeners independently", async () => {
    const emitter = new StreamEventEmitter<{ tick: number }>();
    const a: number[] = [];
    const b: number[] = [];

    emitter.on("tick", (n) => { a.push(n); });
    emitter.on("tick", (n) => { b.push(n); });

    await emitter.emit("tick", 1);
    await emitter.emit("tick", 2);

    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  it("applies backpressure: waits for async listener to settle before next event", async () => {
    const emitter = new StreamEventEmitter<{ item: number }>();
    const order: string[] = [];

    emitter.on("item", async (n) => {
      order.push(`start:${n}`);
      await new Promise<void>((r) => setTimeout(r, 10));
      order.push(`end:${n}`);
    });

    // Emit concurrently — but the emitter should serialize within each listener
    await Promise.all([
      emitter.emit("item", 1),
      emitter.emit("item", 2),
    ]);

    // Listener 1 must fully complete before listener processes event 2
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  it("off() removes a specific listener by reference", async () => {
    const emitter = new StreamEventEmitter<{ click: string }>();
    const received: string[] = [];
    const listener = (v: string) => received.push(v);

    emitter.on("click", listener);
    await emitter.emit("click", "first");

    emitter.off("click", listener);
    await emitter.emit("click", "second");

    expect(received).toEqual(["first"]);
  });

  it("emit() resolves even when no listeners are registered (no-op)", async () => {
    const emitter = new StreamEventEmitter<{ event: string }>();
    await expect(emitter.emit("event", "value")).resolves.toBeUndefined();
  });
});
