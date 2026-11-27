/**
 * React transaction status dashboard example (#708, #106).
 *
 * Copy this pattern into your app. It subscribes to a
 * `TransactionStatusAggregator` (live metrics + chart data) and renders
 * success rate, fee analysis, status distribution, and recent transactions.
 *
 * Error recovery (#106):
 * - Read operations (fetching the snapshot / refreshing balances) expose a
 *   safe "Retry" button — re-running them is always idempotent.
 * - Write operations (transaction submissions) show a status-check link
 *   instead of a retry button so the user confirms the transaction did not
 *   land before resubmitting, preventing accidental double-spends.
 */
import { useCallback, useEffect, useState } from "react";
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

// ---------------------------------------------------------------------------
// Error state shape
// ---------------------------------------------------------------------------

/** Distinguishes safe read retries from writes that need a status check first. */
export type DashboardErrorKind = "read" | "write";

export interface DashboardError {
  kind: DashboardErrorKind;
  message: string;
  /** Hash of the transaction involved, present for write errors. */
  txHash?: string;
}

// ---------------------------------------------------------------------------
// Recovery helpers (pure — no side-effects, easy to unit-test)
// ---------------------------------------------------------------------------

/** Returns true when retrying the operation is safe without a status check. */
export function isRetryable(err: DashboardError): boolean {
  return err.kind === "read";
}

/** Returns true when the caller must check transaction status before retrying. */
export function requiresStatusCheck(err: DashboardError): boolean {
  return err.kind === "write";
}

// ---------------------------------------------------------------------------
// Dashboard component
// ---------------------------------------------------------------------------

export function TransactionStatusDashboard({
  aggregator = dashboard,
  onRetryRead,
}: {
  aggregator?: TransactionStatusAggregator;
  /**
   * Called when the user clicks "Retry" on a read error.
   * Provide a function that re-fetches data and re-populates the aggregator.
   */
  onRetryRead?: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => aggregator.getSnapshot());
  const [dashError, setDashError] = useState<DashboardError | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Subscription lifecycle: The caller owns the subscription and unsubscribes
  // on component unmount to prevent memory leaks and dangling callbacks.
  useEffect(() => {
    const unsubscribe = aggregator.subscribe(setSnapshot);
    return () => unsubscribe();
  }, [aggregator]);

  const handleRetryRead = useCallback(async () => {
    if (!onRetryRead) return;
    setRetrying(true);
    setDashError(null);
    try {
      await onRetryRead();
    } catch (err) {
      setDashError({
        kind: "read",
        message: err instanceof Error ? err.message : "Failed to reload transactions.",
      });
    } finally {
      setRetrying(false);
    }
  }, [onRetryRead]);

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

      {/* ── Error recovery affordances ─────────────────────────────────────── */}
      {dashError && (
        <div role="alert" aria-live="polite">
          <p>{dashError.message}</p>

          {/* Read error: safe to retry immediately */}
          {isRetryable(dashError) && onRetryRead && (
            <button onClick={() => void handleRetryRead()} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}

          {/* Write error: direct the user to check status before retrying */}
          {requiresStatusCheck(dashError) && (
            <p>
              <strong>Do not resubmit yet.</strong> Check whether the transaction
              landed first:
              {dashError.txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${dashError.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {" "}
                  View on Stellar Expert ↗
                </a>
              )}
            </p>
          )}
        </div>
      )}

      {/* ── Status distribution ────────────────────────────────────────────── */}
      <ul>
        {snapshot.charts.statusDistribution.map((s) => (
          <li key={s.label}>
            {s.label}: {s.value}
          </li>
        ))}
      </ul>

      {/* ── Recent transactions ────────────────────────────────────────────── */}
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
