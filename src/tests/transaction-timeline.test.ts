import { describe, it, expect } from "vitest";
import type { TransactionResult } from "../transaction/types";

/**
 * Tests for transaction status timeline logic (#92).
 *
 * Tests the pure timeline helpers (mirrored from the example component) for
 * correct event construction across all SDK status values, including delayed
 * confirmation detection and boundary cases.
 */

// ─── Helpers mirrored from examples/transaction-dashboard/transaction-timeline.tsx ──

type TimelineStep =
  | "signing"
  | "submitted"
  | "pending"
  | "confirming"
  | "success"
  | "failed"
  | "not_found";

interface TimelineEvent {
  step: TimelineStep;
  timestamp?: string;
  label: string;
  detail?: string;
}

interface TransactionTimeline {
  txHash: string;
  events: TimelineEvent[];
  currentStep: TimelineStep;
  isDelayed: boolean;
}

function sdkStatusToStep(status: TransactionResult["status"]): TimelineStep {
  switch (status) {
    case "success":   return "success";
    case "failed":    return "failed";
    case "pending":   return "pending";
    case "not_found": return "not_found";
    default:          return "submitted";
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_TX: TransactionResult = {
  hash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  status: "success",
  createdAt: "2024-01-15T10:00:00Z",
  fee: "100",
  envelopeXdr: "",
  resultXdr: "",
  ledger: 42,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("sdkStatusToStep", () => {
  it("maps success to success", () => expect(sdkStatusToStep("success")).toBe("success"));
  it("maps failed to failed",   () => expect(sdkStatusToStep("failed")).toBe("failed"));
  it("maps pending to pending", () => expect(sdkStatusToStep("pending")).toBe("pending"));
  it("maps not_found to not_found", () => expect(sdkStatusToStep("not_found")).toBe("not_found"));
});

describe("buildTimeline — success path", () => {
  it("produces confirming and success steps", () => {
    const tl = buildTimeline(BASE_TX);
    const steps = tl.events.map((e) => e.step);
    expect(steps).toContain("confirming");
    expect(steps).toContain("success");
    expect(tl.currentStep).toBe("success");
  });

  it("includes ledger number in confirming detail", () => {
    const tl = buildTimeline(BASE_TX);
    const confirming = tl.events.find((e) => e.step === "confirming");
    expect(confirming?.detail).toContain("42");
  });

  it("omits ledger detail when ledger is undefined", () => {
    const tx = { ...BASE_TX, ledger: undefined };
    const tl = buildTimeline(tx);
    const confirming = tl.events.find((e) => e.step === "confirming");
    expect(confirming?.detail).toBeUndefined();
  });

  it("success event timestamp matches createdAt", () => {
    const tl = buildTimeline(BASE_TX);
    const successEvent = tl.events.find((e) => e.step === "success");
    expect(successEvent?.timestamp).toBe(BASE_TX.createdAt);
  });
});

describe("buildTimeline — failure path", () => {
  it("produces a failed step", () => {
    const tl = buildTimeline({ ...BASE_TX, status: "failed" });
    expect(tl.currentStep).toBe("failed");
    expect(tl.events.some((e) => e.step === "failed")).toBe(true);
  });

  it("failed event timestamp matches createdAt", () => {
    const tl = buildTimeline({ ...BASE_TX, status: "failed" });
    const failedEvent = tl.events.find((e) => e.step === "failed");
    expect(failedEvent?.timestamp).toBe(BASE_TX.createdAt);
  });
});

describe("buildTimeline — pending path", () => {
  it("produces a pending step", () => {
    const tl = buildTimeline({ ...BASE_TX, status: "pending" });
    expect(tl.currentStep).toBe("pending");
    expect(tl.events.some((e) => e.step === "pending")).toBe(true);
  });
});

describe("buildTimeline — not_found path", () => {
  it("produces a not_found step with detail", () => {
    const tl = buildTimeline({ ...BASE_TX, status: "not_found" });
    expect(tl.currentStep).toBe("not_found");
    const ev = tl.events.find((e) => e.step === "not_found");
    expect(ev).toBeDefined();
    expect(ev?.detail).toBeTruthy();
  });
});

describe("buildTimeline — submittedAt", () => {
  it("includes submitted event when submittedAt is provided", () => {
    const tl = buildTimeline(BASE_TX, Date.now() - 5_000);
    expect(tl.events.some((e) => e.step === "submitted")).toBe(true);
  });

  it("submitted event detail contains the tx hash", () => {
    const tl = buildTimeline(BASE_TX, Date.now() - 1_000);
    const ev = tl.events.find((e) => e.step === "submitted");
    expect(ev?.detail).toBe(BASE_TX.hash);
  });

  it("omits submitted event when submittedAt is not provided", () => {
    const tl = buildTimeline(BASE_TX);
    expect(tl.events.some((e) => e.step === "submitted")).toBe(false);
  });
});

describe("buildTimeline — delayed confirmation", () => {
  it("isDelayed is false for completed transactions even when past the window", () => {
    const tl = buildTimeline(BASE_TX, Date.now() - 60_000);
    expect(tl.isDelayed).toBe(false);
  });

  it("isDelayed is true for pending transactions past the confirmation window", () => {
    const tl = buildTimeline(
      { ...BASE_TX, status: "pending" },
      Date.now() - 60_000,
      30_000,
    );
    expect(tl.isDelayed).toBe(true);
  });

  it("isDelayed is false for pending transactions within the window", () => {
    const tl = buildTimeline(
      { ...BASE_TX, status: "pending" },
      Date.now() - 10_000,
      30_000,
    );
    expect(tl.isDelayed).toBe(false);
  });

  it("pending event detail mentions delay when isDelayed", () => {
    const tl = buildTimeline(
      { ...BASE_TX, status: "pending" },
      Date.now() - 60_000,
      30_000,
    );
    const ev = tl.events.find((e) => e.step === "pending");
    expect(ev?.detail).toContain("longer than expected");
  });

  it("pending event detail is undefined when not delayed", () => {
    const tl = buildTimeline(
      { ...BASE_TX, status: "pending" },
      Date.now() - 5_000,
      30_000,
    );
    const ev = tl.events.find((e) => e.step === "pending");
    expect(ev?.detail).toBeUndefined();
  });
});
