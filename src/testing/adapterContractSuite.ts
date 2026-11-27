/**
 * Reusable WalletAdapter Contract Test Suite (#74).
 *
 * Provides a standard test matrix that exercises the WalletAdapter specification:
 * - Connection success, rejection, and error handling
 * - Network-aware signing and rejection handling
 * - Missing provider and environment unavailability
 * - Account listing and active account switching (if supported)
 * - Safe, idempotent disconnect and cleanup
 *
 * Can be used by internal SDK adapter test suites and third-party adapter authors.
 */

import { describe, it, expect } from "vitest";
import type { WalletAdapter, SignTransactionInput } from "../wallet/types";
import { SorokitErrorCode } from "../shared/response";

export interface WalletAdapterContractHarness {
  /** Identifier name for the adapter under test, e.g. "FreighterAdapter" */
  name: string;
  /** Creates an adapter instance configured to succeed */
  createAvailableAdapter: () => Promise<WalletAdapter> | WalletAdapter;
  /** Creates an adapter instance whose provider is missing or unavailable */
  createUnavailableAdapter?: () => Promise<WalletAdapter> | WalletAdapter;
  /** Creates an adapter instance whose provider simulates user rejection */
  createRejectingAdapter?: () => Promise<WalletAdapter> | WalletAdapter;
  /** Creates an adapter instance configured to test multi-account capabilities */
  createMultiAccountAdapter?: () => Promise<WalletAdapter> | WalletAdapter;
  /** Optional custom sign transaction input fixture */
  sampleInput?: SignTransactionInput;
}

export function defineWalletAdapterContractTests(harness: WalletAdapterContractHarness): void {
  const sampleInput: SignTransactionInput = harness.sampleInput ?? {
    transactionXdr: "AAAA...sample_unsigned_xdr",
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  describe(`WalletAdapter Contract Suite: ${harness.name}`, () => {
    describe("Success contract", () => {
      it("reports provider availability accurately and synchronously", async () => {
        const adapter = await harness.createAvailableAdapter();
        expect(typeof adapter.isAvailable).toBe("function");
        expect(adapter.isAvailable()).toBe(true);
      });

      it("connect() returns a valid Ed25519 G-public-key with status 'ok'", async () => {
        const adapter = await harness.createAvailableAdapter();
        const res = await adapter.connect();
        expect(res.status).toBe("ok");
        if (res.status === "ok") {
          expect(typeof res.data).toBe("string");
          expect(res.data.startsWith("G")).toBe(true);
          expect(res.data.length).toBe(56);
        }
      });

      it("signTransaction() returns signed XDR string with status 'ok'", async () => {
        const adapter = await harness.createAvailableAdapter();
        const res = await adapter.signTransaction(sampleInput);
        expect(res.status).toBe("ok");
        if (res.status === "ok") {
          expect(typeof res.data).toBe("string");
          expect(res.data.length).toBeGreaterThan(0);
        }
      });

      it("disconnect() returns status 'ok' with undefined data", async () => {
        const adapter = await harness.createAvailableAdapter();
        const res = await adapter.disconnect();
        expect(res.status).toBe("ok");
        if (res.status === "ok") {
          expect(res.data).toBeUndefined();
        }
      });
    });

    if (harness.createRejectingAdapter) {
      describe("User rejection contract", () => {
        it("returns an error result when user rejects connection", async () => {
          const adapter = await harness.createRejectingAdapter!();
          const res = await adapter.connect();
          expect(res.status).toBe("error");
          if (res.status === "error") {
            expect([
              SorokitErrorCode.WALLET_SIGN_REJECTED,
              SorokitErrorCode.WALLET_CONNECT_FAILED,
            ]).toContain(res.error.code);
          }
        });

        it("returns WALLET_SIGN_REJECTED when user rejects signing", async () => {
          const adapter = await harness.createRejectingAdapter!();
          const res = await adapter.signTransaction(sampleInput);
          expect(res.status).toBe("error");
          if (res.status === "error") {
            expect(res.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
          }
        });
      });
    }

    if (harness.createUnavailableAdapter) {
      describe("Missing provider contract", () => {
        it("isAvailable() returns false when provider is missing", async () => {
          const adapter = await harness.createUnavailableAdapter!();
          expect(adapter.isAvailable()).toBe(false);
        });

        it("connect() returns an actionable error without throwing", async () => {
          const adapter = await harness.createUnavailableAdapter!();
          const res = await adapter.connect();
          expect(res.status).toBe("error");
          if (res.status === "error") {
            expect([
              SorokitErrorCode.WALLET_BROWSER_ONLY,
              SorokitErrorCode.WALLET_NOT_FOUND,
              SorokitErrorCode.WALLET_CONNECT_FAILED,
            ]).toContain(res.error.code);
          }
        });

        it("signTransaction() returns an actionable error without throwing", async () => {
          const adapter = await harness.createUnavailableAdapter!();
          const res = await adapter.signTransaction(sampleInput);
          expect(res.status).toBe("error");
          if (res.status === "error") {
            expect([
              SorokitErrorCode.WALLET_BROWSER_ONLY,
              SorokitErrorCode.WALLET_NOT_FOUND,
              SorokitErrorCode.WALLET_SIGN_FAILED,
            ]).toContain(res.error.code);
          }
        });
      });
    }

    if (harness.createMultiAccountAdapter) {
      describe("Account change contract", () => {
        it("lists connected accounts if getAccounts is supported", async () => {
          const adapter = await harness.createMultiAccountAdapter!();
          if (typeof adapter.getAccounts === "function") {
            const res = await adapter.getAccounts();
            expect(res.status).toBe("ok");
            if (res.status === "ok") {
              expect(Array.isArray(res.data)).toBe(true);
              expect(res.data.every((acc) => acc.startsWith("G"))).toBe(true);
            }
          }
        });

        it("switches active account if setActiveAccount is supported", async () => {
          const adapter = await harness.createMultiAccountAdapter!();
          if (typeof adapter.setActiveAccount === "function") {
            const target = "GBZXN7PIRZGNMHGA728RGRFZAPPWN9G8K343LMS6K324N2522774Q44M";
            const res = await adapter.setActiveAccount(target);
            expect(res.status).toBe("ok");
            if (res.status === "ok") {
              expect(res.data).toBe(target);
            }
          }
        });
      });
    }

    describe("Cleanup and state idempotency", () => {
      it("disconnect() can be called multiple times without throwing", async () => {
        const adapter = await harness.createAvailableAdapter();
        const res1 = await adapter.disconnect();
        const res2 = await adapter.disconnect();
        expect(res1.status).toBe("ok");
        expect(res2.status).toBe("ok");
      });
    });
  });
}
