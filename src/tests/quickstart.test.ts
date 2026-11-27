import { describe, expect, it } from "vitest";
import {
  createSorokitClient,
  FreighterAdapter,
  WalletType,
  ok,
  err,
  SorokitErrorCode,
} from "../index";
import { createMockWalletAdapter, MOCK_PUBLIC_KEY } from "../testing";

describe("SDK Canonical Quickstart (#55)", () => {
  it("initializes a client on testnet successfully", () => {
    const res = createSorokitClient({ network: "testnet" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.networkConfig.network).toBe("testnet");
      expect(typeof res.data.wallet.connect).toBe("function");
      expect(typeof res.data.account.get).toBe("function");
      expect(typeof res.data.soroban.read).toBe("function");
    }
  });

  it("fails client initialization gracefully on invalid network options", () => {
    // @ts-expect-error test runtime invalid network argument
    const res = createSorokitClient({ network: "invalid-net-xyz" });
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.INVALID_NETWORK);
      expect(res.data).toBeNull();
    }
  });

  it("completes first wallet operation: connect and read state", async () => {
    const clientRes = createSorokitClient({ network: "testnet" });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status !== "ok") return;

    const client = clientRes.data;
    const mockAdapter = createMockWalletAdapter();

    const conn = await client.wallet.connect(mockAdapter);
    expect(conn.status).toBe("ok");
    if (conn.status === "ok") {
      expect(conn.data.publicKey).toBe(MOCK_PUBLIC_KEY);
      expect(conn.data.walletType).toBe(WalletType.FREIGHTER);
      expect(conn.data.isConnected).toBe(true);
    }
  });

  it("handles wallet connection rejection as a safe error result", async () => {
    const clientRes = createSorokitClient({ network: "testnet" });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status !== "ok") return;

    const client = clientRes.data;
    const mockAdapter = createMockWalletAdapter();
    mockAdapter.connect.mockResolvedValueOnce(
      err(SorokitErrorCode.WALLET_SIGN_REJECTED, "User rejected connection"),
    );

    const conn = await client.wallet.connect(mockAdapter);
    expect(conn.status).toBe("error");
    if (conn.status === "error") {
      expect(conn.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
      expect(conn.data).toBeNull();
    }
  });

  it("handles read-only contract operation boundary failure gracefully without throwing", async () => {
    const clientRes = createSorokitClient({ network: "testnet" });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status !== "ok") return;

    const client = clientRes.data;

    // Passing invalid contract ID should return an error result, never throw
    const readRes = await client.soroban.read({
      contractId: "invalid-contract-address",
      method: "test_method",
      args: [],
    });

    expect(readRes.status).toBe("error");
    if (readRes.status === "error") {
      expect(readRes.error).toBeDefined();
      expect(typeof readRes.error.message).toBe("string");
      expect(readRes.data).toBeNull();
    }
  });

  it("exposes public symbols required by consumer quickstart", () => {
    expect(typeof createSorokitClient).toBe("function");
    expect(typeof FreighterAdapter).toBe("function");
    expect(WalletType.FREIGHTER).toBe("freighter");
    expect(typeof ok).toBe("function");
    expect(typeof err).toBe("function");
    expect(SorokitErrorCode.WALLET_CONNECT_FAILED).toBe("WALLET_CONNECT_FAILED");
  });
});
