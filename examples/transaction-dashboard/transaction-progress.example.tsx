/**
 * Transaction submission progress component example (#133).
 *
 * Maps the simulate → sign → submit → confirm lifecycle from status.ts and
 * transactionQueue.ts events into a step-by-step progress UI. When a fee-bump
 * transaction is used, an extra "fee_bump" step is inserted before "confirm".
 *
 * Usage: drop TransactionProgressTracker into any React app that uses sorokit-core.
 * Wire it up with the useTransactionProgress hook, or construct the step list
 * yourself with buildStepList and drive the props directly.
 *
 * Works against mockClient in tests — see the demo at the bottom of this file.
 */

import { useEffect, useState } from "react";
import type { TransactionQueue, QueueItemStatus } from "../../src/transaction/transactionQueue";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The ordered steps in a Stellar transaction submission lifecycle. */
export type SubmissionStep = "simulate" | "sign" | "submit" | "fee_bump" | "confirm";

export interface StepState {
  /** Step identifier mapped from the lifecycle. */
  step: SubmissionStep;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Current rendering status of this step. */
  status: "pending" | "active" | "completed" | "failed";
  /** Decoded error message if this step failed. */
  errorMessage?: string | undefined;
}

export interface TransactionProgressProps {
  /** Ordered list of steps to render. Build with buildStepList(). */
  steps: StepState[];
  /** The step that is currently executing, or null when idle / done. */
  currentStep: SubmissionStep | null;
  /** Set when any step fails. Points to the failing step and decoded message. */
  error?: { step: SubmissionStep; message: string } | null | undefined;
  /** When true the fee_bump step is visible. */
  includesFeeBump?: boolean | undefined;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<SubmissionStep, string> = {
  simulate: "Simulate",
  sign: "Sign",
  submit: "Submit",
  fee_bump: "Apply Fee Bump",
  confirm: "Confirm",
};

/**
 * Build the ordered step list for a submission.
 *
 * @param includesFeeBump - Include the fee_bump step between submit and confirm.
 */
export function buildStepList(includesFeeBump: boolean): StepState[] {
  const steps: SubmissionStep[] = ["simulate", "sign", "submit"];
  if (includesFeeBump) steps.push("fee_bump");
  steps.push("confirm");

  return steps.map((step) => ({
    step,
    label: STEP_LABELS[step],
    status: "pending",
  }));
}

/**
 * Map a QueueItemStatus to the submission step it corresponds to.
 * "processing" maps to "submit" because that is the active network stage.
 */
function queueStatusToStep(status: QueueItemStatus): SubmissionStep {
  switch (status) {
    case "pending":
      return "simulate";
    case "processing":
      return "submit";
    case "completed":
      return "confirm";
    case "failed":
      return "submit";
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseTransactionProgressResult {
  steps: StepState[];
  currentStep: SubmissionStep | null;
  error: { step: SubmissionStep; message: string } | null;
}

/**
 * React hook that tracks submission progress for a queued transaction.
 *
 * Polls the queue every 500 ms and derives StepState[] from the item's
 * QueueItemStatus. Works against the real TransactionQueue and against
 * mockClient in tests.
 */
export function useTransactionProgress(
  transactionId: string,
  queue: TransactionQueue,
  includesFeeBump = false,
): UseTransactionProgressResult {
  const [result, setResult] = useState<UseTransactionProgressResult>(() => ({
    steps: buildStepList(includesFeeBump),
    currentStep: "simulate",
    error: null,
  }));

  useEffect(() => {
    const intervalId = setInterval(() => {
      const item = queue.getTransaction(transactionId);
      if (!item) return;

      const activeStep = queueStatusToStep(item.status);
      const steps = buildStepList(includesFeeBump).map((s): StepState => {
        const stepOrder: SubmissionStep[] = includesFeeBump
          ? ["simulate", "sign", "submit", "fee_bump", "confirm"]
          : ["simulate", "sign", "submit", "confirm"];
        const activeIdx = stepOrder.indexOf(activeStep);
        const thisIdx = stepOrder.indexOf(s.step);

        if (item.status === "failed" && s.step === activeStep) {
          return { ...s, status: "failed", errorMessage: item.error ?? "Submission failed" };
        }
        if (thisIdx < activeIdx) return { ...s, status: "completed" };
        if (thisIdx === activeIdx && item.status !== "failed") return { ...s, status: "active" };
        return { ...s, status: "pending" };
      });

      const error =
        item.status === "failed"
          ? { step: activeStep, message: item.error ?? "Submission failed" }
          : null;

      const currentStep: SubmissionStep | null =
        item.status === "completed" ? null : activeStep;

      setResult({ steps, currentStep, error });
    }, 500);

    return () => clearInterval(intervalId);
  }, [transactionId, queue, includesFeeBump]);

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step-by-step transaction submission progress tracker.
 *
 * Renders simulate → sign → submit → [fee_bump →] confirm.
 * Highlights the active step, marks completed steps, and shows the decoded
 * error on the failing step.
 */
export function TransactionProgressTracker({
  steps,
  currentStep,
  error,
  includesFeeBump = false,
}: TransactionProgressProps) {
  const visibleSteps = steps.filter(
    (s) => s.step !== "fee_bump" || includesFeeBump,
  );

  return (
    <section aria-label="Transaction submission progress">
      <h3>Submission Progress</h3>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {visibleSteps.map((s) => (
          <li
            key={s.step}
            aria-current={s.status === "active" ? "step" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
          >
            <span aria-hidden="true">
              {s.status === "completed" && "✓"}
              {s.status === "active" && "⟳"}
              {s.status === "failed" && "✗"}
              {s.status === "pending" && "○"}
            </span>
            <span
              style={{
                fontWeight: s.status === "active" ? "bold" : "normal",
                color:
                  s.status === "failed"
                    ? "#c0392b"
                    : s.status === "completed"
                      ? "#27ae60"
                      : s.status === "active"
                        ? "#2980b9"
                        : "#7f8c8d",
              }}
            >
              {s.label}
            </span>
            {s.status === "failed" && s.errorMessage && (
              <span style={{ color: "#c0392b", fontSize: "0.875em" }}>
                — {s.errorMessage}
              </span>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" style={{ color: "#c0392b", marginTop: 8 }}>
          Failed at <strong>{STEP_LABELS[error.step]}</strong>: {error.message}
        </p>
      )}
      {!currentStep && !error && (
        <p style={{ color: "#27ae60" }}>Transaction confirmed ✓</p>
      )}
    </section>
  );
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

/**
 * Demo: wiring TransactionProgressTracker to a live queue.
 *
 * In tests, replace `queue` with a mock queue from mockClient.
 *
 * @example
 * import { createMockClient } from "../../src/testing/mockClient";
 * // The mock queue is accessible via client internals or by injecting a
 * // TransactionQueue stub — see src/tests/transactionProgressComponent.test.ts.
 */
export function TransactionProgressDemo({
  transactionId,
  queue,
  includesFeeBump = false,
}: {
  transactionId: string;
  queue: TransactionQueue;
  includesFeeBump?: boolean;
}) {
  const { steps, currentStep, error } = useTransactionProgress(
    transactionId,
    queue,
    includesFeeBump,
  );

  return (
    <TransactionProgressTracker
      steps={steps}
      currentStep={currentStep}
      error={error}
      includesFeeBump={includesFeeBump}
    />
  );
}
