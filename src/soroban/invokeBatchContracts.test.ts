import { describe, it, expect, vi } from "vitest";
import { invokeBatchContracts } from "./invokeBatchContracts";
import { BATCH_INVOCATION_LIMIT } from "./types";
import type { BatchContractInvocation } from "./types";

// Mock invokeContract so we can control per-invocation outcomes
const { mockInvokeContract } = vi.hoisted(() => ({
  mockInvokeContract: vi.fn(),
}));

vi.mock("./invokeContract", () => ({
  invokeContract: mockInvokeContract,
}));

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_CONFIG = {
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: RPC_URL,
  network: "testnet" as const,
};
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SIGN_FN = async (xdr: string) => xdr;

function makeInvocation(contractId: string, method: string): BatchContractInvocation {
  return { contractId, method, publicKey: "GCFQYP2MMXX2G2PLAQP5ASKP3WBDX6IDXVBOEQOBE7HC3W3N5YX5IGOB" };
}

function makeOkResult(data = "tx-hash") {
  return { status: "ok" as const, data, error: null };
}

function makeErrResult(message: string) {
  return {
    status: "error" as const,
    data: null,
    error: { code: "UNKNOWN", message },
  };
}

describe("invokeBatchContracts", () => {
  it("returns ok with empty results for empty invocations array", async () => {
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, [], SIGN_FN);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toHaveLength(0);
    }
  });

  it("returns error when batch exceeds BATCH_INVOCATION_LIMIT", async () => {
    const tooMany = Array.from({ length: BATCH_INVOCATION_LIMIT + 1 }, (_, i) =>
      makeInvocation(`CONTRACT_${i}`, "method"),
    );
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, tooMany, SIGN_FN);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toMatch(/exceeds the maximum/i);
      expect(result.error.message).toContain(String(BATCH_INVOCATION_LIMIT));
    }
  });

  it("does not call invokeContract when batch size limit is exceeded", async () => {
    mockInvokeContract.mockReset();
    const tooMany = Array.from({ length: BATCH_INVOCATION_LIMIT + 1 }, (_, i) =>
      makeInvocation(`CONTRACT_${i}`, "method"),
    );
    await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, tooMany, SIGN_FN);
    expect(mockInvokeContract).not.toHaveBeenCalled();
  });

  it("returns ok results for all successful invocations", async () => {
    mockInvokeContract.mockReset();
    mockInvokeContract.mockResolvedValue(makeOkResult("hash-1"));

    const invocations = [
      makeInvocation("C1", "transfer"),
      makeInvocation("C2", "mint"),
    ];
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, invocations, SIGN_FN);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].status).toBe("ok");
      expect(result.data[1].status).toBe("ok");
    }
  });

  it("captures per-invocation failures in mixed success/failure batch", async () => {
    mockInvokeContract.mockReset();
    mockInvokeContract
      .mockResolvedValueOnce(makeOkResult("hash-ok"))
      .mockResolvedValueOnce(makeErrResult("insufficient funds"));

    const invocations = [
      makeInvocation("C1", "transfer"),
      makeInvocation("C2", "burn"),
    ];
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, invocations, SIGN_FN);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].status).toBe("ok");
      expect(result.data[1].status).toBe("error");
      if (result.data[1].status === "error") {
        expect(result.data[1].error.message).toContain("insufficient funds");
      }
    }
  });

  it("preserves contractId and method on each result for correlation", async () => {
    mockInvokeContract.mockReset();
    mockInvokeContract.mockResolvedValue(makeOkResult("hash"));

    const invocations = [makeInvocation("CONTRACT_A", "swap")];
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, invocations, SIGN_FN);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].contractId).toBe("CONTRACT_A");
      expect(result.data[0].method).toBe("swap");
    }
  });

  it("returns results in the same order as invocations", async () => {
    mockInvokeContract.mockReset();
    mockInvokeContract
      .mockResolvedValueOnce(makeOkResult("first"))
      .mockResolvedValueOnce(makeErrResult("second fails"))
      .mockResolvedValueOnce(makeOkResult("third"));

    const invocations = [
      makeInvocation("C1", "a"),
      makeInvocation("C2", "b"),
      makeInvocation("C3", "c"),
    ];
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, invocations, SIGN_FN);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].contractId).toBe("C1");
      expect(result.data[1].contractId).toBe("C2");
      expect(result.data[2].contractId).toBe("C3");
    }
  });

  it("accepts a batch exactly at BATCH_INVOCATION_LIMIT", async () => {
    mockInvokeContract.mockReset();
    mockInvokeContract.mockResolvedValue(makeOkResult("hash"));

    const exactly = Array.from({ length: BATCH_INVOCATION_LIMIT }, (_, i) =>
      makeInvocation(`C${i}`, "method"),
    );
    const result = await invokeBatchContracts(RPC_URL, NETWORK_CONFIG, HORIZON_URL, exactly, SIGN_FN);
    expect(result.status).toBe("ok");
  });

  it("BATCH_INVOCATION_LIMIT is a positive integer", () => {
    expect(typeof BATCH_INVOCATION_LIMIT).toBe("number");
    expect(BATCH_INVOCATION_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(BATCH_INVOCATION_LIMIT)).toBe(true);
  });
});
