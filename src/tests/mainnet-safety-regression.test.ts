/**
 * Mainnet safety regression tests (#83)
 *
 * Covers explicit mainnet selection, mismatched passphrases, missing opt-in,
 * and allowed read-only behavior. All failure assertions verify that errors
 * are actionable and happen before signing or Horizon submission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Account,
  Asset,
  BASE_FEE,
  Claimant,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  checkMainnetSafety,
  isMainnetNetwork,
  MAINNET_NETWORK_PASSPHRASE,
  DEFAULT_MAINNET_SAFETY_THRESHOLD_XLM,
} from "../shared/mainnetSafety";
import { SorokitErrorCode } from "../shared/response";
import { submitTransaction } from "../transaction/submitTransaction";
import { createSorokitClient } from "../client/createSorokitClient";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { horizonSubmit, horizonFactory, rpcSend } = vi.hoisted(() => ({
  horizonSubmit: vi.fn(),
  rpcSend: vi.fn(),
  horizonFactory: vi.fn(),
}));

vi.mock("../shared/serverFactory", async (importOriginal) => ({
  ...await importOriginal<typeof import("../shared/serverFactory")>(),
  createHorizonServer: horizonFactory,
  createSorobanServer: () => ({
    sendTransaction: rpcSend,
    getTransaction: async () => ({ status: "SUCCESS" }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  horizonFactory.mockReturnValue({ submitTransaction: horizonSubmit });
  horizonSubmit.mockImplementation(async (tx: any) => ({
    hash: tx.hash().toString("hex"),
    ledger: 1,
    envelope_xdr: tx.toXDR(),
    result_xdr: "",
  }));
  rpcSend.mockResolvedValue({ status: "PENDING", hash: "rpc-hash" });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TESTNET = Networks.TESTNET;
const MAINNET = MAINNET_NETWORK_PASSPHRASE;
const FUTURENET = Networks.FUTURENET;

function buildXdr(
  operations: ReturnType<typeof Operation.payment>[],
  passphrase: string = MAINNET,
  keypair: Keypair = Keypair.random(),
): string {
  const builder = new TransactionBuilder(
    new Account(keypair.publicKey(), "1"),
    { fee: BASE_FEE, networkPassphrase: passphrase },
  );
  operations.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(30).build();
  tx.sign(keypair);
  return tx.toXDR();
}

function nativePayment(amount: string, to?: string): ReturnType<typeof Operation.payment> {
  return Operation.payment({
    destination: to ?? Keypair.random().publicKey(),
    asset: Asset.native(),
    amount,
  });
}

function usdcPayment(amount: string): ReturnType<typeof Operation.payment> {
  const issuer = Keypair.random().publicKey();
  return Operation.payment({
    destination: Keypair.random().publicKey(),
    asset: new Asset("USDC", issuer),
    amount,
  });
}

// ─── Explicit mainnet selection ───────────────────────────────────────────────

describe("Explicit mainnet selection (#83)", () => {
  it("isMainnetNetwork is true only for the exact mainnet passphrase", () => {
    expect(isMainnetNetwork(MAINNET)).toBe(true);
    expect(isMainnetNetwork(TESTNET)).toBe(false);
    expect(isMainnetNetwork(FUTURENET)).toBe(false);
    expect(isMainnetNetwork("")).toBe(false);
    expect(isMainnetNetwork(" " + MAINNET)).toBe(false); // padded
    expect(isMainnetNetwork(MAINNET.toLowerCase())).toBe(false); // wrong case
  });

  it("allows transactions below the default 1000 XLM threshold on mainnet without opt-in", () => {
    const xdr = buildXdr([nativePayment("999.9999999")]);
    const result = checkMainnetSafety(xdr, MAINNET);
    expect(result.status).toBe("ok");
  });

  it("blocks transactions at exactly one stroop over the default threshold", () => {
    const xdr = buildXdr([nativePayment("999"), nativePayment("0.0000001")]);
    const result = checkMainnetSafety(xdr, MAINNET);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
    expect(result.error.message).toContain("bypassMainnetSafety");
  });

  it("allows exactly the threshold amount (not strictly over)", () => {
    // 10 × 100 XLM = exactly 1000 XLM — should pass without opt-in
    const xdr = buildXdr(Array.from({ length: 10 }, () => nativePayment("100")));
    expect(checkMainnetSafety(xdr, MAINNET).status).toBe("ok");
  });

  it("non-mainnet passphrases bypass the safety check regardless of amount", () => {
    const highValue = buildXdr([nativePayment("999999")], TESTNET);
    expect(checkMainnetSafety(highValue, TESTNET).status).toBe("ok");

    const futurenetHigh = buildXdr([nativePayment("999999")], FUTURENET);
    expect(checkMainnetSafety(futurenetHigh, FUTURENET).status).toBe("ok");
  });

  it("supports a custom threshold lower than the default", () => {
    const xdr = buildXdr([nativePayment("300")]); // 300 XLM — below 1000 but above 200
    const result = checkMainnetSafety(xdr, MAINNET, { mainnetSafetyThresholdXlm: 200 });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
  });

  it("supports a custom threshold higher than the default", () => {
    const xdr = buildXdr([nativePayment("1500")]); // 1500 XLM — above default but below 2000
    const result = checkMainnetSafety(xdr, MAINNET, { mainnetSafetyThresholdXlm: 2000 });
    expect(result.status).toBe("ok");
  });
});

// ─── Mismatched passphrases ───────────────────────────────────────────────────

describe("Passphrase mismatch — fails before signing (#83)", () => {
  it("rejects a testnet-signed transaction submitted with the mainnet passphrase", async () => {
    // Signed for testnet, but submitted with mainnet passphrase
    const keypair = Keypair.random();
    const tx = new TransactionBuilder(
      new Account(keypair.publicKey(), "1"),
      { fee: BASE_FEE, networkPassphrase: TESTNET },
    )
      .addOperation(nativePayment("10", keypair.publicKey()))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    const signedXdr = tx.toXDR();

    const result = await submitTransaction(
      "https://horizon.stellar.org",
      MAINNET, // passphrase mismatch
      signedXdr,
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    // Should fail before Horizon is ever contacted
    expect(horizonSubmit).not.toHaveBeenCalled();
  });

  it("allows a mainnet-signed transaction with the mainnet passphrase (below threshold)", async () => {
    const xdr = buildXdr([nativePayment("10")], MAINNET);

    const result = await submitTransaction(
      "https://horizon.stellar.org",
      MAINNET,
      xdr,
      undefined,
      { bypassMainnetSafety: false }, // no opt-in needed: 10 XLM < 1000 XLM
    );

    expect(result.status).toBe("ok");
    expect(horizonSubmit).toHaveBeenCalledOnce();
  });

  it("checkMainnetSafety returns XDR_INVALID for an uninspectable envelope", () => {
    const result = checkMainnetSafety("not_valid_xdr", MAINNET);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.XDR_INVALID);
    // Error happens before any Horizon call
    expect(horizonSubmit).not.toHaveBeenCalled();
  });

  it("submitTransaction fails before Horizon for an uninspectable mainnet XDR", async () => {
    const result = await submitTransaction(
      "https://horizon.stellar.org",
      MAINNET,
      "bad_xdr",
    );
    expect(result.status).toBe("error");
    expect(horizonSubmit).not.toHaveBeenCalled();
  });
});

// ─── Missing opt-in (bypassMainnetSafety) ────────────────────────────────────

describe("Missing opt-in — high-value mainnet transactions (#83)", () => {
  it("blocks a high-value payment without bypassMainnetSafety", () => {
    const xdr = buildXdr([nativePayment("5000")]);
    const result = checkMainnetSafety(xdr, MAINNET);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
    // The message must tell the caller exactly what opt-in they need
    expect(result.error.message).toContain("bypassMainnetSafety: true");
  });

  it("allows a high-value payment when bypassMainnetSafety is explicitly true", () => {
    const xdr = buildXdr([nativePayment("5000")]);
    const result = checkMainnetSafety(xdr, MAINNET, { bypassMainnetSafety: true });
    expect(result.status).toBe("ok");
  });

  it("requires a literal boolean true — truthy values such as 1 or 'true' are rejected", () => {
    const xdr = buildXdr([nativePayment("5000")]);
    for (const bypass of [1, "true", {}, [], 0.1] as any[]) {
      const result = checkMainnetSafety(xdr, MAINNET, { bypassMainnetSafety: bypass });
      expect(result.status).toBe("error");
    }
  });

  it("rejects operations with unbounded native exposure without opt-in", () => {
    // accountMerge, claim, liquidityPool ops — native exposure cannot be bounded
    const xdr = buildXdr([Operation.accountMerge({ destination: Keypair.random().publicKey() })]);
    const result = checkMainnetSafety(xdr, MAINNET);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
    expect(result.error.message.toLowerCase()).toMatch(/cannot be bounded|unbounded/);
  });

  it("allows unbounded operations on mainnet with explicit opt-in", () => {
    const xdr = buildXdr([Operation.accountMerge({ destination: Keypair.random().publicKey() })]);
    expect(checkMainnetSafety(xdr, MAINNET, { bypassMainnetSafety: true }).status).toBe("ok");
  });

  it("submitTransaction blocks before Horizon when mainnet limit is exceeded without opt-in", async () => {
    const xdr = buildXdr([nativePayment("2000")]);

    const result = await submitTransaction(
      "https://horizon.stellar.org",
      MAINNET,
      xdr,
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
    // No network call should have been made
    expect(horizonFactory).not.toHaveBeenCalled();
    expect(horizonSubmit).not.toHaveBeenCalled();
  });

  it("submitTransaction reaches Horizon after opt-in for a high-value mainnet payment", async () => {
    const xdr = buildXdr([nativePayment("2000")]);

    const result = await submitTransaction(
      "https://horizon.stellar.org",
      MAINNET,
      xdr,
      undefined,
      { bypassMainnetSafety: true },
    );

    expect(result.status).toBe("ok");
    expect(horizonSubmit).toHaveBeenCalledOnce();
  });
});

// ─── Read-only behavior allowed without opt-in ───────────────────────────────

describe("Read-only operations — allowed without opt-in (#83)", () => {
  it("non-native asset payments are not counted toward the XLM threshold", () => {
    // 10 000 USDC — no native XLM involved → passes without opt-in
    const xdr = buildXdr([usdcPayment("10000")]);
    expect(checkMainnetSafety(xdr, MAINNET).status).toBe("ok");
  });

  it("administrative operations (manageData, setOptions) pass without opt-in", () => {
    const kp = Keypair.random();
    const manageDataXdr = buildXdr(
      [Operation.manageData({ name: "k", value: Buffer.from("v") })],
      MAINNET,
      kp,
    );
    expect(checkMainnetSafety(manageDataXdr, MAINNET).status).toBe("ok");

    const setOptionsXdr = buildXdr(
      [Operation.setOptions({ homeDomain: "example.com" })],
      MAINNET,
      kp,
    );
    expect(checkMainnetSafety(setOptionsXdr, MAINNET).status).toBe("ok");
  });

  it("changeTrust and clawback do not count toward the threshold", () => {
    const kp = Keypair.random();
    const issuer = kp.publicKey();
    const asset = new Asset("USD", issuer);

    const changeTrustXdr = buildXdr(
      [Operation.changeTrust({ asset })],
      MAINNET,
      kp,
    );
    expect(checkMainnetSafety(changeTrustXdr, MAINNET).status).toBe("ok");
  });

  it("bumpSequence does not count toward the threshold", () => {
    const kp = Keypair.random();
    const bumpXdr = buildXdr(
      [Operation.bumpSequence({ bumpTo: "100" })],
      MAINNET,
      kp,
    );
    expect(checkMainnetSafety(bumpXdr, MAINNET).status).toBe("ok");
  });
});

// ─── Warning logging ──────────────────────────────────────────────────────────

describe("Safety warning logging (#83)", () => {
  it("calls the custom logger's warn method when the threshold is exceeded", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const xdr = buildXdr([nativePayment("2000")]);

    // Even with bypassMainnetSafety: true, a warning must be emitted
    checkMainnetSafety(xdr, MAINNET, { bypassMainnetSafety: true, logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    const [message, details] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("Mainnet Safety Warning");
    expect(details.totalXlm).toBe(2000);
    expect(details.thresholdXlm).toBe(DEFAULT_MAINNET_SAFETY_THRESHOLD_XLM);
  });

  it("does not call warn when the amount is below the threshold", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const xdr = buildXdr([nativePayment("100")]);
    checkMainnetSafety(xdr, MAINNET, { logger });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to console.warn when no logger is provided", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const xdr = buildXdr([nativePayment("2000")]);
      checkMainnetSafety(xdr, MAINNET, { bypassMainnetSafety: true });
      expect(consoleSpy).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("includes the source account and operation count in the warning details", () => {
    const kp = Keypair.random();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const xdr = buildXdr([nativePayment("2000"), nativePayment("500")], MAINNET, kp);

    checkMainnetSafety(xdr, MAINNET, { bypassMainnetSafety: true, logger });

    const details = logger.warn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(details.sourceAccount).toBe(kp.publicKey());
    expect(details.operationCount).toBe(2);
  });
});

// ─── Client-level safety guards ───────────────────────────────────────────────

describe("Client-level mainnet safety (#83)", () => {
  it("client.transaction.submitTransaction blocks before Horizon on mainnet without opt-in", async () => {
    const clientResult = createSorokitClient({ network: "mainnet" });
    expect(clientResult.status).toBe("ok");
    if (clientResult.status !== "ok") return;

    const xdr = buildXdr([nativePayment("2000")]);
    const result = await clientResult.data.transaction.submitTransaction(xdr);

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
    expect(horizonSubmit).not.toHaveBeenCalled();
  });

  it("client.transaction.submitTransaction succeeds with opt-in for a high-value mainnet payment", async () => {
    const clientResult = createSorokitClient({ network: "mainnet" });
    expect(clientResult.status).toBe("ok");
    if (clientResult.status !== "ok") return;

    const xdr = buildXdr([nativePayment("2000")]);
    const result = await clientResult.data.transaction.submitTransaction(xdr, {
      bypassMainnetSafety: true,
    });

    expect(result.status).toBe("ok");
    expect(horizonSubmit).toHaveBeenCalledOnce();
  });

  it("Soroban contract invocations with unbounded native exposure are blocked without opt-in", async () => {
    const kp = Keypair.random();
    const clientResult = createSorokitClient({ network: "mainnet" });
    expect(clientResult.status).toBe("ok");
    if (clientResult.status !== "ok") return;

    const signed = buildXdr(
      [
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([0])),
          auth: [],
        }),
      ],
      MAINNET,
      kp,
    );

    const result = await clientResult.data.soroban.execute(signed, { intervalMs: 0 });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
    expect(rpcSend).not.toHaveBeenCalled();
  });

  it("Soroban contract invocations succeed on mainnet with opt-in", async () => {
    const kp = Keypair.random();
    const clientResult = createSorokitClient({ network: "mainnet" });
    expect(clientResult.status).toBe("ok");
    if (clientResult.status !== "ok") return;

    const signed = buildXdr(
      [
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([0])),
          auth: [],
        }),
      ],
      MAINNET,
      kp,
    );

    const result = await clientResult.data.soroban.execute(
      signed,
      { intervalMs: 0 },
      undefined,
      { bypassMainnetSafety: true },
    );
    expect(result.status).toBe("ok");
    expect(rpcSend).toHaveBeenCalledOnce();
  });

  it("fee-bump transactions wrapping a high-value inner tx are blocked on mainnet", () => {
    const inner = buildXdr([nativePayment("900"), nativePayment("900")]);
    const innerTxObj = TransactionBuilder.fromXDR(inner, MAINNET);
    const outerKp = Keypair.random();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      outerKp.publicKey(),
      BASE_FEE,
      innerTxObj as any,
      MAINNET,
    );

    const result = checkMainnetSafety(feeBump.toXDR(), MAINNET);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
  });
});

// ─── Invalid configuration ────────────────────────────────────────────────────

describe("Invalid threshold configuration (#83)", () => {
  it.each([NaN, Infinity, -Infinity, -1, -0.001])(
    "rejects an invalid threshold value: %s",
    (threshold) => {
      const xdr = buildXdr([nativePayment("2000")]);
      const result = checkMainnetSafety(xdr, MAINNET, {
        mainnetSafetyThresholdXlm: threshold,
        bypassMainnetSafety: true,
      });
      expect(result.status).toBe("error");
      if (result.status !== "error") return;
      expect(result.error.code).toBe(SorokitErrorCode.INVALID_CONFIG);
    },
  );

  it("accepts a threshold of exactly zero (every non-zero payment on mainnet requires opt-in)", () => {
    const lowXdr = buildXdr([nativePayment("0.0000001")]); // one stroop
    const result = checkMainnetSafety(lowXdr, MAINNET, {
      mainnetSafetyThresholdXlm: 0,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe(SorokitErrorCode.MAINNET_SAFETY_LIMIT);
  });
});
