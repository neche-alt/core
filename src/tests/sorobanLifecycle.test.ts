/**
 * Tests for the Soroban simulation-to-submission lifecycle (#37).
 *
 * Covers: happy path, prepare failure, sign failure, execute failure,
 * standalone simulation, and the distinction between sim success/failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/soroban/prepareCall", () => ({
  prepareContractCall: vi.fn(),
}));

vi.mock("../../src/soroban/executeContract", () => ({
  executeContract: vi.fn(),
}));

vi.mock("../../src/soroban/simulateTransaction", () => ({
  simulateTransaction: vi.fn(),
}));

import { prepareContractCall } from "../../src/soroban/prepareCall";
import { executeContract } from "../../src/soroban/executeContract";
import { simulateTransaction } from "../../src/soroban/simulateTransaction";
import {
  runLifecycle,
  estimateFeeBeforeInvoke,
} from "../../examples/soroban-lifecycle/src/invokeLifecycle";
import type { LifecycleInput } from "../../examples/soroban-lifecycle/src/invokeLifecycle";

const mockPrepare = vi.mocked(prepareContractCall);
const mockExecute = vi.mocked(executeContract);
const mockSimulate = vi.mocked(simulateTransaction);

// ── Helpers ───────────────────────────────────────────────────────────────────

function okResult<T>(data: T) {
  return Object.freeze({ status: "ok" as const, data, error: null });
}

function errResult(code: string, message: string) {
  return Object.freeze({
    status: "error" as const,
    data: null,
    error: {
      code,
      message,
      category: "contract" as const,
      recovery: { retryable: false, action: "inspect" },
    },
  });
}

const PREPARED = { transactionXdr: "AAABBB==", fee: "1000" };
const TX_HASH = "deadbeefdeadbeef";

function makeInput(overrides: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    rpcUrl: "https://rpc.example.com",
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon.example.com",
    params: {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      method: "hello",
      args: [],
      publicKey: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    },
    signFn: vi.fn().mockResolvedValue("SIGNED=="),
    ...overrides,
  };
}

beforeEach(() => {
  mockPrepare.mockReset();
  mockExecute.mockReset();
  mockSimulate.mockReset();
});

// ── runLifecycle — happy path ─────────────────────────────────────────────────

describe("runLifecycle — happy path", () => {
  it("returns ok with txHash and prepared data", async () => {
    mockPrepare.mockResolvedValue(okResult(PREPARED));
    mockExecute.mockResolvedValue(okResult(TX_HASH));

    const result = await runLifecycle(makeInput());

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.txHash).toBe(TX_HASH);
    expect(result.data.prepared).toEqual(PREPARED);
  });

  it("passes prepared XDR to signFn", async () => {
    mockPrepare.mockResolvedValue(okResult(PREPARED));
    mockExecute.mockResolvedValue(okResult(TX_HASH));
    const signFn = vi.fn().mockResolvedValue("SIGNED==");

    await runLifecycle(makeInput({ signFn }));

    expect(signFn).toHaveBeenCalledWith(PREPARED.transactionXdr);
  });

  it("passes signed XDR to executeContract", async () => {
    mockPrepare.mockResolvedValue(okResult(PREPARED));
    mockExecute.mockResolvedValue(okResult(TX_HASH));
    const signFn = vi.fn().mockResolvedValue("SIGNED_XDR==");

    await runLifecycle(makeInput({ signFn }));

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ networkPassphrase: "Test SDF Network ; September 2015" }),
      "SIGNED_XDR==",
      undefined,
    );
  });
});

// ── runLifecycle — prepare failure ───────────────────────────────────────────

describe("runLifecycle — prepare failure", () => {
  it("returns the prepare error without calling signFn or executeContract", async () => {
    mockPrepare.mockResolvedValue(
      errResult("CONTRACT_PREPARE_FAILED", "Invalid contract ID"),
    );
    const signFn = vi.fn();

    const result = await runLifecycle(makeInput({ signFn }));

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("CONTRACT_PREPARE_FAILED");
    expect(signFn).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── runLifecycle — sign failure ──────────────────────────────────────────────

describe("runLifecycle — sign failure", () => {
  it("returns WALLET_SIGN_FAILED when signFn throws", async () => {
    mockPrepare.mockResolvedValue(okResult(PREPARED));
    const signFn = vi.fn().mockRejectedValue(new Error("user rejected"));

    const result = await runLifecycle(makeInput({ signFn }));

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("WALLET_SIGN_FAILED");
    expect(result.error.message).toContain("user rejected");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns WALLET_SIGN_FAILED when signFn returns empty string", async () => {
    mockPrepare.mockResolvedValue(okResult(PREPARED));
    const signFn = vi.fn().mockResolvedValue("");

    const result = await runLifecycle(makeInput({ signFn }));

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("WALLET_SIGN_FAILED");
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── runLifecycle — execute failure ───────────────────────────────────────────

describe("runLifecycle — execute failure", () => {
  it("returns the execute error", async () => {
    mockPrepare.mockResolvedValue(okResult(PREPARED));
    mockExecute.mockResolvedValue(
      errResult("CONTRACT_INVOKE_FAILED", "Transaction failed on-chain"),
    );

    const result = await runLifecycle(makeInput());

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("CONTRACT_INVOKE_FAILED");
  });
});

// ── estimateFeeBeforeInvoke ───────────────────────────────────────────────────

describe("estimateFeeBeforeInvoke", () => {
  it("returns the simulation result when simulation succeeds", async () => {
    const simData = { success: true, fee: "500", resourceUsage: {} };
    mockSimulate.mockResolvedValue(okResult(simData));

    const result = await estimateFeeBeforeInvoke(
      "https://rpc.example.com",
      "Test SDF Network ; September 2015",
      "AAABBB==",
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.fee).toBe("500");
  });

  it("returns TX_SIMULATE_FAILED when simulation reports a contract error", async () => {
    const simData = { success: false, fee: "0", error: "contract panicked" };
    mockSimulate.mockResolvedValue(okResult(simData));

    const result = await estimateFeeBeforeInvoke(
      "https://rpc.example.com",
      "Test SDF Network ; September 2015",
      "AAABBB==",
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("TX_SIMULATE_FAILED");
    expect(result.error.message).toContain("contract panicked");
  });

  it("propagates the error when simulateTransaction itself fails", async () => {
    mockSimulate.mockResolvedValue(
      errResult("TX_SIMULATE_FAILED", "RPC unreachable"),
    );

    const result = await estimateFeeBeforeInvoke(
      "https://rpc.example.com",
      "Test SDF Network ; September 2015",
      "AAABBB==",
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.message).toContain("RPC unreachable");
  });

  it("distinguishes simulation success from ledger-confirmed execution", async () => {
    // A successful simulation does NOT mean the tx was included on-chain.
    // The result has no txHash — only runLifecycle returns a confirmed hash.
    const simData = { success: true, fee: "800" };
    mockSimulate.mockResolvedValue(okResult(simData));

    const result = await estimateFeeBeforeInvoke(
      "https://rpc.example.com",
      "Test SDF Network ; September 2015",
      "AAABBB==",
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // No txHash on a simulation result — that only comes from executeContract.
    expect((result.data as Record<string, unknown>)["txHash"]).toBeUndefined();
  });
});
