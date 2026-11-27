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

export function TransactionStatusDashboard({ aggregator = dashboard }: { aggregator?: TransactionStatusAggregator }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => aggregator.getSnapshot());

  useEffect(() => aggregator.subscribe(setSnapshot), [aggregator]);

  const unavailable = i18n.t("ui.dashboard.unavailable");

  return (
    <section aria-label="Transaction status dashboard">
      <header>
        <h2>
          {i18n.t("ui.dashboard.heading")} ({snapshot.metrics.total})
        </h2>
        <p>
          {i18n.t("ui.dashboard.success_rate")}: {(snapshot.metrics.successRate * 100).toFixed(1)}%
          {" · "}
          {i18n.t("ui.dashboard.avg_fee")}: {snapshot.metrics.avgFee ?? unavailable}
          {" · "}
          {i18n.t("ui.dashboard.avg_confirmation")}:{" "}
          {snapshot.metrics.avgProcessingTimeMs !== null
            ? `${Math.round(snapshot.metrics.avgProcessingTimeMs)}ms`
            : unavailable}
        </p>
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
