import { describe, expect, it, vi } from "vitest";
import { getWalletCapabilities, WALLET_CAPABILITY_IDS } from "../wallet/capabilities";
import { WalletType } from "../wallet/types";
import type { WalletAdapter, SWKInstance } from "../wallet/types";
import { FreighterAdapter } from "../wallet/adapters/freighter";
import { XBullAdapter } from "../wallet/adapters/xbull";
import { AlbedoAdapter } from "../wallet/adapters/albedo";
import { LobstrAdapter } from "../wallet/adapters/lobstr";
import { RabetAdapter } from "../wallet/adapters/rabet";
import { HanaAdapter } from "../wallet/adapters/hana";

describe("Wallet Adapter Selection & Capabilities", () => {
  const mockSwk: SWKInstance = {
    setWallet: vi.fn(),
    getPublicKey: vi.fn().mockResolvedValue("GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV"),
    signTransaction: vi.fn().mockResolvedValue("AAAA..."),
    signAuthEntry: vi.fn().mockResolvedValue("BBBB..."),
  };

  describe("Capabilities inspection across adapters", () => {
    it("reports full capabilities for FreighterAdapter including multisig", () => {
      const adapter = new FreighterAdapter(mockSwk);
      expect(adapter.walletType).toBe(WalletType.FREIGHTER);
      expect(adapter.name).toBe("Freighter");

      const caps = getWalletCapabilities(adapter);
      expect(caps.supported.length).toBeGreaterThan(0);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSign);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSignMultisig);
    });

    it("reports hardware bridging and multisig capabilities for XBullAdapter", () => {
      const adapter = new XBullAdapter(mockSwk);
      expect(adapter.walletType).toBe(WalletType.XBULL);

      const caps = getWalletCapabilities(adapter);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSign);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.hardwareSigning);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSignMultisig);
    });

    it("reports standard sign capability for AlbedoAdapter without multisig or hardware", () => {
      const adapter = new AlbedoAdapter();
      expect(adapter.walletType).toBe(WalletType.ALBEDO);

      const caps = getWalletCapabilities(adapter);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.accountRead);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSign);
      expect(caps.supported).not.toContain(WALLET_CAPABILITY_IDS.hardwareSigning);
      expect(caps.supported).not.toContain(WALLET_CAPABILITY_IDS.qrSigning);
    });

    it("reports multisig capability for LobstrAdapter", () => {
      const adapter = new LobstrAdapter(mockSwk);
      expect(adapter.walletType).toBe(WalletType.LOBSTR);

      const caps = getWalletCapabilities(adapter);
      expect(caps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSignMultisig);
    });

    it("reports browser-standard capabilities for Hana and Rabet adapters", () => {
      const hana = new HanaAdapter(mockSwk);
      expect(hana.walletType).toBe(WalletType.HANA);
      const hanaCaps = getWalletCapabilities(hana);
      expect(hanaCaps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSign);

      const rabet = new RabetAdapter();
      expect(rabet.walletType).toBe(WalletType.RABET);
      const rabetCaps = getWalletCapabilities(rabet);
      expect(rabetCaps.supported).toContain(WALLET_CAPABILITY_IDS.transactionSign);
    });
  });

  describe("Connection and signing failure boundaries", () => {
    it("handles Rabet adapter when window.rabet is unavailable", async () => {
      const adapter = new RabetAdapter();
      const isAvailable = await adapter.isAvailable();
      // In Node environment, window.rabet is undefined
      expect(isAvailable).toBe(false);

      const connectRes = await adapter.connect();
      expect(connectRes.status).toBe("error");
      expect(connectRes.error.message).toContain("Rabet");
    });

    it("handles SWK rejection when user cancels connection", async () => {
      const failingSwk: SWKInstance = {
        setWallet: vi.fn(),
        getPublicKey: vi.fn().mockRejectedValue(new Error("User rejected connection")),
        signTransaction: vi.fn(),
      };

      const adapter = new FreighterAdapter(failingSwk);
      const conn = await adapter.connect();
      expect(conn.status).toBe("error");
      expect(conn.error.message).toContain("User rejected connection");
    });

    it("handles signTransaction error on SWK failure", async () => {
      const failingSwk: SWKInstance = {
        setWallet: vi.fn(),
        getPublicKey: vi.fn().mockResolvedValue("G123..."),
        signTransaction: vi.fn().mockRejectedValue(new Error("Transaction rejected by user")),
      };

      const adapter = new FreighterAdapter(failingSwk);
      const signRes = await adapter.signTransaction({
        transactionXdr: "AAAA...",
        networkPassphrase: "Test SDF Network ; September 2015",
      });

      expect(signRes.status).toBe("error");
      expect(signRes.error.message).toContain("Transaction rejected by user");
    });
  });
});
