/**
 * Simulation resource and fee diagnostics (#42).
 *
 * A Soroban RPC simulation response carries resource and fee information that
 * helps a caller diagnose an invocation before signing — how many CPU
 * instructions it will burn, how much ledger storage it will read and write,
 * and the minimum resource fee the network will charge.
 *
 * `simulateTransaction()` already exposes those values on its
 * `SimulateTransactionResult` (`resourceUsage` and `feeBreakdown`), but the
 * shape is spread across two optional objects whose presence varies with the
 * RPC response. `summarizeSimulationDiagnostics()` consolidates them into a
 * single, fully-serializable summary with an explicit completeness grade, so a
 * caller has one stable object to inspect, log, or surface to a user before
 * asking for a signature.
 *
 * This module is additive: it reads existing fields and never mutates the
 * underlying `SimulateTransactionResult`.
 */

import type {
  SimulateTransactionResult,
  SorobanSimulationFeeBreakdown,
  SorobanSimulationResourceUsage,
} from "./types";

/**
 * The ledger-resource fields a simulation can surface, in stable order.
 */
export const SIMULATION_RESOURCE_FIELDS = [
  "instructions",
  "readBytes",
  "writeBytes",
  "readLedgerEntries",
  "writeLedgerEntries",
] as const;

/** A supported ledger-resource diagnostic field. */
export type SimulationResourceField = (typeof SIMULATION_RESOURCE_FIELDS)[number];

/**
 * The fee-component fields a simulation can surface, in stable order.
 */
export const SIMULATION_FEE_FIELDS = [
  "minResourceFee",
  "refundableFee",
  "nonRefundableFee",
  "total",
] as const;

/** A supported fee-component diagnostic field. */
export type SimulationFeeField = (typeof SIMULATION_FEE_FIELDS)[number];

/** Every supported simulation diagnostic field key. */
export const SIMULATION_DIAGNOSTIC_FIELDS = [
  ...SIMULATION_RESOURCE_FIELDS,
  ...SIMULATION_FEE_FIELDS,
] as const;

/** A supported simulation diagnostic field. */
export type SimulationDiagnosticField =
  | SimulationResourceField
  | SimulationFeeField;

/** Ledger-resource usage surfaced from a simulation, normalized to plain values. */
export interface SimulationResourceDiagnostics {
  /** CPU instructions consumed (kept as a string to preserve precision). */
  instructions?: string;
  /** Bytes read from ledger storage. */
  readBytes?: number;
  /** Bytes written to ledger storage. */
  writeBytes?: number;
  /** Number of ledger entries read. */
  readLedgerEntries?: number;
  /** Number of ledger entries written. */
  writeLedgerEntries?: number;
}

/** Fee components surfaced from a simulation, in stroops. */
export interface SimulationFeeDiagnostics {
  /** Minimum resource fee the RPC recommends for the assembled transaction. */
  minResourceFee?: string;
  /** Refundable portion of the fee, when the RPC reports it. */
  refundableFee?: string;
  /** Non-refundable portion of the fee, when the RPC reports it. */
  nonRefundableFee?: string;
  /** Total fee, when the RPC reports it. */
  total?: string;
}

/** How complete the surfaced diagnostics are. */
export type SimulationDiagnosticsCompleteness = "complete" | "partial" | "absent";

/**
 * A stable, serializable summary of the resource and fee diagnostics for one
 * simulation. Build it with {@link summarizeSimulationDiagnostics} and inspect
 * it before asking the user to sign.
 */
export interface SimulationDiagnostics {
  /** Whether the underlying simulation succeeded. */
  success: boolean;
  /** Completeness of the surfaced diagnostic fields. */
  completeness: SimulationDiagnosticsCompleteness;
  /** Ledger resource usage, normalized from the simulation response. */
  resources: SimulationResourceDiagnostics;
  /** Fee components, normalized from the simulation response. */
  fees: SimulationFeeDiagnostics;
  /** Diagnostic field keys that have a value. */
  presentFields: SimulationDiagnosticField[];
  /**
   * Diagnostic field keys the RPC response was expected to contain but did
   * not. Populated from `resourceUsage.missingFields` so callers can tell a
   * genuinely empty result apart from a malformed one.
   */
  missingFields: string[];
  /** Human-readable warning produced when the response was incomplete. */
  warning?: string;
  /** Error message produced when the simulation failed. */
  error?: string;
}

function collectResources(
  usage: SorobanSimulationResourceUsage | undefined,
  resources: SimulationResourceDiagnostics,
  presentFields: SimulationDiagnosticField[],
): string[] {
  if (!usage) return [];
  const missing: string[] = Array.isArray(usage.missingFields)
    ? usage.missingFields.slice()
    : [];

  if (usage.instructions !== undefined) {
    resources.instructions = usage.instructions;
    presentFields.push("instructions");
  }
  if (usage.readBytes !== undefined) {
    resources.readBytes = usage.readBytes;
    presentFields.push("readBytes");
  }
  if (usage.writeBytes !== undefined) {
    resources.writeBytes = usage.writeBytes;
    presentFields.push("writeBytes");
  }
  if (usage.readLedgerEntries !== undefined) {
    resources.readLedgerEntries = usage.readLedgerEntries;
    presentFields.push("readLedgerEntries");
  }
  if (usage.writeLedgerEntries !== undefined) {
    resources.writeLedgerEntries = usage.writeLedgerEntries;
    presentFields.push("writeLedgerEntries");
  }

  return missing;
}

function collectFees(
  breakdown: SorobanSimulationFeeBreakdown | undefined,
  fees: SimulationFeeDiagnostics,
  presentFields: SimulationDiagnosticField[],
): void {
  if (!breakdown) return;
  if (breakdown.minResourceFee !== undefined) {
    fees.minResourceFee = breakdown.minResourceFee;
    presentFields.push("minResourceFee");
  }
  if (breakdown.refundableFee !== undefined) {
    fees.refundableFee = breakdown.refundableFee;
    presentFields.push("refundableFee");
  }
  if (breakdown.nonRefundableFee !== undefined) {
    fees.nonRefundableFee = breakdown.nonRefundableFee;
    presentFields.push("nonRefundableFee");
  }
  if (breakdown.total !== undefined) {
    fees.total = breakdown.total;
    presentFields.push("total");
  }
}

/**
 * Build a stable, serializable diagnostic summary from a simulation result.
 *
 * The summary consolidates `resourceUsage` and `feeBreakdown` into a single
 * object with an explicit {@link SimulationDiagnostics.completeness} grade:
 *
 * - `"absent"` — the simulation failed, or no diagnostic fields were surfaced.
 * - `"partial"` — the simulation succeeded but the RPC response was missing
 *   expected resource fields (see `missingFields`).
 * - `"complete"` — the simulation succeeded and all expected fields are present.
 *
 * The function is pure: it reads `result` and never mutates it. The returned
 * object contains only plain values (no functions), so it is safe to
 * `JSON.stringify`, log, or hand to a UI before signing.
 *
 * @param result - The `SimulateTransactionResult` returned by `simulateTransaction`.
 * @returns A consolidated, stable diagnostic summary.
 *
 * @example
 * ```ts
 * import { simulateTransaction, summarizeSimulationDiagnostics } from "sorokit-core";
 *
 * const result = await simulateTransaction(rpcUrl, passphrase, transactionXdr);
 * if (result.status === "ok") {
 *   const diag = summarizeSimulationDiagnostics(result.data);
 *   // diag.completeness === "complete" | "partial" | "absent"
 *   console.log(diag.resources.instructions, diag.fees.minResourceFee);
 * }
 * ```
 */
export function summarizeSimulationDiagnostics(
  result: SimulateTransactionResult,
): SimulationDiagnostics {
  const resources: SimulationResourceDiagnostics = {};
  const fees: SimulationFeeDiagnostics = {};
  const presentFields: SimulationDiagnosticField[] = [];

  const missingFields = collectResources(
    result.resourceUsage,
    resources,
    presentFields,
  );
  collectFees(result.feeBreakdown, fees, presentFields);

  let completeness: SimulationDiagnosticsCompleteness;
  if (!result.success) {
    completeness = "absent";
  } else if (missingFields.length > 0) {
    completeness = "partial";
  } else if (presentFields.length === 0) {
    completeness = "absent";
  } else {
    completeness = "complete";
  }

  const summary: SimulationDiagnostics = {
    success: result.success,
    completeness,
    resources,
    fees,
    presentFields,
    missingFields,
  };
  if (result.warning !== undefined) summary.warning = result.warning;
  if (result.error !== undefined) summary.error = result.error;
  return summary;
}
