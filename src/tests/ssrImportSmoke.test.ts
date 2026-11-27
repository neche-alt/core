import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Entry Point Imports ─────────────────────────────────────────────────────
// All public subpaths declared in package.json exports
import * as rootEntry from "../index";
import * as coreEntry from "../core";
import * as walletEntry from "../wallet/index";
import * as accountEntry from "../account/index";
import * as transactionEntry from "../transaction/index";
import * as sorobanEntry from "../soroban/index";
import * as networkEntry from "../network/index";
import * as sharedEntry from "../shared/public";
import * as integrationEntry from "../integration/index";
import * as lazyEntry from "../lazy/index";
import * as complianceEntry from "../compliance/index";
import * as utilityEntry from "../utility/index";
import * as testingEntry from "../testing/index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SSR Import Smoke Tests (#81)", () => {
  it("evaluates all public entry points in Node without requiring browser globals", () => {
    // Assert strictly in Node environment
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof navigator).toBe("undefined");

    // Root entry point
    expect(rootEntry).toBeDefined();
    expect(typeof rootEntry.createSorokitClient).toBe("function");

    // Core entry point
    expect(coreEntry).toBeDefined();

    // Wallet entry point
    expect(walletEntry).toBeDefined();
    expect(typeof walletEntry.FreighterAdapter).toBe("function");
    expect(typeof walletEntry.LobstrAdapter).toBe("function");
    expect(typeof walletEntry.XBullAdapter).toBe("function");
    expect(typeof walletEntry.HanaAdapter).toBe("function");
    expect(typeof walletEntry.AlbedoAdapter).toBe("function");
    expect(typeof walletEntry.RabetAdapter).toBe("function");
    expect(typeof walletEntry.WalletConnectAdapter).toBe("function");

    // Account entry point
    expect(accountEntry).toBeDefined();
    expect(typeof accountEntry.getAccount).toBe("function");

    // Transaction entry point
    expect(transactionEntry).toBeDefined();
    expect(typeof transactionEntry.buildTransaction).toBe("function");

    // Soroban entry point
    expect(sorobanEntry).toBeDefined();
    expect(typeof sorobanEntry.invokeContract).toBe("function");

    // Network entry point
    expect(networkEntry).toBeDefined();
    expect(typeof networkEntry.resolveNetwork).toBe("function");

    // Shared entry point
    expect(sharedEntry).toBeDefined();
    expect(typeof sharedEntry.formatAmount).toBe("function");

    // Integration entry point
    expect(integrationEntry).toBeDefined();

    // Lazy entry point
    expect(lazyEntry).toBeDefined();

    // Compliance entry point
    expect(complianceEntry).toBeDefined();

    // Utility entry point
    expect(utilityEntry).toBeDefined();

    // Testing entry point
    expect(testingEntry).toBeDefined();
    expect(typeof testingEntry.createMockClient).toBe("function");
  });

  it("allows client and adapter instantiation during SSR without throwing", async () => {
    // Instantiating createSorokitClient in SSR should never throw
    const clientRes = rootEntry.createSorokitClient({ network: "testnet" });
    expect(clientRes.status).toBe("ok");
    if (clientRes.status === "ok") {
      const client = clientRes.data;
      expect(client).toBeDefined();
      expect(client.network.getConfig().network).toBe("testnet");
    }

    // Instantiating browser adapters in SSR should not throw
    const freighter = new walletEntry.FreighterAdapter();
    expect(freighter.isAvailable()).toBe(false);

    const connectRes = await freighter.connect();
    expect(connectRes.status).toBe("error");
    if (connectRes.status === "error") {
      expect(connectRes.error.code).toBe(rootEntry.SorokitErrorCode.WALLET_BROWSER_ONLY);
    }

    const lobstr = new walletEntry.LobstrAdapter();
    expect(lobstr.isAvailable()).toBe(false);

    const xbull = new walletEntry.XBullAdapter();
    expect(xbull.isAvailable()).toBe(false);

    const hana = new walletEntry.HanaAdapter();
    expect(hana.isAvailable()).toBe(false);

    const rabet = new walletEntry.RabetAdapter();
    expect(rabet.isAvailable()).toBe(false);
  });

  it("handles boundary case: partial/corrupted window object during SSR hydration", () => {
    // Simulate SSR edge-case where window is polyfilled or stubbed without full document
    vi.stubGlobal("window", {});

    expect(rootEntry.isBrowser()).toBe(false);
    expect(rootEntry.getEnvironment()).not.toBe("browser");

    // Storage fallback handles missing localStorage without throwing
    const storage = sharedEntry.getStorage ? sharedEntry.getStorage() : undefined;
    if (storage) {
      storage.setItem("key", "value");
      expect(storage.getItem("key")).toBe("value");
    }
  });

  it("handles boundary case: throwing localStorage (e.g. sandboxed iframe or private browsing)", () => {
    vi.stubGlobal("window", {
      document: {},
      get localStorage() {
        throw new Error("SecurityError: Access to localStorage is denied");
      },
    });

    // Should not throw and should safely resolve storage
    expect(() => {
      const storage = sharedEntry.getStorage ? sharedEntry.getStorage() : null;
      if (storage) {
        storage.setItem("test", "fallback");
        expect(storage.getItem("test")).toBe("fallback");
      }
    }).not.toThrow();
  });
});
