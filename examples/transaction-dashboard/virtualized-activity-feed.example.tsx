/**
 * Virtualized account activity feed example (#134).
 *
 * Demonstrates streaming a live, growing activity feed from streamAccount.ts
 * into a bounded, deduplicated virtualized list. Only visible rows are
 * rendered via a simple window, keeping re-renders cheap even for large feeds.
 *
 * Key patterns shown:
 * - Subscribing to `streamAccount` to receive live account state changes
 * - Deriving `ActivityFeedItem` entries from balance deltas between polls
 * - Using `createVirtualizedFeedManager` for dedup, backpressure, and cursor
 *   persistence (cursor resume after reconnect via `cursorStore`)
 * - Incrementally-updated header aggregates from `getAccountActivitySummary`
 * - Backpressure indicator when items are dropped
 *
 * In a production app, replace the manual windowing below with
 * `react-window` or `@tanstack/react-virtual` for smoother UX.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVirtualizedFeedManager,
  type ActivityFeedItem,
  type VirtualizedFeedState,
} from "../../src/account/virtualizedActivityFeed";
import { streamAccount } from "../../src/account/streamAccount";
import { getAccountActivitySummary } from "../../src/account/getAccountActivitySummary";
import type { AccountActivitySummary } from "../../src/account/getAccountActivitySummary";
import { createCursorStore } from "../../src/streaming/cursorStore";
import type { AccountInfo } from "../../src/account/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 44; // px per list row
const VISIBLE_ROWS = 15; // rows shown in the viewport at once

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives activity items from the balance delta between two consecutive
 * account snapshots. Each changed balance becomes one feed item.
 */
function deriveActivityItems(
  prev: AccountInfo,
  next: AccountInfo,
  feedIndex: number,
): ActivityFeedItem[] {
  const prevMap = new Map(prev.balances.map((b) => [`${b.assetCode}:${b.assetIssuer ?? ""}`, b]));
  const items: ActivityFeedItem[] = [];
  const now = new Date().toISOString();

  for (const bal of next.balances) {
    const key = `${bal.assetCode}:${bal.assetIssuer ?? ""}`;
    const old = prevMap.get(key);
    if (!old) continue;
    const delta = parseFloat(bal.balance) - parseFloat(old.balance);
    if (delta === 0) continue;

    items.push({
      id: `${key}-${feedIndex}-${Date.now()}`,
      cursor: String(feedIndex),
      timestamp: now,
      type: "payment",
      assetCode: bal.assetCode,
      amount: Math.abs(delta).toFixed(7),
      direction: delta > 0 ? "in" : "out",
    });
  }
  return items;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface VirtualizedActivityFeedProps {
  horizonUrl: string;
  publicKey: string;
  /** Polling interval in ms. Default: 5000. */
  intervalMs?: number;
}

export function VirtualizedActivityFeed({
  horizonUrl,
  publicKey,
  intervalMs = 5000,
}: VirtualizedActivityFeedProps) {
  // Feed manager (created once, stable ref)
  const feedRef = useRef(
    createVirtualizedFeedManager({
      maxItems: 500,
      maxItemsPerSecond: 50,
      cursorStore: createCursorStore(),
      cursorKey: `activity:${publicKey}`,
    }),
  );
  const feed = feedRef.current;

  const [feedState, setFeedState] = useState<VirtualizedFeedState>(() => feed.getState());
  const [summary, setSummary] = useState<AccountActivitySummary | null>(null);
  const [resumeCursor, setResumeCursor] = useState<string | undefined>(undefined);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Load persisted cursor on mount
  useEffect(() => {
    feed.loadCursor().then(setResumeCursor);
  }, [feed]);

  // Subscribe to feed state changes
  useEffect(() => {
    const unsubscribe = feed.subscribe(setFeedState);
    return unsubscribe;
  }, [feed]);

  // Stream account activity
  useEffect(() => {
    const ac = new AbortController();
    let prevSnapshot: AccountInfo | null = null;
    let feedIndex = 0;

    async function run() {
      for await (const result of streamAccount(horizonUrl, publicKey, { intervalMs }, ac.signal)) {
        if (ac.signal.aborted) break;
        if (result.status !== "ok") continue;

        const current = result.data;
        if (prevSnapshot) {
          const items = deriveActivityItems(prevSnapshot, current, feedIndex++);
          if (items.length > 0) {
            await feed.appendBatch(items);
          }
        }
        prevSnapshot = current;
      }
    }

    void run();
    return () => ac.abort();
  }, [horizonUrl, publicKey, intervalMs, feed]);

  // Refresh summary aggregates periodically
  const refreshSummary = useCallback(async () => {
    const result = await getAccountActivitySummary(horizonUrl, publicKey, "24h");
    if (result.status === "ok") setSummary(result.data);
  }, [horizonUrl, publicKey]);

  useEffect(() => {
    void refreshSummary();
    const id = setInterval(() => { void refreshSummary(); }, 30_000);
    return () => clearInterval(id);
  }, [refreshSummary]);

  // Virtualized window calculation
  const items = feedState.items;
  const totalHeight = items.length * ROW_HEIGHT;
  const startIndex = Math.floor(scrollOffset / ROW_HEIGHT);
  const visibleItems = items.slice(startIndex, startIndex + VISIBLE_ROWS);
  const paddingTop = startIndex * ROW_HEIGHT;
  const paddingBottom = Math.max(0, totalHeight - paddingTop - visibleItems.length * ROW_HEIGHT);

  return (
    <section aria-label="Live account activity feed" style={containerStyle}>
      {/* Header aggregates */}
      <header style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Live Activity Feed</h2>
        {resumeCursor && (
          <span style={badgeStyle} title={`Resumed from cursor: ${resumeCursor}`}>
            ↺ Resumed
          </span>
        )}
        <div style={statsRowStyle}>
          <Stat label="Items" value={feedState.aggregates.totalItems} />
          <Stat label="In" value={feedState.aggregates.totalAmountIn.toFixed(2)} />
          <Stat label="Out" value={feedState.aggregates.totalAmountOut.toFixed(2)} />
          {summary && (
            <>
              <Stat label="Tx (24h)" value={summary.transactionCount} />
              <Stat label="Avg size" value={parseFloat(summary.averageTransactionSize).toFixed(2)} />
            </>
          )}
        </div>
        {feedState.droppedCount > 0 && (
          <p style={backpressureWarningStyle}>
            ⚠ Backpressure: {feedState.droppedCount} item{feedState.droppedCount !== 1 ? "s" : ""} dropped
            (stream too fast — increase maxItemsPerSecond or reduce upstream rate)
          </p>
        )}
        {feedState.aggregates.topAssets.length > 0 && (
          <div style={topAssetsStyle}>
            <strong>Top assets:</strong>{" "}
            {feedState.aggregates.topAssets
              .slice(0, 5)
              .map((a) => `${a.assetCode} (${a.count})`)
              .join(" · ")}
          </div>
        )}
      </header>

      {/* Virtualized list */}
      <div
        role="list"
        aria-label="Activity items"
        style={listContainerStyle}
        onScroll={(e) => setScrollOffset((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: `${totalHeight}px`, position: "relative" }}>
          <div style={{ paddingTop: `${paddingTop}px`, paddingBottom: `${paddingBottom}px` }}>
            {visibleItems.map((item, i) => (
              <ActivityRow key={item.id} item={item} index={startIndex + i} />
            ))}
          </div>
        </div>
        {items.length === 0 && (
          <p style={emptyStyle}>Waiting for account activity…</p>
        )}
      </div>
    </section>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActivityRow({ item, index }: { item: ActivityFeedItem; index: number }) {
  return (
    <div
      role="listitem"
      style={{
        ...rowStyle,
        background: index % 2 === 0 ? "#f9fafb" : "#fff",
      }}
    >
      <span style={directionStyle(item.direction)}>
        {item.direction === "in" ? "↓" : "↑"}
      </span>
      <span style={assetStyle}>{item.assetCode}</span>
      <span style={amountStyle}>{item.amount}</span>
      <span style={timestampStyle}>{new Date(item.timestamp).toLocaleTimeString()}</span>
      {item.counterparty && (
        <span style={counterpartyStyle} title={item.counterparty}>
          {item.counterparty.slice(0, 8)}…
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={statStyle}>
      <span style={statLabelStyle}>{label}</span>
      <span style={statValueStyle}>{value}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: "760px",
  border: "1px solid #e5e7eb",
  borderRadius: "10px",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "16px 20px",
  borderBottom: "1px solid #e5e7eb",
  background: "#fff",
};

const statsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "16px",
  flexWrap: "wrap",
  marginTop: "10px",
};

const statStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const statValueStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: "#111827",
};

const backpressureWarningStyle: React.CSSProperties = {
  margin: "8px 0 0",
  padding: "6px 12px",
  background: "#fef3c7",
  borderRadius: "6px",
  fontSize: "13px",
  color: "#92400e",
};

const topAssetsStyle: React.CSSProperties = {
  marginTop: "8px",
  fontSize: "13px",
  color: "#6b7280",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  background: "#e0e7ff",
  color: "#4338ca",
  borderRadius: "4px",
  fontSize: "12px",
  marginLeft: "10px",
};

const listContainerStyle: React.CSSProperties = {
  height: `${VISIBLE_ROWS * ROW_HEIGHT}px`,
  overflowY: "auto",
  overflowX: "hidden",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  height: `${ROW_HEIGHT}px`,
  padding: "0 16px",
  fontSize: "14px",
  borderBottom: "1px solid #f3f4f6",
};

const directionStyle = (dir: "in" | "out"): React.CSSProperties => ({
  fontWeight: 700,
  color: dir === "in" ? "#059669" : "#dc2626",
  width: "16px",
});

const assetStyle: React.CSSProperties = {
  fontWeight: 600,
  width: "80px",
  color: "#374151",
};

const amountStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  color: "#111827",
  flex: 1,
};

const timestampStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#9ca3af",
  width: "80px",
  textAlign: "right",
};

const counterpartyStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#6b7280",
  fontFamily: "monospace",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  color: "#9ca3af",
  padding: "40px 0",
  fontSize: "14px",
};
