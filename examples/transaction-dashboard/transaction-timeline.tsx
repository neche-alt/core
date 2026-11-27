/**
 * Transaction status timeline example (#92).
 *
 * Shows distinct timeline states — signing, submitted, confirming,
 * confirmed / failed — with timestamps where available, delayed-confirmation
 * handling, and labels that match SDK semantics (TransactionResult.status).
 *
 * Copy this into your app alongside the TransactionStatusDashboard.
 */
import { useEffect, useReducer } from "react";
import type { TransactionResult } from "../../src/transaction/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * SDK-aligned transaction lifecycle steps.
 *
 * Matches the status values from TransactionResult plus the pre-submission
 * states that the SDK surfaces during the sign → submit flow.
 */
export type TimelineStep =
  | "signing"      // wallet prompt open, XDR being signed
  | "submitted"    // signed XDR sent to Horizon, waiting for ledger
  | "pending"      // Horizon received it, not yet in a ledger (TransactionResult.status === "pending")
  | "confirming"   // in a ledger but awaiting full confirmation
  | "success"      // TransactionResult.status === "success"
  | "failed"       // TransactionResult.status === "failed"
  | "not_found";   // TransactionResult.status === "not_found"

export interface TimelineEvent {
  step: TimelineStep;
  /** ISO-8601 timestamp, or undefined when only a relative time is known. */
  timestamp?: string;
  /** Display label for screen readers and sighted users. */
  label: string;
  /** Optional detail text — error message, tx hash, ledger number. */
  detail?: string;
}

export interface TransactionTimeline {
  txHash: string;
  events: TimelineEvent[];
  /** The current/terminal step of this transaction. */
  currentStep: TimelineStep;
  /**
   * True when the transaction has been in a submitted/pending state longer
   * than the expected confirmation window (default: 30 s).
   */
  isDelayed: boolean;
}

// ─── State machine ────────────────────────────────────────────────────────────

function sdkStatusToStep(status: TransactionResult["status"]): TimelineStep {
  switch (status) {
    case "success": return "success";
    case "failed":  return "failed";
    case "pending": return "pending";
    case "not_found": return "not_found";
    default:        return "submitted";
  }
}

function buildTimeline(
  tx: TransactionResult,
  submittedAt?: number,
  confirmationWindowMs = 30_000,
): TransactionTimeline {
  const now = Date.now();
  const step = sdkStatusToStep(tx.status);
  const isDelayed =
    (step === "submitted" || step === "pending") &&
    submittedAt !== undefined &&
    now - submittedAt > confirmationWindowMs;

  const events: TimelineEvent[] = [];

  if (submittedAt) {
    events.push({
      step: "submitted",
      timestamp: new Date(submittedAt).toISOString(),
      label: "Submitted to network",
      detail: tx.hash,
    });
  }

  if (step === "pending" || step === "confirming") {
    events.push({
      step: "pending",
      label: "Awaiting ledger inclusion",
      detail: isDelayed ? "Taking longer than expected…" : undefined,
    });
  }

  if (step === "success") {
    events.push({
      step: "confirming",
      label: "Included in ledger",
      detail: tx.ledger !== undefined ? `Ledger #${tx.ledger}` : undefined,
    });
    events.push({
      step: "success",
      timestamp: tx.createdAt,
      label: "Confirmed",
    });
  }

  if (step === "failed") {
    events.push({
      step: "failed",
      timestamp: tx.createdAt,
      label: "Transaction failed",
    });
  }

  if (step === "not_found") {
    events.push({
      step: "not_found",
      label: "Transaction not found",
      detail: "The transaction may have expired or the hash is incorrect.",
    });
  }

  return { txHash: tx.hash, events, currentStep: step, isDelayed };
}

// ─── Step metadata ────────────────────────────────────────────────────────────

const STEP_META: Record<TimelineStep, { icon: string; ariaLabel: string }> = {
  signing:    { icon: "✍️",  ariaLabel: "Signing" },
  submitted:  { icon: "📤", ariaLabel: "Submitted" },
  pending:    { icon: "⏳", ariaLabel: "Pending" },
  confirming: { icon: "🔄", ariaLabel: "Confirming" },
  success:    { icon: "✅", ariaLabel: "Confirmed" },
  failed:     { icon: "❌", ariaLabel: "Failed" },
  not_found:  { icon: "❓", ariaLabel: "Not found" },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface TimelineProps {
  tx: TransactionResult;
  submittedAt?: number;
  /** Override the delayed-confirmation threshold in ms (default 30 000). */
  confirmationWindowMs?: number;
}

export function TransactionTimeline({
  tx,
  submittedAt,
  confirmationWindowMs = 30_000,
}: TimelineProps) {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Re-evaluate the delayed flag every second while pending.
  useEffect(() => {
    const isLive =
      tx.status === "pending" ||
      (tx.status !== "success" && tx.status !== "failed" && tx.status !== "not_found");
    if (!isLive) return;
    const id = setInterval(forceUpdate, 1_000);
    return () => clearInterval(id);
  }, [tx.status]);

  const timeline = buildTimeline(tx, submittedAt, confirmationWindowMs);

  return (
    <section aria-label={`Transaction timeline for ${tx.hash.slice(0, 8)}…`}>
      <h3 style={{ fontFamily: "monospace", fontSize: "0.9em" }}>
        {tx.hash.slice(0, 12)}…
      </h3>

      {timeline.isDelayed && (
        <p
          role="alert"
          aria-label="Delayed confirmation warning"
          style={{ color: "#6b4a00", background: "#fff8e1", padding: "0.5rem", borderRadius: 4 }}
        >
          ⚠️ Confirmation is taking longer than expected. The network may be congested.
        </p>
      )}

      <ol
        aria-label="Transaction status steps"
        style={{ listStyle: "none", padding: 0, margin: 0 }}
      >
        {timeline.events.map((event, i) => {
          const meta = STEP_META[event.step];
          return (
            <li
              key={i}
              aria-label={`${meta.ariaLabel}${event.timestamp ? ` at ${event.timestamp}` : ""}`}
              style={{ display: "flex", gap: "0.5rem", padding: "0.4rem 0", alignItems: "flex-start" }}
            >
              <span aria-hidden="true" style={{ minWidth: "1.5rem" }}>
                {meta.icon}
              </span>
              <div>
                <strong>{event.label}</strong>
                {event.timestamp && (
                  <time
                    dateTime={event.timestamp}
                    style={{ display: "block", fontSize: "0.8em", color: "#555" }}
                  >
                    {new Date(event.timestamp).toLocaleString()}
                  </time>
                )}
                {event.detail && (
                  <span style={{ display: "block", fontSize: "0.8em", color: "#555" }}>
                    {event.detail}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
