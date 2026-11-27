/**
 * User-friendly Soroban simulation feedback (#102)
 *
 * Formats simulation progress and failure details so callers can present
 * actionable messages to users before asking them to sign a transaction.
 *
 * Key design constraints:
 * - Never implies that a successful simulation guarantees execution.
 * - Validation failures surface specific actionable details rather than
 *   opaque error codes.
 * - Works with the existing SimulateTransactionResult shape without altering it.
 */

import type { SimulateTransactionResult } from "./types";

// ─── Progress events ──────────────────────────────────────────────────────────

export type SimulationProgressState =
  | "pending"
  | "success"
  | "validation_failed"
  | "rpc_error";

export interface SimulationProgressEvent {
  /** Current state of the simulation step. */
  state: SimulationProgressState;
  /**
   * Human-readable message safe to display in a UI.
   * Always present. Use it as the primary display label.
   */
  message: string;
  /**
   * Estimated fee from simulation in stroops (string, same as the SDK).
   * Present when state is "success".
   */
  fee?: string;
  /**
   * Actionable detail for validation or RPC failures.
   * Present when state is "validation_failed" or "rpc_error".
   */
  detail?: string;
  /**
   * Raw error string from the RPC layer, for logging or advanced UIs.
   * Never surfaced directly in a user-facing message.
   */
  rawError?: string;
}

export type SimulationProgressCallback = (
  event: SimulationProgressEvent,
) => void;

// ─── Formatter ────────────────────────────────────────────────────────────────

/**
 * Convert a raw simulation error string into a short, actionable sentence.
 *
 * The RPC returns opaque strings like "HostError: Error(Contract, #3)". This
 * function maps common patterns to messages that tell the user what to do.
 */
export function formatSimulationError(rawError: string | undefined): string {
  if (!rawError) return "Simulation failed for an unknown reason.";

  const lower = rawError.toLowerCase();

  if (lower.includes("insufficient balance") || lower.includes("underfunded")) {
    return "Your account does not have enough XLM to cover this transaction and its fees.";
  }
  if (lower.includes("no trust") || lower.includes("trustline")) {
    return "A required trustline is missing. Add it before retrying.";
  }
  if (lower.includes("auth") || lower.includes("authorization")) {
    return "The contract requires additional authorization. Check that the correct account is signing.";
  }
  if (lower.includes("contract not found") || lower.includes("not_found")) {
    return "The contract could not be found on the network. Confirm the contract ID is correct.";
  }
  if (lower.includes("storage_limit") || lower.includes("memory")) {
    return "The transaction exceeds the contract storage or memory limit.";
  }
  if (lower.includes("cpu") || lower.includes("instruction")) {
    return "The transaction exceeds the CPU instruction limit for a single Soroban call.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The simulation request timed out. Check your network connection and try again.";
  }
  if (lower.includes("xdr") || lower.includes("malformed")) {
    return "The transaction is malformed. This is likely a bug — please report it.";
  }

  // Generic fallback with a trimmed version of the raw message so advanced
  // users still have something to work with.
  const trimmed = rawError.length > 120 ? `${rawError.slice(0, 120)}…` : rawError;
  return `Simulation failed: ${trimmed}`;
}

/**
 * Build a SimulationProgressEvent from a completed SimulateTransactionResult.
 *
 * Call this after `simulateTransaction` resolves to get a UI-ready event.
 */
export function buildSimulationProgressEvent(
  result: SimulateTransactionResult,
): SimulationProgressEvent {
  if (result.success) {
    return {
      state: "success",
      message:
        "Simulation succeeded. Review the estimated fee below, then approve to submit.",
      fee: result.fee,
    };
  }

  const detail = formatSimulationError(result.error);
  return {
    state: "validation_failed",
    message: "Simulation validation failed. See details below before retrying.",
    detail,
    rawError: result.error,
  };
}

/**
 * Build a SimulationProgressEvent for an RPC-level failure (network error,
 * timeout, etc.) where no SimulateTransactionResult is available.
 */
export function buildRpcErrorEvent(errorMessage: string): SimulationProgressEvent {
  return {
    state: "rpc_error",
    message:
      "Could not reach the Soroban RPC node. Check your connection and try again.",
    detail: formatSimulationError(errorMessage),
    rawError: errorMessage,
  };
}

/** Returns the event that marks the start of a simulation request. */
export function buildPendingEvent(): SimulationProgressEvent {
  return {
    state: "pending",
    message: "Simulating transaction — estimating fees and validating inputs…",
  };
}

// ─── Orchestration helper ─────────────────────────────────────────────────────

export interface RunSimulationWithFeedbackOptions {
  onProgress: SimulationProgressCallback;
}

/**
 * Wrap any async simulation call with before/after progress events.
 *
 * Usage:
 * ```ts
 * const result = await runSimulationWithFeedback(
 *   () => simulateTransaction(rpcUrl, passphrase, xdr),
 *   { onProgress: (e) => setSimStatus(e) },
 * );
 * ```
 *
 * The caller's `simulate` function may return either a `SorokitResult` or
 * a plain `SimulateTransactionResult`. Both shapes are handled.
 */
export async function runSimulationWithFeedback(
  simulate: () => Promise<
    | { status: "ok"; data: SimulateTransactionResult }
    | { status: "error"; error: { message: string } }
    | SimulateTransactionResult
  >,
  options: RunSimulationWithFeedbackOptions,
): Promise<SimulateTransactionResult | null> {
  const { onProgress } = options;

  onProgress(buildPendingEvent());

  try {
    const raw = await simulate();

    // Handle SorokitResult shape
    if (raw && typeof raw === "object" && "status" in raw) {
      const result = raw as
        | { status: "ok"; data: SimulateTransactionResult }
        | { status: "error"; error: { message: string } };

      if (result.status === "error") {
        onProgress(buildRpcErrorEvent(result.error.message));
        return null;
      }

      onProgress(buildSimulationProgressEvent(result.data));
      return result.data;
    }

    // Handle plain SimulateTransactionResult shape
    const plainResult = raw as SimulateTransactionResult;
    onProgress(buildSimulationProgressEvent(plainResult));
    return plainResult;
  } catch (cause) {
    const msg =
      cause instanceof Error ? cause.message : String(cause);
    onProgress(buildRpcErrorEvent(msg));
    return null;
  }
}
