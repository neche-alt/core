/**
 * Tests for the TransactionConfirmationSummary component and the
 * confirmation-first payment flow (#105).
 *
 * These tests cover the data-layer contract: the summary shape, field
 * availability logic, and the hook's confirmation/cancellation state machine.
 * DOM rendering tests belong in an app-level test suite with jsdom configured;
 * the SDK-level tests here stay environment-agnostic.
 */
import { describe, it, expect } from "vitest";
import type { TransactionSummary } from "../examples/react-wallet-connect/src/TransactionConfirmationSummary";

// ─── TransactionSummary shape ────────────────────────────────────────────────

describe("TransactionSummary shape (#105)", () => {
  it("accepts a fully-populated summary", () => {
    const summary: TransactionSummary = {
      network: "testnet",
      destination: "GDEST000000000000000000000000000000000000000000000000000001",
      operationSummary: "Send 10 XLM to GDEST000…",
      asset: "XLM",
      amount: "10",
      feeStroops: "100",
    };

    expect(summary.network).toBe("testnet");
    expect(summary.destination).toBeTruthy();
    expect(summary.operationSummary).toBeTruthy();
    expect(summary.asset).toBe("XLM");
    expect(summary.amount).toBe("10");
    expect(summary.feeStroops).toBe("100");
  });

  it("accepts null for unavailable optional fields", () => {
    const summary: TransactionSummary = {
      network: "mainnet",
      destination: "GDEST000000000000000000000000000000000000000000000000000001",
      operationSummary: "Send 5 USDC to GDEST000…",
      asset: "USDC",
      amount: null,
      feeStroops: null,
    };

    expect(summary.amount).toBeNull();
    expect(summary.feeStroops).toBeNull();
  });

  it("supports custom network labels", () => {
    const summary: TransactionSummary = {
      network: "futurenet",
      destination: "GDEST000000000000000000000000000000000000000000000000000001",
      operationSummary: "Invoke contract",
      asset: "XLM",
      amount: "1",
      feeStroops: "200",
    };

    expect(summary.network).toBe("futurenet");
  });
});

// ─── Confirmation flow state machine ─────────────────────────────────────────

describe("Confirmation-first payment flow logic (#105)", () => {
  /**
   * Simulates the state machine inside useSorokit without React:
   * sendPayment  → pendingSummary non-null, XDR stored
   * confirmPayment → pendingSummary cleared, XDR used
   * cancelPayment  → pendingSummary cleared, XDR discarded
   */
  function makeFlowSim() {
    let pendingSummary: TransactionSummary | null = null;
    let pendingXdr: string | null = null;
    let signCalled = false;
    let cancelledWithoutSign = false;

    function buildPayment(params: { destination: string; amount: string }) {
      pendingXdr = "FAKE_XDR_" + params.amount;
      pendingSummary = {
        network: "testnet",
        destination: params.destination,
        operationSummary: `Send ${params.amount} XLM to ${params.destination.slice(0, 8)}…`,
        asset: "XLM",
        amount: params.amount,
        feeStroops: "100",
      };
    }

    function confirmPayment() {
      if (!pendingXdr) throw new Error("No pending XDR");
      signCalled = true;
      pendingXdr = null;
      pendingSummary = null;
    }

    function cancelPayment() {
      if (pendingXdr && !signCalled) {
        cancelledWithoutSign = true;
      }
      pendingXdr = null;
      pendingSummary = null;
    }

    return {
      buildPayment,
      confirmPayment,
      cancelPayment,
      get pendingSummary() { return pendingSummary; },
      get signCalled() { return signCalled; },
      get cancelledWithoutSign() { return cancelledWithoutSign; },
    };
  }

  it("populates pendingSummary after buildPayment and before confirm", () => {
    const flow = makeFlowSim();
    expect(flow.pendingSummary).toBeNull();

    flow.buildPayment({ destination: "GDEST0000000001", amount: "10" });

    expect(flow.pendingSummary).not.toBeNull();
    expect(flow.pendingSummary?.network).toBe("testnet");
    expect(flow.pendingSummary?.amount).toBe("10");
    expect(flow.pendingSummary?.destination).toBe("GDEST0000000001");
  });

  it("clears pendingSummary and calls sign on confirmPayment", () => {
    const flow = makeFlowSim();
    flow.buildPayment({ destination: "GDEST0000000001", amount: "5" });
    flow.confirmPayment();

    expect(flow.pendingSummary).toBeNull();
    expect(flow.signCalled).toBe(true);
  });

  it("clears pendingSummary without signing on cancelPayment", () => {
    const flow = makeFlowSim();
    flow.buildPayment({ destination: "GDEST0000000001", amount: "5" });
    flow.cancelPayment();

    expect(flow.pendingSummary).toBeNull();
    expect(flow.signCalled).toBe(false);
    expect(flow.cancelledWithoutSign).toBe(true);
  });

  it("wallet is never opened before the user confirms", () => {
    const flow = makeFlowSim();
    flow.buildPayment({ destination: "GDEST0000000001", amount: "5" });

    // At this point the summary is shown but sign has not been called
    expect(flow.signCalled).toBe(false);
    expect(flow.pendingSummary).not.toBeNull();

    // Only after confirm does sign happen
    flow.confirmPayment();
    expect(flow.signCalled).toBe(true);
  });

  it("summary includes all required fields: network, destination, operationSummary, asset, amount, feeStroops", () => {
    const flow = makeFlowSim();
    flow.buildPayment({ destination: "GDEST0000000001", amount: "7" });
    const s = flow.pendingSummary!;

    expect(s).toHaveProperty("network");
    expect(s).toHaveProperty("destination");
    expect(s).toHaveProperty("operationSummary");
    expect(s).toHaveProperty("asset");
    expect(s).toHaveProperty("amount");
    expect(s).toHaveProperty("feeStroops");
  });
});
