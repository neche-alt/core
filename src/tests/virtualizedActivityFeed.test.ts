/**
 * Tests for the virtualized activity feed manager (#134).
 *
 * Covers: initialization, append, deduplication, maxItems eviction,
 * backpressure, cursor persistence, subscribe/unsubscribe, appendBatch,
 * reset, and aggregate incremental updates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createVirtualizedFeedManager } from "../account/virtualizedActivityFeed";
import type { ActivityFeedItem } from "../account/virtualizedActivityFeed";
import { MemoryCursorStore } from "../streaming/cursorStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let seq = 0;

function makeItem(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    cursor: `cursor-${seq}`,
    timestamp: new Date().toISOString(),
    type: "payment",
    assetCode: "XLM",
    amount: "10.0000000",
    direction: "in",
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

// ─── Initialisation ───────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — initialisation", () => {
  it("starts with empty items and zeroed aggregates", () => {
    const feed = createVirtualizedFeedManager();
    const state = feed.getState();
    expect(state.items).toHaveLength(0);
    expect(state.droppedCount).toBe(0);
    expect(state.cursor).toBeUndefined();
    expect(state.aggregates.totalItems).toBe(0);
    expect(state.aggregates.totalAmountIn).toBe(0);
    expect(state.aggregates.totalAmountOut).toBe(0);
    expect(state.aggregates.topAssets).toHaveLength(0);
  });
});

// ─── Append ───────────────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — append", () => {
  it("appends an item and updates the state", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem());
    const state = feed.getState();
    expect(state.items).toHaveLength(1);
    expect(state.aggregates.totalItems).toBe(1);
  });

  it("updates totalAmountIn for inbound items", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem({ direction: "in", amount: "5.0000000" }));
    expect(feed.getState().aggregates.totalAmountIn).toBeCloseTo(5);
    expect(feed.getState().aggregates.totalAmountOut).toBe(0);
  });

  it("updates totalAmountOut for outbound items", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem({ direction: "out", amount: "3.5000000" }));
    expect(feed.getState().aggregates.totalAmountOut).toBeCloseTo(3.5);
    expect(feed.getState().aggregates.totalAmountIn).toBe(0);
  });

  it("tracks topAssets by count", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem({ assetCode: "XLM" }));
    await feed.append(makeItem({ assetCode: "USDC" }));
    await feed.append(makeItem({ assetCode: "XLM" }));
    const { topAssets } = feed.getState().aggregates;
    expect(topAssets[0]?.assetCode).toBe("XLM");
    expect(topAssets[0]?.count).toBe(2);
    expect(topAssets[1]?.assetCode).toBe("USDC");
  });

  it("tracks the cursor from the most recent item", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem({ cursor: "cursor-A" }));
    await feed.append(makeItem({ cursor: "cursor-B" }));
    expect(feed.getState().cursor).toBe("cursor-B");
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — deduplication", () => {
  it("ignores a second append of the same id", async () => {
    const feed = createVirtualizedFeedManager();
    const item = makeItem({ id: "dup-id" });
    await feed.append(item);
    await feed.append({ ...item, amount: "999" }); // same id, different data
    const state = feed.getState();
    expect(state.items).toHaveLength(1);
    expect(state.aggregates.totalItems).toBe(1);
  });

  it("appendBatch deduplicates within the batch", async () => {
    const feed = createVirtualizedFeedManager();
    const item = makeItem({ id: "batch-dup" });
    await feed.appendBatch([item, { ...item, amount: "999" }]);
    expect(feed.getState().items).toHaveLength(1);
  });

  it("appendBatch deduplicates against existing items", async () => {
    const feed = createVirtualizedFeedManager();
    const item = makeItem({ id: "existing" });
    await feed.append(item);
    await feed.appendBatch([{ ...item, amount: "999" }, makeItem()]);
    expect(feed.getState().items).toHaveLength(2);
  });
});

// ─── maxItems eviction ────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — maxItems", () => {
  it("drops oldest items when maxItems is exceeded", async () => {
    const feed = createVirtualizedFeedManager({ maxItems: 3 });
    const items = [makeItem(), makeItem(), makeItem(), makeItem()];
    for (const item of items) await feed.append(item);
    const state = feed.getState();
    expect(state.items).toHaveLength(3);
    // Oldest (first) item should be gone
    expect(state.items.find((i) => i.id === items[0]?.id)).toBeUndefined();
    // Newest three remain
    expect(state.items.map((i) => i.id)).toContain(items[3]?.id);
  });
});

// ─── Backpressure ─────────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — backpressure", () => {
  it("drops items beyond maxItemsPerSecond and increments droppedCount", async () => {
    const feed = createVirtualizedFeedManager({ maxItemsPerSecond: 2 });
    // Append 5 items in immediate succession (same second).
    for (let i = 0; i < 5; i++) {
      await feed.append(makeItem());
    }
    const state = feed.getState();
    expect(state.items).toHaveLength(2);
    expect(state.droppedCount).toBe(3);
  });

  it("droppedCount starts at zero", () => {
    const feed = createVirtualizedFeedManager();
    expect(feed.getState().droppedCount).toBe(0);
  });
});

// ─── Cursor persistence ───────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — cursor store", () => {
  it("saves cursor to cursorStore after append", async () => {
    const store = new MemoryCursorStore();
    const feed = createVirtualizedFeedManager({ cursorStore: store, cursorKey: "test" });
    await feed.append(makeItem({ cursor: "my-cursor" }));
    const saved = await store.load("test");
    expect(saved).toBe("my-cursor");
  });

  it("loadCursor returns undefined when store is empty", async () => {
    const store = new MemoryCursorStore();
    const feed = createVirtualizedFeedManager({ cursorStore: store });
    expect(await feed.loadCursor()).toBeUndefined();
  });

  it("loadCursor returns the last saved cursor", async () => {
    const store = new MemoryCursorStore();
    const feed = createVirtualizedFeedManager({ cursorStore: store, cursorKey: "k" });
    await feed.append(makeItem({ cursor: "c-1" }));
    await feed.append(makeItem({ cursor: "c-2" }));
    expect(await feed.loadCursor()).toBe("c-2");
  });

  it("loadCursor returns undefined when no cursorStore is configured", async () => {
    const feed = createVirtualizedFeedManager({ cursorStore: undefined });
    expect(await feed.loadCursor()).toBeUndefined();
  });

  it("operates normally when cursorStore.save throws", async () => {
    const store = new MemoryCursorStore();
    vi.spyOn(store, "save").mockRejectedValue(new Error("storage full"));
    const feed = createVirtualizedFeedManager({ cursorStore: store });
    await expect(feed.append(makeItem())).resolves.toBeUndefined();
    expect(feed.getState().items).toHaveLength(1);
  });
});

// ─── Subscribe ────────────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — subscribe", () => {
  it("calls listener after append", async () => {
    const feed = createVirtualizedFeedManager();
    const listener = vi.fn();
    feed.subscribe(listener);
    await feed.append(makeItem());
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].items).toHaveLength(1);
  });

  it("unsubscribe stops notifications", async () => {
    const feed = createVirtualizedFeedManager();
    const listener = vi.fn();
    const unsub = feed.subscribe(listener);
    unsub();
    await feed.append(makeItem());
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── appendBatch ─────────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — appendBatch", () => {
  it("appends multiple distinct items in one call", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.appendBatch([makeItem(), makeItem(), makeItem()]);
    expect(feed.getState().items).toHaveLength(3);
  });

  it("fires subscriber once per appendBatch call", async () => {
    const feed = createVirtualizedFeedManager();
    const listener = vi.fn();
    feed.subscribe(listener);
    await feed.appendBatch([makeItem(), makeItem()]);
    expect(listener).toHaveBeenCalledOnce();
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────────

describe("createVirtualizedFeedManager — reset", () => {
  it("clears items, aggregates, and droppedCount", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem({ direction: "in", amount: "10" }));
    await feed.reset();
    const state = feed.getState();
    expect(state.items).toHaveLength(0);
    expect(state.aggregates.totalItems).toBe(0);
    expect(state.aggregates.totalAmountIn).toBe(0);
    expect(state.aggregates.topAssets).toHaveLength(0);
    expect(state.cursor).toBeUndefined();
  });

  it("removes the cursor from the cursor store", async () => {
    const store = new MemoryCursorStore();
    const feed = createVirtualizedFeedManager({ cursorStore: store, cursorKey: "k" });
    await feed.append(makeItem({ cursor: "c-1" }));
    expect(await store.load("k")).toBe("c-1");
    await feed.reset();
    expect(await store.load("k")).toBeUndefined();
  });

  it("allows re-use after reset", async () => {
    const feed = createVirtualizedFeedManager();
    await feed.append(makeItem());
    await feed.reset();
    await feed.append(makeItem());
    expect(feed.getState().items).toHaveLength(1);
  });
});
