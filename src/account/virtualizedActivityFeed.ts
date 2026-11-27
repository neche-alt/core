/**
 * Framework-agnostic virtualized activity feed manager (#134).
 *
 * Maintains a bounded, live-growing list of account activity items suitable
 * for rendering with any virtualization library (react-window, react-virtual,
 * etc.). Items are deduplicated by id, backpressure is enforced per second,
 * and cursor positions are persisted for resume-after-reconnect.
 *
 * ## Design
 *
 * - Deduplication: a `Set<string>` of seen IDs keeps append O(1).
 * - Backpressure: items appended beyond `maxItemsPerSecond` within any
 *   rolling second are dropped and counted so memory stays bounded even
 *   when the upstream stream delivers a burst.
 * - Window: when `maxItems` is reached, the oldest items are removed in a
 *   single splice so the subscriber receives one coherent snapshot.
 * - Aggregates are updated incrementally — no full re-scan on every append.
 * - Cursor persistence is best-effort: a missing/unavailable cursor store
 *   does not prevent the feed from operating.
 *
 * @example
 * ```typescript
 * import { createVirtualizedFeedManager } from "./virtualizedActivityFeed";
 * import { createCursorStore } from "../streaming/cursorStore";
 *
 * const feed = createVirtualizedFeedManager({
 *   maxItems: 500,
 *   maxItemsPerSecond: 50,
 *   cursorStore: createCursorStore(),
 * });
 *
 * const unsubscribe = feed.subscribe((state) => renderList(state.items));
 * const cursor = await feed.loadCursor();
 * // resume the stream from cursor if defined, otherwise start fresh
 * ```
 */

import type { CursorStore } from "../streaming/cursorStore";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ActivityFeedItem {
  /** Unique id for deduplication (e.g. transaction hash). */
  id: string;
  /** Cursor position for resume-after-reconnect. */
  cursor: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  type: "payment" | "trade" | "other";
  assetCode: string;
  amount: string;
  direction: "in" | "out";
  counterparty?: string | undefined;
}

export interface VirtualizedFeedConfig {
  /** Maximum number of items to hold in memory. Oldest are dropped. Default: 500. */
  maxItems?: number;
  /** Maximum new items per second before backpressure kicks in. Default: 50. */
  maxItemsPerSecond?: number;
  /** Cursor store for resume-after-reconnect. */
  cursorStore?: CursorStore | undefined;
  /** Key to use in the cursor store. Default: "activity-feed". */
  cursorKey?: string;
}

export interface FeedAggregates {
  /** Total number of items appended (including dropped ones). */
  totalItems: number;
  totalAmountIn: number;
  totalAmountOut: number;
  /** Top assets sorted by appearance count, descending. */
  topAssets: Array<{ assetCode: string; count: number }>;
}

export interface VirtualizedFeedState {
  /** Items currently in the window (oldest first, newest last). */
  items: readonly ActivityFeedItem[];
  /** Count of items dropped due to backpressure. */
  droppedCount: number;
  /** Most recent cursor persisted to the cursor store. */
  cursor: string | undefined;
  /** Incrementally-maintained aggregates for header stats. */
  aggregates: FeedAggregates;
}

export interface VirtualizedFeedManager {
  /** Returns an immutable snapshot of the current state. */
  getState(): VirtualizedFeedState;
  /** Append one item. Handles dedup, backpressure, and cursor persistence. */
  append(item: ActivityFeedItem): Promise<void>;
  /** Append multiple items. Deduplicates within the batch and against the feed. */
  appendBatch(items: ActivityFeedItem[]): Promise<void>;
  /**
   * Subscribe to state changes. The listener is called synchronously after
   * every mutation.
   * @returns An unsubscribe function.
   */
  subscribe(listener: (state: VirtualizedFeedState) => void): () => void;
  /** Load the previously saved cursor from the cursor store. */
  loadCursor(): Promise<string | undefined>;
  /** Clear all items, reset aggregates, and remove the persisted cursor. */
  reset(): Promise<void>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emptyAggregates(): FeedAggregates {
  return { totalItems: 0, totalAmountIn: 0, totalAmountOut: 0, topAssets: [] };
}

function updateTopAssets(
  topAssets: Array<{ assetCode: string; count: number }>,
  assetCode: string,
): Array<{ assetCode: string; count: number }> {
  const existing = topAssets.find((a) => a.assetCode === assetCode);
  if (existing) {
    existing.count += 1;
  } else {
    topAssets.push({ assetCode, count: 1 });
  }
  return topAssets.sort((a, b) => b.count - a.count);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a {@link VirtualizedFeedManager}.
 */
export function createVirtualizedFeedManager(
  config?: VirtualizedFeedConfig,
): VirtualizedFeedManager {
  const maxItems = config?.maxItems ?? 500;
  const maxItemsPerSecond = config?.maxItemsPerSecond ?? 50;
  const cursorStore = config?.cursorStore;
  const cursorKey = config?.cursorKey ?? "activity-feed";

  const items: ActivityFeedItem[] = [];
  const seenIds = new Set<string>();
  let droppedCount = 0;
  let cursor: string | undefined;
  const aggregates = emptyAggregates();
  const listeners = new Set<(state: VirtualizedFeedState) => void>();

  // Backpressure tracking: items added in the current second.
  let currentSecondStart = Date.now();
  let currentSecondCount = 0;

  function snapshot(): VirtualizedFeedState {
    return {
      items: [...items],
      droppedCount,
      cursor,
      aggregates: {
        ...aggregates,
        topAssets: [...aggregates.topAssets],
      },
    };
  }

  function notify(): void {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function checkBackpressure(): boolean {
    const now = Date.now();
    if (now - currentSecondStart >= 1000) {
      currentSecondStart = now;
      currentSecondCount = 0;
    }
    if (currentSecondCount >= maxItemsPerSecond) {
      droppedCount += 1;
      return false; // drop this item
    }
    currentSecondCount += 1;
    return true; // accept
  }

  function applyItem(item: ActivityFeedItem): void {
    // Dedup
    if (seenIds.has(item.id)) return;
    // Backpressure
    if (!checkBackpressure()) return;

    seenIds.add(item.id);
    items.push(item);

    // Trim oldest items when over limit
    if (items.length > maxItems) {
      const removed = items.splice(0, items.length - maxItems);
      for (const r of removed) seenIds.delete(r.id);
    }

    // Update aggregates incrementally
    aggregates.totalItems += 1;
    const amount = parseFloat(item.amount) || 0;
    if (item.direction === "in") {
      aggregates.totalAmountIn += amount;
    } else {
      aggregates.totalAmountOut += amount;
    }
    updateTopAssets(aggregates.topAssets, item.assetCode);

    // Track cursor
    cursor = item.cursor;
  }

  async function persistCursor(): Promise<void> {
    if (!cursorStore || cursor === undefined) return;
    try {
      await cursorStore.save(cursorKey, cursor);
    } catch {
      // Best-effort — cursor store failure must not break the feed.
    }
  }

  function getState(): VirtualizedFeedState {
    return snapshot();
  }

  async function append(item: ActivityFeedItem): Promise<void> {
    applyItem(item);
    await persistCursor();
    notify();
  }

  async function appendBatch(newItems: ActivityFeedItem[]): Promise<void> {
    for (const item of newItems) {
      applyItem(item);
    }
    await persistCursor();
    notify();
  }

  function subscribe(listener: (state: VirtualizedFeedState) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  async function loadCursor(): Promise<string | undefined> {
    if (!cursorStore) return undefined;
    try {
      return await cursorStore.load(cursorKey);
    } catch {
      return undefined;
    }
  }

  async function reset(): Promise<void> {
    items.length = 0;
    seenIds.clear();
    droppedCount = 0;
    cursor = undefined;
    aggregates.totalItems = 0;
    aggregates.totalAmountIn = 0;
    aggregates.totalAmountOut = 0;
    aggregates.topAssets.length = 0;
    if (cursorStore) {
      try {
        await cursorStore.clear(cursorKey);
      } catch {
        // Best-effort.
      }
    }
    notify();
  }

  return { getState, append, appendBatch, subscribe, loadCursor, reset };
}
