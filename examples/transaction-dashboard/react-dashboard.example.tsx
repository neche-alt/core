/**
 * React transaction status dashboard example (#708, #136).
 *
 * Copy this pattern into your app. It subscribes to a
 * `TransactionStatusAggregator` (live metrics + chart data) and renders
 * success rate, fee analysis, status distribution, and recent transactions.
 *
 * For streaming a live, growing activity feed into a virtualized list (with
 * cursor-based resume and backpressure handling), see:
 * `examples/transaction-dashboard/virtualized-activity-feed.example.tsx`
 */
import { useEffect, useState, useCallback } from "react";
import {
  TransactionStatusAggregator,
  streamTransactionStatus,
  type DashboardSnapshot,
} from "../../src/transaction/transactionDashboard";
import type { TransactionResult } from "../../src/transaction/types";
import { TransactionTimeline } from "./transaction-timeline";

export const dashboard = new TransactionStatusAggregator({ maxEntries: 1000 });

// A single shared fee panel instance. In a real app this is typically created
// once at app startup and passed via context.
export const feePanel = createFeePanel({ network: "testnet" });

// Poll your transaction source and fan out to all subscribers.
export function startLiveUpdates(fetchRecent: () => Promise<TransactionResult[]>): () => void {
  const handle = streamTransactionStatus(fetchRecent, dashboard, { intervalMs: 5000 });
  return () => handle.stop();
}

// ─── Fee panel component ──────────────────────────────────────────────────────

function FeePanelView({ panel = feePanel }: { panel?: FeePanel }) {
  const [snap, setSnap] = useState<FeePanelSnapshot>(() => panel.getSnapshot());

  useEffect(() => panel.subscribe(setSnap), [panel]);

  const handleTierChange = useCallback(
    (tier: FeePolicyTier) => panel.selectTier(tier),
    [panel],
  );

  const congestionColor: Record<string, string> = {
    healthy: "#16a34a",
    elevated: "#d97706",
    congested: "#dc2626",
  };

  return (
    <section aria-label="Fee panel" style={{ marginTop: "1.5rem", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem" }}>
      <h3 style={{ margin: "0 0 0.75rem" }}>Network fees</h3>

      {/* Congestion level */}
      <p style={{ margin: "0 0 0.75rem" }}>
        Congestion:{" "}
        <strong style={{ color: congestionColor[snap.congestionLevel] ?? "#374151" }}>
          {snap.congestionLevel}
        </strong>
        {" "}
        <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>
          (avg latency {Math.round(snap.congestion.averageLatencyMs)} ms ·{" "}
          {(snap.congestion.failureRate * 100).toFixed(1)}% failure rate)
        </span>
      </p>

      {/* Three fee suggestions */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {snap.suggestions.map((s) => (
          <button
            key={s.tier}
            onClick={() => handleTierChange(s.tier)}
            aria-pressed={snap.selectedTier === s.tier}
            style={{
              flex: 1,
              padding: "0.5rem",
              borderRadius: 6,
              border: snap.selectedTier === s.tier ? "2px solid #1d4ed8" : "1px solid #d1d5db",
              background: snap.selectedTier === s.tier ? "#eff6ff" : "#f9fafb",
              cursor: "pointer",
              fontWeight: snap.selectedTier === s.tier ? 600 : 400,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Selected fee */}
      <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>
        Selected fee:{" "}
        <span style={{ color: "#1d4ed8" }}>{snap.selectedFeeStroops} stroops</span>
      </p>

      {/* Surge warning */}
      {snap.surgeWarning && snap.surgeMessage && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "0.6rem 0.75rem",
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 6,
            fontSize: "0.85rem",
            color: "#92400e",
          }}
        >
          ⚠️ {snap.surgeMessage}
        </p>
      )}
    </section>
  );
}

// ─── Main dashboard component ─────────────────────────────────────────────────

export function TransactionStatusDashboard({
  aggregator = dashboard,
  panel = feePanel,
}: {
  aggregator?: TransactionStatusAggregator;
  panel?: FeePanel;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => aggregator.getSnapshot());

  // Subscription lifecycle: The caller owns the subscription and unsubscribes
  // on component unmount to prevent memory leaks and dangling callbacks.
  useEffect(() => {
    const unsubscribe = aggregator.subscribe(setSnapshot);
    return () => unsubscribe();
  }, [aggregator]);

  return (
    <section aria-label="Transaction status dashboard">
      <header>
        <h2>Transactions ({snapshot.metrics.total})</h2>
        <p>
          Success rate: {(snapshot.metrics.successRate * 100).toFixed(1)}% · Avg fee:{" "}
          {snapshot.metrics.avgFee ?? "—"} · Avg confirmation:{" "}
          {snapshot.metrics.avgProcessingTimeMs !== null
            ? `${Math.round(snapshot.metrics.avgProcessingTimeMs)}ms`
            : "—"}
        </p>
      </header>

      {/* Fee panel — congestion-adjusted suggestions (#136) */}
      <FeePanelView panel={panel} />

      <ul style={{ marginTop: "1.5rem" }}>
        {snapshot.charts.statusDistribution.map((s) => (
          <li key={s.label}>
            {s.label}: {s.value}
          </li>
        ))}
      </ul>
      <ol>
        {snapshot.recent.map((entry) => (
          <li key={entry.tx.hash}>
            {entry.tx.hash.slice(0, 8)}… — {entry.tx.status} ({entry.category})
          </li>
        ))}
      </ol>

      {/* Per-transaction timeline for the most recent entry */}
      {snapshot.recent.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3>Latest transaction</h3>
          <TransactionTimeline tx={snapshot.recent[0].tx} />
        </div>
      )}
    </section>
  );
}
