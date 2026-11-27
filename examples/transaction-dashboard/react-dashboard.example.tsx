/**
 * React transaction status dashboard example (#708).
 *
 * Copy this pattern into your app. It subscribes to a
 * `TransactionStatusAggregator` (live metrics + chart data) and renders
 * success rate, fee analysis, status distribution, and recent transactions.
 *
 * For streaming a live, growing activity feed into a virtualized list (with
 * cursor-based resume and backpressure handling), see:
 * `examples/transaction-dashboard/virtualized-activity-feed.example.tsx`
 */
import { useEffect, useState } from "react";
import {
  TransactionStatusAggregator,
  streamTransactionStatus,
  type DashboardSnapshot,
} from "../../src/transaction/transactionDashboard";
import type { TransactionResult } from "../../src/transaction/types";
import { TransactionTimeline } from "./transaction-timeline";

export const dashboard = new TransactionStatusAggregator({ maxEntries: 1000 });

// Poll your transaction source and fan out to all subscribers.
export function startLiveUpdates(fetchRecent: () => Promise<TransactionResult[]>): () => void {
  const handle = streamTransactionStatus(fetchRecent, dashboard, { intervalMs: 5000 });
  return () => handle.stop();
}

// ---------------------------------------------------------------------------
// Inline styles — no external CSS dependency so the example is self-contained.
// All widths use max-width + 100% so the layout stays within any viewport.
// ---------------------------------------------------------------------------

const styles = {
  section: {
    boxSizing: "border-box" as const,
    width: "100%",
    maxWidth: 960,
    margin: "0 auto",
    padding: "1rem",
    fontFamily: "system-ui, sans-serif",
  },
  metricsStrip: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "0.5rem 1.5rem",
    marginBottom: "1.25rem",
  },
  metricItem: {
    minWidth: 0,
    flexShrink: 1 as const,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "1rem",
    alignItems: "start",
  },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    minWidth: 0,
  },
  cardTitle: {
    margin: "0 0 0.5rem",
    fontSize: "0.875rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "#64748b",
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  listItem: {
    padding: "0.35rem 0",
    borderBottom: "1px solid #f1f5f9",
    fontSize: "0.875rem",
    display: "flex",
    justifyContent: "space-between",
    gap: "0.5rem",
    minWidth: 0,
  },
  hashCell: {
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
    flexShrink: 1 as const,
    minWidth: 0,
    fontFamily: "monospace",
  },
  statusBadge: {
    flexShrink: 0,
    fontSize: "0.75rem",
    padding: "0.1rem 0.4rem",
    borderRadius: 4,
    background: "#f1f5f9",
    color: "#334155",
  },
} as const;

export function TransactionStatusDashboard({
  aggregator = dashboard,
}: {
  aggregator?: TransactionStatusAggregator;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() =>
    aggregator.getSnapshot(),
  );

  useEffect(() => aggregator.subscribe(setSnapshot), [aggregator]);

  return (
    <section aria-label="Transaction status dashboard" style={styles.section}>
      {/* Metrics strip — wraps to multiple lines on narrow viewports */}
      <header>
        <h2 style={{ margin: "0 0 0.75rem" }}>
          Transactions ({snapshot.metrics.total})
        </h2>
        <div style={styles.metricsStrip} role="list" aria-label="Summary metrics">
          <span role="listitem" style={styles.metricItem}>
            <strong>Success rate:</strong>{" "}
            {(snapshot.metrics.successRate * 100).toFixed(1)}%
          </span>
          <span role="listitem" style={styles.metricItem}>
            <strong>Avg fee:</strong> {snapshot.metrics.avgFee ?? "—"}
          </span>
          <span role="listitem" style={styles.metricItem}>
            <strong>Avg confirmation:</strong>{" "}
            {snapshot.metrics.avgProcessingTimeMs !== null
              ? `${Math.round(snapshot.metrics.avgProcessingTimeMs)}ms`
              : "—"}
          </span>
        </div>
      </header>
      <ul>
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
