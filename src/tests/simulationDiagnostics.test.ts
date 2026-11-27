import { describe, it, expect } from "vitest";
import {
  summarizeSimulationDiagnostics,
  SIMULATION_RESOURCE_FIELDS,
  SIMULATION_FEE_FIELDS,
  SIMULATION_DIAGNOSTIC_FIELDS,
} from "../soroban/simulationDiagnostics";
import type {
  SimulateTransactionResult,
  SorobanSimulationResourceUsage,
  SorobanSimulationFeeBreakdown,
} from "../soroban/types";

/**
 * Mirrors the exact shape `simulateTransaction` produces when the RPC exposes
 * full resource and fee information (see soroban.test.ts "returns resource
 * usage and fee breakdown when RPC exposes them").
 */
function completeResult(): SimulateTransactionResult {
  const resourceUsage: SorobanSimulationResourceUsage = {
    instructions: "50000",
    readBytes: 128,
    writeBytes: 64,
    readLedgerEntries: 1,
    writeLedgerEntries: 1,
    footprint: { readOnly: 1, readWrite: 1 },
  };
  const feeBreakdown: SorobanSimulationFeeBreakdown = {
    minResourceFee: "1200",
    refundableFee: "200",
    nonRefundableFee: "1000",
    total: "1200",
  };
  return { success: true, fee: "1200", resourceUsage, feeBreakdown };
}

/**
 * Mirrors the shape produced when the RPC returns only `minResourceFee`
 * (see soroban.test.ts "emits warning and does not synthesize zero values").
 * The response is missing expected resource fields, so validation reports
 * `missingFields` and `warning`.
 */
function partialResult(): SimulateTransactionResult {
  const resourceUsage: SorobanSimulationResourceUsage = {
    missingFields: ["cost", "transactionData"],
    warning:
      "[sorokit] extractResourceUsage: RPC response is missing expected resource fields (cost, transactionData). Resource usage estimates may be incomplete.",
  };
  const feeBreakdown: SorobanSimulationFeeBreakdown = {
    minResourceFee: "1000",
    total: "1000",
  };
  return {
    success: true,
    fee: "1000",
    resourceUsage,
    feeBreakdown,
    warning: resourceUsage.warning,
  };
}

/** Mirrors the shape produced when the simulation itself fails. */
function failedResult(): SimulateTransactionResult {
  return { success: false, fee: "0", error: "HostFunctionError: contract call failed" };
}

describe("summarizeSimulationDiagnostics — supported field catalog", () => {
  it("lists resource and fee fields in a stable order", () => {
    expect([...SIMULATION_RESOURCE_FIELDS]).toEqual([
      "instructions",
      "readBytes",
      "writeBytes",
      "readLedgerEntries",
      "writeLedgerEntries",
    ]);
    expect([...SIMULATION_FEE_FIELDS]).toEqual([
      "minResourceFee",
      "refundableFee",
      "nonRefundableFee",
      "total",
    ]);
  });

  it("exposes a combined, de-duplicated diagnostic field catalog", () => {
    expect([...SIMULATION_DIAGNOSTIC_FIELDS]).toEqual([
      ...SIMULATION_RESOURCE_FIELDS,
      ...SIMULATION_FEE_FIELDS,
    ]);
    expect(new Set(SIMULATION_DIAGNOSTIC_FIELDS).size).toBe(
      SIMULATION_DIAGNOSTIC_FIELDS.length,
    );
  });
});

describe("summarizeSimulationDiagnostics — successful (complete) response", () => {
  it("grades a fully-populated response as complete and surfaces every field", () => {
    const diag = summarizeSimulationDiagnostics(completeResult());

    expect(diag.success).toBe(true);
    expect(diag.completeness).toBe("complete");
    expect(diag.resources).toEqual({
      instructions: "50000",
      readBytes: 128,
      writeBytes: 64,
      readLedgerEntries: 1,
      writeLedgerEntries: 1,
    });
    expect(diag.fees).toEqual({
      minResourceFee: "1200",
      refundableFee: "200",
      nonRefundableFee: "1000",
      total: "1200",
    });
    expect(diag.missingFields).toEqual([]);
    expect(diag.presentFields).toEqual([
      "instructions",
      "readBytes",
      "writeBytes",
      "readLedgerEntries",
      "writeLedgerEntries",
      "minResourceFee",
      "refundableFee",
      "nonRefundableFee",
      "total",
    ]);
    expect(diag.warning).toBeUndefined();
    expect(diag.error).toBeUndefined();
  });
});

describe("summarizeSimulationDiagnostics — partial response", () => {
  it("grades a response with missing resource fields as partial", () => {
    const diag = summarizeSimulationDiagnostics(partialResult());

    expect(diag.success).toBe(true);
    expect(diag.completeness).toBe("partial");
    expect(diag.missingFields).toEqual(["cost", "transactionData"]);
    expect(diag.resources).toEqual({});
    expect(diag.fees).toEqual({ minResourceFee: "1000", total: "1000" });
    expect(diag.presentFields).toEqual(["minResourceFee", "total"]);
    expect(diag.warning).toContain("cost");
  });

  it("does not fabricate zero values for missing resource fields", () => {
    const diag = summarizeSimulationDiagnostics(partialResult());

    expect(diag.resources.instructions).toBeUndefined();
    expect(diag.resources.readBytes).toBeUndefined();
    expect(diag.resources.writeBytes).toBeUndefined();
  });
});

describe("summarizeSimulationDiagnostics — absent (failed) response", () => {
  it("grades a failed simulation as absent and forwards the error", () => {
    const diag = summarizeSimulationDiagnostics(failedResult());

    expect(diag.success).toBe(false);
    expect(diag.completeness).toBe("absent");
    expect(diag.resources).toEqual({});
    expect(diag.fees).toEqual({});
    expect(diag.presentFields).toEqual([]);
    expect(diag.missingFields).toEqual([]);
    expect(diag.error).toBe("HostFunctionError: contract call failed");
  });
});

describe("summarizeSimulationDiagnostics — boundary cases", () => {
  it("grades a successful response with no diagnostic fields and no reported missing fields as absent", () => {
    // success: true but neither resourceUsage nor feeBreakdown surfaced any
    // values, and validation reported nothing missing — there is simply
    // nothing to diagnose.
    const result: SimulateTransactionResult = { success: true, fee: "0" };
    const diag = summarizeSimulationDiagnostics(result);

    expect(diag.success).toBe(true);
    expect(diag.completeness).toBe("absent");
    expect(diag.presentFields).toEqual([]);
    expect(diag.missingFields).toEqual([]);
  });

  it("treats a partial response (missing fields) as partial even when some fee fields are present", () => {
    const result: SimulateTransactionResult = {
      success: true,
      fee: "1000",
      resourceUsage: { missingFields: ["instructions"] },
      feeBreakdown: { minResourceFee: "1000", total: "1000" },
    };
    const diag = summarizeSimulationDiagnostics(result);

    expect(diag.completeness).toBe("partial");
    expect(diag.missingFields).toEqual(["instructions"]);
    expect(diag.presentFields).toEqual(["minResourceFee", "total"]);
  });
});

describe("summarizeSimulationDiagnostics — stability guarantees", () => {
  it("produces a plain, JSON-serializable object with no functions", () => {
    const diag = summarizeSimulationDiagnostics(completeResult());
    const serialised = JSON.parse(JSON.stringify(diag));

    expect(serialised.completeness).toBe("complete");
    expect(serialised.resources.instructions).toBe("50000");
    expect(serialised.fees.minResourceFee).toBe("1200");
    // The always-present keys are stable; optional warning/error are omitted
    // when the simulation succeeds cleanly.
    expect(Object.keys(serialised).sort()).toEqual(
      [
        "completeness",
        "fees",
        "missingFields",
        "presentFields",
        "resources",
        "success",
      ].sort(),
    );
  });

  it("includes warning and error keys only when the source result sets them", () => {
    const partial = summarizeSimulationDiagnostics(partialResult());
    expect("warning" in partial).toBe(true);
    expect("error" in partial).toBe(false);

    const failed = summarizeSimulationDiagnostics(failedResult());
    expect("error" in failed).toBe(true);
    expect("warning" in failed).toBe(false);

    const complete = summarizeSimulationDiagnostics(completeResult());
    expect("warning" in complete).toBe(false);
    expect("error" in complete).toBe(false);
  });

  it("does not mutate the input result", () => {
    const result = completeResult();
    const snapshot = JSON.parse(JSON.stringify(result));
    summarizeSimulationDiagnostics(result);

    expect(JSON.parse(JSON.stringify(result))).toEqual(snapshot);
  });

  it("every value in presentFields is a declared diagnostic field", () => {
    const allowed = new Set<string>(SIMULATION_DIAGNOSTIC_FIELDS);
    const diag = summarizeSimulationDiagnostics(completeResult());

    expect(diag.presentFields.every((f) => allowed.has(f))).toBe(true);
  });
});
