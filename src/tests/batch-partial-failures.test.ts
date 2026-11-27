/**
 * Batch partial failure tests (#80)
 *
 * Verifies that batch helpers clearly surface partial failures, preserve
 * input/result ordering, and correctly handle timeout and malformed-response
 * scenarios. Per-item versus whole-batch failure semantics are explicitly
 * exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { TransactionResult } from "../transaction/types";
import type { BatchSubmissionResult } from "../transaction/batchSubmitter";

// ─── Mock ─────────────────────────────────────────────────────────────────────

const { mockSubmitTransaction } = vi.hoisted(() => ({
  mockSubmitTransaction: vi.fn(),
}));

vi.mock("../transaction/submitTransaction", () => ({
  submitTransaction: mockSubmitTransaction,
}));

import {
  submitBatch,
  wasAtomicExecuted,
  suggestRetryStrategy,
  generateRollbackInstructions,
  getTransactionStatus,
} from "../transaction/batchSubmitter";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const XDR_A = "AAAAAAAAAA==";
const XDR_B = "AAAAAAAAAB==";
const XDR_C = "AAAAAAAAAC==";
const XDR_D = "AAAAAAAAAD==";

function successResult(hash: string, ledger = 1000): TransactionResult {
  return { hash, status: "success", ledger };
}

beforeEach(() => {
  mockSubmitTransaction.mockReset();
});

// ─── Mixed success / failure — ordering ──────────────────────────────────────

describe("submitBatch — mixed success and failure (#80)", () => {
  it("preserves input ordering: index 0 → first result, index N → Nth result", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("hash_a")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "rejected"))
      .mockResolvedValueOnce(ok(successResult("hash_c")));

    const result = await submitBatch([XDR_A, XDR_B, XDR_C], BASE_CONFIG);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const txs = result.data.transactions;
    expect(txs[0]?.xdr).toBe(XDR_A);
    expect(txs[0]?.status).toBe("success");
    expect(txs[0]?.hash).toBe("hash_a");

    expect(txs[1]?.xdr).toBe(XDR_B);
    expect(txs[1]?.status).toBe("failed");
    expect(txs[1]?.hash).toBeUndefined();
    expect(txs[1]?.error).toContain("rejected");

    expect(txs[2]?.xdr).toBe(XDR_C);
    expect(txs[2]?.status).toBe("success");
    expect(txs[2]?.hash).toBe("hash_c");
  });

  it("reports partial_success summary when at least one item succeeds and one fails", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("hash_a")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail"));

    const result = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.summary).toBe("partial_success");
    expect(result.data.ok).toBe(false);
    expect(result.data.succeeded).toBe(1);
    expect(result.data.failed).toBe(1);
  });

  it("does not short-circuit on a failure — all items are attempted", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail_a"))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail_b"))
      .mockResolvedValueOnce(ok(successResult("hash_c")));

    await submitBatch([XDR_A, XDR_B, XDR_C], BASE_CONFIG);

    expect(mockSubmitTransaction).toHaveBeenCalledTimes(3);
  });

  it("each failed entry carries the per-item error message, not a generic batch error", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "item_error_A"))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "item_error_B"));

    const result = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.data.transactions[0]?.error).toBe("item_error_A");
    expect(result.data.transactions[1]?.error).toBe("item_error_B");
  });

  it("success entries carry the hash from the per-item Horizon response", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("unique_hash_1", 500)))
      .mockResolvedValueOnce(ok(successResult("unique_hash_2", 501)));

    const result = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.data.transactions[0]?.hash).toBe("unique_hash_1");
    expect(result.data.transactions[0]?.ledger).toBe(500);
    expect(result.data.transactions[1]?.hash).toBe("unique_hash_2");
    expect(result.data.transactions[1]?.ledger).toBe(501);
  });
});

// ─── Timeout / rejected promise ───────────────────────────────────────────────

describe("submitBatch — timeout and network rejection (#80)", () => {
  it("records a failed status when submitTransaction rejects with a timeout error", async () => {
    const timeoutError = new Error("Request timed out after 30000ms");
    mockSubmitTransaction.mockRejectedValueOnce(timeoutError);

    // Single-item sequential batch
    const result = await submitBatch([XDR_A], {
      ...BASE_CONFIG,
      mode: "sequential",
    });

    // The batch itself must still return ok — per-item failure, not whole-batch
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.transactions[0]?.status).toBe("failed");
    expect(result.data.summary).toBe("all_failed");
  });

  it("handles timeout in parallel mode — timed-out item is failed, others unaffected", async () => {
    const timeoutError = new Error("timeout");
    mockSubmitTransaction
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(ok(successResult("hash_b")))
      .mockResolvedValueOnce(ok(successResult("hash_c")));

    const result = await submitBatch([XDR_A, XDR_B, XDR_C], {
      ...BASE_CONFIG,
      mode: "parallel",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.data.transactions[0]?.status).toBe("failed");
    expect(result.data.transactions[1]?.status).toBe("success");
    expect(result.data.transactions[2]?.status).toBe("success");
    expect(result.data.summary).toBe("partial_success");
  });

  it("records the rejection message in the failed entry's error field", async () => {
    mockSubmitTransaction.mockRejectedValueOnce(new Error("connection refused"));

    const result = await submitBatch([XDR_A], {
      ...BASE_CONFIG,
      mode: "parallel",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.transactions[0]?.error).toContain("connection refused");
  });

  it("records timing metadata even when the underlying call rejects", async () => {
    mockSubmitTransaction.mockRejectedValueOnce(new Error("timeout"));

    const before = Date.now();
    const result = await submitBatch([XDR_A], { ...BASE_CONFIG, mode: "parallel" });
    const after = Date.now();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const entry = result.data.transactions[0]!;
    expect(typeof entry.submittedAtMs).toBe("number");
    expect(entry.submittedAtMs).toBeGreaterThanOrEqual(before);
    expect(entry.submittedAtMs).toBeLessThanOrEqual(after);
    expect(typeof entry.confirmedAtMs).toBe("number");
    expect(entry.attemptCount).toBe(1);
  });
});

// ─── Malformed / unexpected responses ────────────────────────────────────────

describe("submitBatch — malformed response handling (#80)", () => {
  it("treats a Horizon error result as a per-item failure without propagating to the outer result", async () => {
    mockSubmitTransaction.mockResolvedValueOnce(
      err(SorokitErrorCode.TX_SUBMIT_FAILED, "tx_bad_seq: bad sequence"),
    );

    const result = await submitBatch([XDR_A], BASE_CONFIG);

    // Outer result is ok — the error is scoped to the item
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.transactions[0]?.status).toBe("failed");
    expect(result.data.transactions[0]?.error).toContain("tx_bad_seq");
  });

  it("handles a mix of Horizon errors and rejections across multiple items", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("hash_a")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "horizon_error"))
      .mockRejectedValueOnce(new Error("network_rejection"))
      .mockResolvedValueOnce(ok(successResult("hash_d")));

    const result = await submitBatch([XDR_A, XDR_B, XDR_C, XDR_D], {
      ...BASE_CONFIG,
      mode: "parallel",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.data.transactions[0]?.status).toBe("success");
    expect(result.data.transactions[1]?.status).toBe("failed");
    expect(result.data.transactions[2]?.status).toBe("failed");
    expect(result.data.transactions[3]?.status).toBe("success");
    expect(result.data.summary).toBe("partial_success");
    expect(result.data.succeeded).toBe(2);
    expect(result.data.failed).toBe(2);
  });
});

// ─── Per-item vs whole-batch failure semantics ────────────────────────────────

describe("submitBatch — per-item vs whole-batch failure semantics (#80)", () => {
  it("only returns a whole-batch error for invalid input, not for per-item Horizon failures", async () => {
    // Invalid input → whole-batch error
    const emptyResult = await submitBatch([], BASE_CONFIG);
    expect(emptyResult.status).toBe("error");
    expect(emptyResult.error?.code).toBe(SorokitErrorCode.TX_SUBMIT_FAILED);

    // Per-item Horizon failure → outer result is still ok
    mockSubmitTransaction.mockResolvedValueOnce(
      err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail"),
    );
    const itemResult = await submitBatch([XDR_A], BASE_CONFIG);
    expect(itemResult.status).toBe("ok");
  });

  it("whole-batch ok:false only when at least one item failed", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h1")))
      .mockResolvedValueOnce(ok(successResult("h2")));

    const allGood = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(allGood.status).toBe("ok");
    if (allGood.status !== "ok") return;
    expect(allGood.data.ok).toBe(true);

    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h1")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail"));

    const partial = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(partial.status).toBe("ok");
    if (partial.status !== "ok") return;
    expect(partial.data.ok).toBe(false);
  });

  it("getTransactionStatus returns the per-item result at the given index", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("hash_a")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "per_item_fail"));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const first = getTransactionStatus(batchResult.data, 0);
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.data.status).toBe("success");
    expect(first.data.hash).toBe("hash_a");

    const second = getTransactionStatus(batchResult.data, 1);
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.data.status).toBe("failed");
    expect(second.data.error).toContain("per_item_fail");
  });

  it("getTransactionStatus returns an error for an out-of-range index", async () => {
    mockSubmitTransaction.mockResolvedValueOnce(ok(successResult("h")));
    const batchResult = await submitBatch([XDR_A], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const oob = getTransactionStatus(batchResult.data, 99);
    expect(oob.status).toBe("error");
    expect(oob.error?.code).toBe(SorokitErrorCode.VALIDATION);
  });
});

// ─── suggestRetryStrategy ────────────────────────────────────────────────────

describe("suggestRetryStrategy — partial failure semantics (#80)", () => {
  it("returns retry_failed with the indices of failed items on partial_success", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h_a")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail"))
      .mockResolvedValueOnce(ok(successResult("h_c")));

    const batchResult = await submitBatch([XDR_A, XDR_B, XDR_C], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const strategy = suggestRetryStrategy(batchResult.data);
    expect(strategy.status).toBe("ok");
    if (strategy.status !== "ok") return;

    expect(strategy.data.strategy).toBe("retry_failed");
    expect(strategy.data.failedIndices).toEqual([1]);
  });

  it("returns retry_all with all indices when every item failed", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "e1"))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "e2"));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const strategy = suggestRetryStrategy(batchResult.data);
    expect(strategy.status).toBe("ok");
    if (strategy.status !== "ok") return;

    expect(strategy.data.strategy).toBe("retry_all");
    expect(strategy.data.failedIndices).toEqual([0, 1]);
  });

  it("returns none with an empty failedIndices when all items succeeded", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h1")))
      .mockResolvedValueOnce(ok(successResult("h2")));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const strategy = suggestRetryStrategy(batchResult.data);
    expect(strategy.status).toBe("ok");
    if (strategy.status !== "ok") return;

    expect(strategy.data.strategy).toBe("none");
    expect(strategy.data.failedIndices).toHaveLength(0);
  });
});

// ─── generateRollbackInstructions ────────────────────────────────────────────

describe("generateRollbackInstructions — partial failure semantics (#80)", () => {
  it("generates one instruction per successful item on partial_success", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("hash_a")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail"))
      .mockResolvedValueOnce(ok(successResult("hash_c")));

    const batchResult = await submitBatch([XDR_A, XDR_B, XDR_C], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const rollback = generateRollbackInstructions(batchResult.data);
    expect(rollback.status).toBe("ok");
    if (rollback.status !== "ok") return;

    expect(rollback.data).toHaveLength(2);
    expect(rollback.data[0]?.hash).toBe("hash_a");
    expect(rollback.data[1]?.hash).toBe("hash_c");
    expect(rollback.data.every((i) => typeof i.reason === "string" && i.reason.length > 0)).toBe(true);
  });

  it("generates no instructions when all items succeed (nothing to roll back)", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h1")))
      .mockResolvedValueOnce(ok(successResult("h2")));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const rollback = generateRollbackInstructions(batchResult.data);
    expect(rollback.status).toBe("ok");
    if (rollback.status !== "ok") return;
    expect(rollback.data).toHaveLength(0);
  });

  it("generates no instructions when all items fail (nothing was submitted)", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "e1"))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "e2"));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const rollback = generateRollbackInstructions(batchResult.data);
    expect(rollback.status).toBe("ok");
    if (rollback.status !== "ok") return;
    expect(rollback.data).toHaveLength(0);
  });
});

// ─── wasAtomicExecuted ────────────────────────────────────────────────────────

describe("wasAtomicExecuted — partial failure semantics (#80)", () => {
  it("returns false when any item failed", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h1")))
      .mockResolvedValueOnce(err(SorokitErrorCode.TX_SUBMIT_FAILED, "fail"));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const atomic = wasAtomicExecuted(batchResult.data);
    expect(atomic.status).toBe("ok");
    if (atomic.status !== "ok") return;
    expect(atomic.data).toBe(false);
  });

  it("returns true only when every item succeeded", async () => {
    mockSubmitTransaction
      .mockResolvedValueOnce(ok(successResult("h1")))
      .mockResolvedValueOnce(ok(successResult("h2")));

    const batchResult = await submitBatch([XDR_A, XDR_B], BASE_CONFIG);
    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") return;

    const atomic = wasAtomicExecuted(batchResult.data);
    expect(atomic.status).toBe("ok");
    if (atomic.status !== "ok") return;
    expect(atomic.data).toBe(true);
  });
});

// ─── Parallel mode ordering ───────────────────────────────────────────────────

describe("submitBatch parallel mode — ordering preserved (#80)", () => {
  it("result index matches input index regardless of promise resolution order", async () => {
    // XDR_B resolves first (faster), XDR_A resolves last
    mockSubmitTransaction
      .mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r(ok(successResult("hash_a"))), 20)),
      )
      .mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r(ok(successResult("hash_b"))), 5)),
      )
      .mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r(ok(successResult("hash_c"))), 10)),
      );

    const result = await submitBatch([XDR_A, XDR_B, XDR_C], {
      ...BASE_CONFIG,
      mode: "parallel",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // Ordering must match input, not resolution order
    expect(result.data.transactions[0]?.hash).toBe("hash_a");
    expect(result.data.transactions[1]?.hash).toBe("hash_b");
    expect(result.data.transactions[2]?.hash).toBe("hash_c");
  });
});
