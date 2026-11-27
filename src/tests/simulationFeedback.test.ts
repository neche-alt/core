/**
 * Soroban simulation feedback tests (#102)
 *
 * Covers:
 * - formatSimulationError for common failure patterns
 * - buildSimulationProgressEvent for success and failure fixtures
 * - buildRpcErrorEvent for network-layer failures
 * - runSimulationWithFeedback progress lifecycle (pending → success / error)
 */

import { describe, it, expect, vi } from "vitest";
import {
  formatSimulationError,
  buildSimulationProgressEvent,
  buildRpcErrorEvent,
  buildPendingEvent,
  runSimulationWithFeedback,
  type SimulationProgressEvent,
} from "../soroban/simulationFeedback";
import type { SimulateTransactionResult } from "../soroban/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUCCESS_RESULT: SimulateTransactionResult = {
  success: true,
  fee: "1000000",
};

const VALIDATION_FAILED_RESULT: SimulateTransactionResult = {
  success: false,
  fee: "0",
  error: "HostError: Error(Contract, #3) insufficient balance",
};

const AUTH_FAILED_RESULT: SimulateTransactionResult = {
  success: false,
  fee: "0",
  error: "HostError: Error(Auth, #1)",
};

// ─── formatSimulationError ────────────────────────────────────────────────────

describe("formatSimulationError", () => {
  it("maps insufficient balance error to actionable message", () => {
    const msg = formatSimulationError("insufficient balance for token transfer");
    expect(msg).toContain("XLM");
    expect(msg).toContain("fees");
  });

  it("maps trustline error to actionable message", () => {
    const msg = formatSimulationError("No trust line found for asset");
    expect(msg.toLowerCase()).toContain("trustline");
  });

  it("maps auth error to actionable message", () => {
    const msg = formatSimulationError("Authorization failed");
    expect(msg.toLowerCase()).toContain("authoriz");
  });

  it("maps contract not found error", () => {
    const msg = formatSimulationError("contract not found on ledger");
    expect(msg.toLowerCase()).toContain("contract");
    expect(msg.toLowerCase()).toContain("contract id");
  });

  it("maps timeout error", () => {
    const msg = formatSimulationError("connection timed out");
    expect(msg.toLowerCase()).toContain("time");
  });

  it("returns generic fallback for unknown errors", () => {
    const msg = formatSimulationError("some completely unknown error xyz");
    expect(msg).toContain("some completely unknown error");
  });

  it("handles undefined gracefully", () => {
    const msg = formatSimulationError(undefined);
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe("string");
  });

  it("truncates very long raw errors", () => {
    const longError = "x".repeat(300);
    const msg = formatSimulationError(longError);
    expect(msg.length).toBeLessThan(300);
  });
});

// ─── buildSimulationProgressEvent ────────────────────────────────────────────

describe("buildSimulationProgressEvent", () => {
  it("returns success state for a successful simulation", () => {
    const event = buildSimulationProgressEvent(SUCCESS_RESULT);
    expect(event.state).toBe("success");
    expect(event.fee).toBe("1000000");
    expect(event.message).toBeTruthy();
    // Must not imply guaranteed execution
    expect(event.message.toLowerCase()).not.toContain("guaranteed");
  });

  it("includes fee on success", () => {
    const event = buildSimulationProgressEvent(SUCCESS_RESULT);
    expect(event.fee).toBe(SUCCESS_RESULT.fee);
  });

  it("returns validation_failed state for a failed simulation", () => {
    const event = buildSimulationProgressEvent(VALIDATION_FAILED_RESULT);
    expect(event.state).toBe("validation_failed");
    expect(event.fee).toBeUndefined();
  });

  it("surfaces actionable detail for validation failure", () => {
    const event = buildSimulationProgressEvent(VALIDATION_FAILED_RESULT);
    expect(event.detail).toBeTruthy();
    expect(event.detail!.toLowerCase()).toContain("xlm");
  });

  it("preserves rawError for logging purposes", () => {
    const event = buildSimulationProgressEvent(VALIDATION_FAILED_RESULT);
    expect(event.rawError).toBe(VALIDATION_FAILED_RESULT.error);
  });

  it("produces actionable detail for auth failure", () => {
    const event = buildSimulationProgressEvent(AUTH_FAILED_RESULT);
    expect(event.detail!.toLowerCase()).toContain("authoriz");
  });
});

// ─── buildRpcErrorEvent ───────────────────────────────────────────────────────

describe("buildRpcErrorEvent", () => {
  it("returns rpc_error state", () => {
    const event = buildRpcErrorEvent("connection refused");
    expect(event.state).toBe("rpc_error");
  });

  it("surfaces a user-friendly message", () => {
    const event = buildRpcErrorEvent("connection refused");
    expect(event.message).toBeTruthy();
    expect(event.message.toLowerCase()).toContain("rpc");
  });

  it("stores rawError", () => {
    const event = buildRpcErrorEvent("ETIMEDOUT");
    expect(event.rawError).toBe("ETIMEDOUT");
  });
});

// ─── buildPendingEvent ────────────────────────────────────────────────────────

describe("buildPendingEvent", () => {
  it("returns pending state", () => {
    expect(buildPendingEvent().state).toBe("pending");
  });

  it("has a non-empty message", () => {
    expect(buildPendingEvent().message.length).toBeGreaterThan(0);
  });
});

// ─── runSimulationWithFeedback ────────────────────────────────────────────────

describe("runSimulationWithFeedback", () => {
  it("emits pending then success events for a successful simulation", async () => {
    const events: SimulationProgressEvent[] = [];
    const result = await runSimulationWithFeedback(
      async () => ({ status: "ok" as const, data: SUCCESS_RESULT }),
      { onProgress: (e) => events.push(e) },
    );

    expect(events[0]?.state).toBe("pending");
    expect(events[1]?.state).toBe("success");
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("emits pending then rpc_error for a SorokitResult error", async () => {
    const events: SimulationProgressEvent[] = [];
    const result = await runSimulationWithFeedback(
      async () => ({
        status: "error" as const,
        error: { message: "RPC unreachable", code: "NETWORK_ERROR" },
      }),
      { onProgress: (e) => events.push(e) },
    );

    expect(events[0]?.state).toBe("pending");
    expect(events[1]?.state).toBe("rpc_error");
    expect(result).toBeNull();
  });

  it("emits validation_failed for a simulation success: false result", async () => {
    const events: SimulationProgressEvent[] = [];
    await runSimulationWithFeedback(
      async () => ({ status: "ok" as const, data: VALIDATION_FAILED_RESULT }),
      { onProgress: (e) => events.push(e) },
    );

    expect(events[1]?.state).toBe("validation_failed");
  });

  it("handles thrown exceptions gracefully", async () => {
    const events: SimulationProgressEvent[] = [];
    const result = await runSimulationWithFeedback(
      async () => { throw new Error("unexpected crash"); },
      { onProgress: (e) => events.push(e) },
    );

    expect(events[1]?.state).toBe("rpc_error");
    expect(result).toBeNull();
  });

  it("handles plain SimulateTransactionResult shape (no status field)", async () => {
    const events: SimulationProgressEvent[] = [];
    await runSimulationWithFeedback(
      async () => SUCCESS_RESULT,
      { onProgress: (e) => events.push(e) },
    );

    expect(events[1]?.state).toBe("success");
  });
});
