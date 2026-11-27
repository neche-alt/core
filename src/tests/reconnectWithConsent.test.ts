/**
 * Reconnect-on-reload with explicit consent tests (#135)
 *
 * Uses src/testing/mockClient.ts (createMockWalletAdapter) to keep the tests
 * fast and free of browser storage or network calls.
 *
 * Covers:
 * - No persisted session → outcome "no_session"
 * - Expired session → outcome "no_session"
 * - Valid session, user approves → outcome "connected" with WalletState
 * - Valid session, user rejects → outcome "rejected", session cleared
 * - Valid session, prompt throws → outcome "error", session cleared
 * - Reconnect with trust level surfaced in consent context
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconnectWithConsent } from "../wallet/reconnectWithConsent";
import { createMockWalletAdapter, MOCK_PUBLIC_KEY } from "../testing/mockClient";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { WalletState } from "../wallet/types";
import { WalletType } from "../wallet/types";

// ─── Mock sessionPersistence ──────────────────────────────────────────────────

const mockRestoreSession = vi.fn();
const mockClearSession = vi.fn();
const mockIsSessionValid = vi.fn();

vi.mock("../wallet/sessionPersistence", () => ({
  restoreSession: (...args: unknown[]) => mockRestoreSession(...args),
  clearSession: (...args: unknown[]) => mockClearSession(...args),
  isSessionValid: (s: unknown) => mockIsSessionValid(s),
}));

// ─── Mock deviceTrust ─────────────────────────────────────────────────────────

const mockGenerateFingerprint = vi.fn();
const mockEvaluateTrust = vi.fn();

vi.mock("../wallet/deviceTrust", () => ({
  generateDeviceFingerprint: () => mockGenerateFingerprint(),
  evaluateDeviceTrust: (...args: unknown[]) => mockEvaluateTrust(...args),
}));

// ─── Mock connect / disconnect ────────────────────────────────────────────────

const mockConnectWallet = vi.fn();
const mockDisconnectWallet = vi.fn();

vi.mock("../wallet/connect", () => ({
  connectWallet: (...args: unknown[]) => mockConnectWallet(...args),
}));

vi.mock("../wallet/disconnect", () => ({
  disconnectWallet: (...args: unknown[]) => mockDisconnectWallet(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_SESSION = {
  publicKey: MOCK_PUBLIC_KEY,
  walletType: "FREIGHTER",
  network: "testnet",
  connectedAt: Date.now() - 60_000,
  expiresAt: Date.now() + 60 * 60 * 1000,
};

const TRUST_RECOGNIZED = {
  score: 100,
  trusted: true,
  securityFlag: false,
  requiresVerification: false,
  reason: "recognized" as const,
};

const TRUST_FIRST_TIME = {
  score: 70,
  trusted: true,
  securityFlag: false,
  requiresVerification: false,
  reason: "first_time" as const,
};

const CONNECTED_STATE: WalletState = {
  connected: true,
  publicKey: MOCK_PUBLIC_KEY,
  walletType: WalletType.FREIGHTER,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reconnectWithConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateFingerprint.mockReturnValue({ id: "dfp_abc123", available: true, signalCount: 5 });
    mockEvaluateTrust.mockReturnValue(TRUST_RECOGNIZED);
  });

  describe("no session", () => {
    it("returns no_session when restoreSession fails", async () => {
      mockRestoreSession.mockResolvedValue(
        err(SorokitErrorCode.WALLET_NOT_CONNECTED, "No session"),
      );
      mockIsSessionValid.mockReturnValue(false);

      const adapter = createMockWalletAdapter();
      const prompt = vi.fn();
      const outcome = await reconnectWithConsent(adapter, prompt);

      expect(outcome.outcome).toBe("no_session");
      expect(prompt).not.toHaveBeenCalled();
    });

    it("returns no_session when session is expired", async () => {
      const expiredSession = { ...VALID_SESSION, expiresAt: Date.now() - 1000 };
      mockRestoreSession.mockResolvedValue(ok(expiredSession));
      mockIsSessionValid.mockReturnValue(false);

      const adapter = createMockWalletAdapter();
      const outcome = await reconnectWithConsent(adapter, vi.fn());
      expect(outcome.outcome).toBe("no_session");
    });
  });

  describe("user approves", () => {
    beforeEach(() => {
      mockRestoreSession.mockResolvedValue(ok(VALID_SESSION));
      mockIsSessionValid.mockReturnValue(true);
      mockConnectWallet.mockResolvedValue(ok(CONNECTED_STATE));
    });

    it("returns connected with WalletState", async () => {
      const adapter = createMockWalletAdapter();
      const outcome = await reconnectWithConsent(adapter, async () => true);

      expect(outcome.outcome).toBe("connected");
      if (outcome.outcome === "connected") {
        expect(outcome.state.publicKey).toBe(MOCK_PUBLIC_KEY);
        expect(outcome.state.connected).toBe(true);
      }
    });

    it("calls connectWallet with the adapter", async () => {
      const adapter = createMockWalletAdapter();
      await reconnectWithConsent(adapter, async () => true);
      expect(mockConnectWallet).toHaveBeenCalledWith(adapter, undefined, undefined);
    });

    it("does not clear the session on approval", async () => {
      const adapter = createMockWalletAdapter();
      await reconnectWithConsent(adapter, async () => true);
      expect(mockClearSession).not.toHaveBeenCalled();
    });
  });

  describe("user rejects", () => {
    beforeEach(() => {
      mockRestoreSession.mockResolvedValue(ok(VALID_SESSION));
      mockIsSessionValid.mockReturnValue(true);
    });

    it("returns rejected", async () => {
      const adapter = createMockWalletAdapter();
      const outcome = await reconnectWithConsent(adapter, async () => false);
      expect(outcome.outcome).toBe("rejected");
    });

    it("clears the session on rejection", async () => {
      const adapter = createMockWalletAdapter();
      await reconnectWithConsent(adapter, async () => false);
      expect(mockClearSession).toHaveBeenCalled();
    });

    it("does not call connectWallet on rejection", async () => {
      const adapter = createMockWalletAdapter();
      await reconnectWithConsent(adapter, async () => false);
      expect(mockConnectWallet).not.toHaveBeenCalled();
    });
  });

  describe("prompt throws", () => {
    beforeEach(() => {
      mockRestoreSession.mockResolvedValue(ok(VALID_SESSION));
      mockIsSessionValid.mockReturnValue(true);
    });

    it("returns error and clears session", async () => {
      const adapter = createMockWalletAdapter();
      const outcome = await reconnectWithConsent(adapter, async () => {
        throw new Error("Dialog closed unexpectedly");
      });

      expect(outcome.outcome).toBe("error");
      if (outcome.outcome === "error") {
        expect(outcome.error).toContain("Dialog closed");
      }
      expect(mockClearSession).toHaveBeenCalled();
    });
  });

  describe("consent context", () => {
    beforeEach(() => {
      mockRestoreSession.mockResolvedValue(ok(VALID_SESSION));
      mockIsSessionValid.mockReturnValue(true);
      mockConnectWallet.mockResolvedValue(ok(CONNECTED_STATE));
      mockEvaluateTrust.mockReturnValue(TRUST_FIRST_TIME);
    });

    it("passes trust evaluation to the prompt", async () => {
      const adapter = createMockWalletAdapter();
      let capturedContext: unknown;
      await reconnectWithConsent(adapter, async (ctx) => {
        capturedContext = ctx;
        return true;
      });

      expect((capturedContext as { trustEvaluation: typeof TRUST_FIRST_TIME }).trustEvaluation).toEqual(
        TRUST_FIRST_TIME,
      );
    });

    it("passes publicKey to the prompt", async () => {
      const adapter = createMockWalletAdapter();
      let capturedPublicKey: string | undefined;
      await reconnectWithConsent(adapter, async (ctx) => {
        capturedPublicKey = ctx.publicKey;
        return true;
      });
      expect(capturedPublicKey).toBe(MOCK_PUBLIC_KEY);
    });

    it("surfaces walletType and network from the session", async () => {
      const adapter = createMockWalletAdapter();
      let capturedContext: { walletType?: string; network?: string } | undefined;
      await reconnectWithConsent(adapter, async (ctx) => {
        capturedContext = ctx;
        return true;
      });
      expect(capturedContext?.walletType).toBe("FREIGHTER");
      expect(capturedContext?.network).toBe("testnet");
    });
  });

  describe("connect failure after approval", () => {
    beforeEach(() => {
      mockRestoreSession.mockResolvedValue(ok(VALID_SESSION));
      mockIsSessionValid.mockReturnValue(true);
      mockConnectWallet.mockResolvedValue(
        err(SorokitErrorCode.WALLET_BROWSER_ONLY, "Extension not found"),
      );
    });

    it("returns error when connectWallet fails", async () => {
      const adapter = createMockWalletAdapter();
      const outcome = await reconnectWithConsent(adapter, async () => true);
      expect(outcome.outcome).toBe("error");
      if (outcome.outcome === "error") {
        expect(outcome.error).toContain("Extension not found");
      }
    });

    it("clears the session when connect fails", async () => {
      const adapter = createMockWalletAdapter();
      await reconnectWithConsent(adapter, async () => true);
      expect(mockClearSession).toHaveBeenCalled();
    });
  });
});
