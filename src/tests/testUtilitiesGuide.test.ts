import { describe, expect, it, afterEach, vi } from "vitest";
import {
  createMockClient,
  createMockWalletAdapter,
  setupMockServerScenario,
  teardownMockServer,
  MOCK_PUBLIC_KEY,
  MOCK_NETWORK_CONFIG,
} from "../testing";
import { ok, err, SorokitErrorCode } from "../index";

describe("Testing Utilities and Consumer Test Isolation Guide (#65)", () => {
  afterEach(() => {
    teardownMockServer();
    vi.restoreAllMocks();
  });

  describe("Wallet Isolation with createMockWalletAdapter", () => {
    it("mocks wallet connection and signature without browser extensions", async () => {
      const adapter = createMockWalletAdapter();

      expect(adapter.isAvailable()).toBe(true);
      const conn = await adapter.connect();
      expect(conn.status).toBe("ok");
      if (conn.status === "ok") {
        expect(conn.data).toBe(MOCK_PUBLIC_KEY);
      }

      const signRes = await adapter.signTransaction("TX_XDR_MOCK==");
      expect(signRes.status).toBe("ok");
      if (signRes.status === "ok") {
        expect(signRes.data).toBe("SIGNED_XDR_MOCK==");
      }
    });

    it("simulates wallet user rejection boundary condition", async () => {
      const adapter = createMockWalletAdapter();
      adapter.signTransaction.mockResolvedValueOnce(
        err(SorokitErrorCode.WALLET_SIGN_REJECTED, "User rejected transaction signing"),
      );

      const signRes = await adapter.signTransaction("TX_XDR_MOCK==");
      expect(signRes.status).toBe("error");
      if (signRes.status === "error") {
        expect(signRes.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
        expect(signRes.error.message).toContain("rejected");
      }
    });
  });

  describe("Client & Contract Isolation with createMockClient", () => {
    it("supports partial overrides without stubbing every method manually", async () => {
      const client = createMockClient({
        overrides: {
          soroban: {
            read: vi.fn().mockResolvedValue(
              ok({
                result: 42n,
                footprint: "footprint-data",
                minResourceFee: "100",
              }),
            ),
          },
        },
      });

      const readRes = await client.soroban.read({
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        method: "get_value",
      });

      expect(readRes.status).toBe("ok");
      if (readRes.status === "ok") {
        expect(readRes.data.result).toBe(42n);
      }

      // Non-overridden methods retain default happy path stubs
      const accountRes = await client.account.get(MOCK_PUBLIC_KEY);
      expect(accountRes.status).toBe("ok");
    });

    it("simulates contract execution failure", async () => {
      const client = createMockClient({
        overrides: {
          soroban: {
            read: vi.fn().mockResolvedValue(
              err(SorokitErrorCode.CONTRACT_SIMULATE_FAILED, "Host error: assertion failed"),
            ),
          },
        },
      });

      const readRes = await client.soroban.read({
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        method: "test",
      });

      expect(readRes.status).toBe("error");
      if (readRes.status === "error") {
        expect(readRes.error.code).toBe(SorokitErrorCode.CONTRACT_SIMULATE_FAILED);
      }
    });
  });

  describe("Mock Server Scenario and Teardown", () => {
    it("configures scenario and tears down cleanly without side effects", () => {
      setupMockServerScenario({
        scenario: "success",
        horizonUrl: MOCK_NETWORK_CONFIG.horizonUrl,
        rpcUrl: MOCK_NETWORK_CONFIG.rpcUrl,
      });

      // Teardown restores fetch and clean state
      teardownMockServer();
    });
  });
});
