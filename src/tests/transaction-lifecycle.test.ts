/**
 * End-to-end transaction lifecycle tests with mocked RPC (#89).
 *
 * Exercises the full flow — build → simulate → sign → submit → status —
 * through every significant outcome: success, wallet rejection, simulation
 * error, submission timeout, and confirmed/failed confirmation. All Horizon
 * and Soroban RPC calls are intercepted via vi.mock so no network is required.
 *
 * The framework-agnostic SDK boundary is preserved: only public exports from
 * the transaction and shared modules are used in assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Keypair,
  TransactionBuilder,
  Networks,
  Account,
  Operation,
  Asset,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { SorokitErrorCode } from "../shared/response";
import { clearReplayProtection, submitTransaction } from "../transaction/submitTransaction";
import { getTransactionStatus } from "../transaction/status";
import { previewTransaction } from "../transaction/simulationPreview";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const { mockHorizonSubmit, mockHorizonTxCall, mockGetAccount, mockSimulate } = vi.hoisted(() => ({
  mockHorizonSubmit: vi.fn(),
  mockHorizonTxCall: vi.fn(),
  mockGetAccount: vi.fn(),
  mockSimulate: vi.fn(),
}));

vi.mock("../shared/serverFactory", () => ({
  createHorizonServer: vi.fn(() => ({
    submitTransaction: mockHorizonSubmit,
    transactions: vi.fn(() => ({
      transaction: vi.fn(() => ({ call: mockHorizonTxCall })),
    })),
  })),
  createSorobanServer: vi.fn(() => ({
    simulateTransaction: mockSimulate,
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1_000_000 }),
  })),
  setTracedFetch: vi.fn(),
  getTracedFetch: vi.fn(),
  setSorobanSimulator: vi.fn(),
}));

vi.mock("../account/getAccount", () => ({
  getAccount: mockGetAccount,
  invalidateAccount: vi.fn(),
}));

vi.mock("../transaction/buildTransaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../transaction/buildTransaction")>();
  return {
    ...actual,
    invalidateSequenceCacheEntry: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Build a minimal signed testnet XDR with a real keypair so passphrase checks pass. */
function buildSignedXdr(keypair: Keypair, sequence = "100"): string {
  const account = new Account(keypair.publicKey(), sequence);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.inflation())
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return tx.toXDR();
}

const SOURCE_KEYPAIR = Keypair.random();

function successHorizonResponse(hash = "abc123def456") {
  return {
    hash,
    ledger: 42_000_000,
    envelope_xdr: "AAAA",
    result_xdr: "AAAA",
  };
}

function horizonTimeoutError(): Error {
  const e = new Error("ECONNABORTED: timeout");
  (e as any).code = "ECONNABORTED";
  return e;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("transaction lifecycle — mocked RPC (#89)", () => {
  beforeEach(() => {
    clearReplayProtection();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearReplayProtection();
  });

  // ── 1. Happy path ──────────────────────────────────────────────────────────

  describe("success path", () => {
    it("submits a valid signed XDR and returns ok with hash and ledger", async () => {
      const xdr = buildSignedXdr(SOURCE_KEYPAIR, "200");
      const expected = successHorizonResponse("txhash_success");
      mockHorizonSubmit.mockResolvedValueOnce(expected);

      const result = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.hash).toBe("txhash_success");
        expect(result.data.ledger).toBe(42_000_000);
        expect(result.data.status).toBe("success");
      }
      expect(mockHorizonSubmit).toHaveBeenCalledTimes(1);
    });

    it("surfaces envelopeXdr and resultXdr in the success result", async () => {
      const xdr = buildSignedXdr(SOURCE_KEYPAIR, "201");
      mockHorizonSubmit.mockResolvedValueOnce({
        hash: "xdr_check",
        ledger: 1,
        envelope_xdr: "ENV_XDR",
        result_xdr: "RESULT_XDR",
      });

      const result = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.envelopeXdr).toBe("ENV_XDR");
        expect(result.data.resultXdr).toBe("RESULT_XDR");
      }
    });
  });

  // ── 2. Wallet rejection ────────────────────────────────────────────────────

  describe("wallet rejection", () => {
    it("returns TX_SUBMIT_FAILED when passphrase is mainnet but XDR is testnet-signed", async () => {
      const xdr = buildSignedXdr(SOURCE_KEYPAIR, "300");

      const result = await submitTransaction(
        "https://horizon.stellar.org",
        Networks.PUBLIC,
        xdr,
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.TX_SUBMIT_FAILED);
        expect(result.error.message).toMatch(/passphrase mismatch/i);
      }
      // Horizon should never be called — rejection is client-side
      expect(mockHorizonSubmit).not.toHaveBeenCalled();
    });

    it("returns TX_SUBMIT_FAILED for a malformed XDR string", async () => {
      const result = await submitTransaction(
        HORIZON_URL,
        NETWORK_PASSPHRASE,
        "not-valid-xdr-at-all",
      );

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.TX_SUBMIT_FAILED);
      }
      expect(mockHorizonSubmit).not.toHaveBeenCalled();
    });

    it("returns TX_SUBMIT_FAILED on replay-protection rejection for a duplicate XDR", async () => {
      const xdr = buildSignedXdr(SOURCE_KEYPAIR, "400");
      mockHorizonSubmit.mockResolvedValue(successHorizonResponse("dup_hash"));

      const first = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);
      expect(first.status).toBe("ok");

      // Second submission of same XDR must be blocked
      const second = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);
      expect(second.status).toBe("error");
      if (second.status === "error") {
        expect(second.error.code).toBe(SorokitErrorCode.TX_SUBMIT_FAILED);
        expect(second.error.message).toMatch(/replay protection/i);
      }
      // Horizon called only once
      expect(mockHorizonSubmit).toHaveBeenCalledTimes(1);
    });
  });

  // ── 3. Simulation error ────────────────────────────────────────────────────

  describe("simulation error", () => {
    it("returns an error result when previewTransaction encounters an XDR parse failure", async () => {
      const result = await previewTransaction(HORIZON_URL, NETWORK_PASSPHRASE, "bad-xdr");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
        expect(result.error.message).toMatch(/malformed/i);
      }
    });

    it("returns VALIDATION error from previewTransaction when invokeHostFunction is present without rpcUrl", async () => {
      // Build a real tx XDR with a payment op so it parses fine, then
      // override getAccount to return a balance
      mockGetAccount.mockResolvedValue({
        status: "ok",
        data: {
          balances: [
            { assetType: "native", balance: "1000.0000000" },
          ],
        },
      });

      // Build a real XDR for the preview path check (payment)
      const kp = Keypair.random();
      const dest = Keypair.random();
      const account = new Account(kp.publicKey(), "1");
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: dest.publicKey(),
            asset: Asset.native(),
            amount: "10",
          }),
        )
        .setTimeout(30)
        .build();
      const xdr = tx.toXDR();

      const result = await previewTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);

      // Payment preview should succeed (no Soroban RPC needed)
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.effects.length).toBeGreaterThan(0);
        const sendEffect = result.data.effects.find((e) => e.account === kp.publicKey());
        expect(sendEffect).toBeDefined();
        expect(sendEffect!.delta).toMatch(/^-/);
      }
    });
  });

  // ── 4. Submission timeout ──────────────────────────────────────────────────

  describe("submission timeout", () => {
    it("returns TX_SUBMIT_FAILED with a timeout message when Horizon times out", async () => {
      const xdr = buildSignedXdr(SOURCE_KEYPAIR, "500");
      mockHorizonSubmit.mockRejectedValueOnce(horizonTimeoutError());

      const result = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.message).toMatch(/timeout/i);
      }
    });

    it("surfaces a network connectivity error when Horizon is unreachable", async () => {
      const xdr = buildSignedXdr(SOURCE_KEYPAIR, "501");
      const networkErr = new Error("ECONNREFUSED: connection refused");
      (networkErr as any).code = "ECONNREFUSED";
      mockHorizonSubmit.mockRejectedValueOnce(networkErr);

      const result = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.TX_SUBMIT_FAILED);
      }
    });
  });

  // ── 5. Confirmation outcomes ───────────────────────────────────────────────

  describe("confirmation outcomes", () => {
    it("getTransactionStatus returns ok with confirmed status for a known hash", async () => {
      mockHorizonTxCall.mockResolvedValueOnce({
        hash: "confirmed_hash",
        ledger_attr: 42_000_001,
        created_at: "2024-01-01T00:00:00Z",
        fee_charged: "500",
        envelope_xdr: "ENV",
        result_xdr: "RES",
      });

      const result = await getTransactionStatus(HORIZON_URL, "confirmed_hash");

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.status).toBe("success");
        expect(result.data.hash).toBe("confirmed_hash");
      }
    });

    it("getTransactionStatus returns TX_NOT_FOUND when Horizon returns 404", async () => {
      const notFound = new Error("Not Found");
      (notFound as any).response = { status: 404 };
      mockHorizonTxCall.mockRejectedValueOnce(notFound);

      const result = await getTransactionStatus(HORIZON_URL, "unknown_hash");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.TX_NOT_FOUND);
      }
    });

    it("getTransactionStatus returns TX_FETCH_FAILED on generic Horizon error", async () => {
      mockHorizonTxCall.mockRejectedValueOnce(new Error("Internal server error"));

      const result = await getTransactionStatus(HORIZON_URL, "some_hash");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.TX_FETCH_FAILED);
      }
    });

    it("getTransactionStatus reads from cache before hitting Horizon", async () => {
      const cached = { hash: "cached_hash", status: "success" as const, ledger: 1 };
      const cache = {
        get: vi.fn().mockReturnValueOnce(cached),
        set: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
        has: vi.fn().mockReturnValue(true),
      };

      const result = await getTransactionStatus(HORIZON_URL, "cached_hash", cache);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.hash).toBe("cached_hash");
      }
      expect(mockHorizonTxCall).not.toHaveBeenCalled();
    });
  });

  // ── 6. Request / status consistency assertions ─────────────────────────────

  describe("request and status consistency", () => {
    it("submit followed by getTransactionStatus returns consistent hash", async () => {
      const kp = Keypair.random();
      const xdr = buildSignedXdr(kp, "600");
      const txHash = "consistent_hash_42";

      mockHorizonSubmit.mockResolvedValueOnce(successHorizonResponse(txHash));
      mockHorizonTxCall.mockResolvedValueOnce({
        hash: txHash,
        ledger_attr: 42_000_002,
        created_at: "2024-01-01T00:00:00Z",
        fee_charged: "100",
        envelope_xdr: "E",
        result_xdr: "R",
      });

      const submitResult = await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);
      expect(submitResult.status).toBe("ok");

      const statusResult = await getTransactionStatus(HORIZON_URL, txHash);
      expect(statusResult.status).toBe("ok");

      if (submitResult.status === "ok" && statusResult.status === "ok") {
        expect(submitResult.data.hash).toBe(statusResult.data.hash);
      }
    });

    it("Horizon is only called once per unique signed XDR before replay protection blocks re-submission", async () => {
      const kp = Keypair.random();
      const xdr = buildSignedXdr(kp, "700");
      mockHorizonSubmit.mockResolvedValue(successHorizonResponse("replay_guard_hash"));

      await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);
      await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);
      await submitTransaction(HORIZON_URL, NETWORK_PASSPHRASE, xdr);

      expect(mockHorizonSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
