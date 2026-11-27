# Testing Guide: Isolating Wallet, RPC, and Contract Behavior

This guide demonstrates how consumers can isolate wallet connections, network RPC requests, and Soroban smart contract interactions in their own application test suites using `sorokit-core/testing`.

---

## 1. Importing Test Utilities

Import test helpers strictly in test files from the `"sorokit-core/testing"` subpath:

```ts
import {
  createMockClient,
  createMockWalletAdapter,
  setupMockServerScenario,
  teardownMockServer,
  MOCK_PUBLIC_KEY,
  MOCK_NETWORK_CONFIG,
  MOCK_CONNECTED_WALLET_STATE,
} from "sorokit-core/testing";
```

> **Note**: Test utilities depend on test runners and should never be bundled into production builds.

---

## 2. Unit Testing: Isolating Wallet Behavior

Use `createMockWalletAdapter()` to test components and services without requiring real browser extension popups:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockWalletAdapter, MOCK_PUBLIC_KEY } from "sorokit-core/testing";
import { createSorokitClient, SorokitErrorCode, err } from "sorokit-core";

describe("Wallet Service", () => {
  let client: ReturnType<typeof createSorokitClient>["data"];
  let mockAdapter: ReturnType<typeof createMockWalletAdapter>;

  beforeEach(() => {
    const res = createSorokitClient({ network: "testnet" });
    if (res.status === "ok") client = res.data;
    mockAdapter = createMockWalletAdapter();
  });

  it("handles successful wallet connection", async () => {
    const conn = await client.wallet.connect(mockAdapter);
    expect(conn.status).toBe("ok");
    if (conn.status === "ok") {
      expect(conn.data.publicKey).toBe(MOCK_PUBLIC_KEY);
      expect(conn.data.isConnected).toBe(true);
    }
  });

  it("handles user signing rejection gracefully", async () => {
    // Simulate user cancelling or declining signature
    mockAdapter.signTransaction.mockResolvedValueOnce(
      err(SorokitErrorCode.WALLET_SIGN_REJECTED, "User cancelled signing")
    );

    const signResult = await mockAdapter.signTransaction({
      transactionXdr: "AAAA...",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    expect(signResult.status).toBe("error");
    if (signResult.status === "error") {
      expect(signResult.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
    }
  });
});
```

---

## 3. Unit Testing: Isolating Client & Contract Operations

Use `createMockClient({ overrides: ... })` to mock specific operations while leaving other namespaces intact:

```ts
import { describe, it, expect, vi } from "vitest";
import { createMockClient } from "sorokit-core/testing";
import { ok, err, SorokitErrorCode } from "sorokit-core";

describe("Contract Reader Component", () => {
  it("renders fetched balance when contract call succeeds", async () => {
    const client = createMockClient({
      overrides: {
        soroban: {
          read: vi.fn().mockResolvedValue(
            ok({
              result: 1500n,
              footprint: "...",
              minResourceFee: "100",
            })
          ),
        },
      },
    });

    const res = await client.soroban.read({
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      method: "balance",
      args: [],
    });

    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.result).toBe(1500n);
    }
  });

  it("handles simulation failure without crashing", async () => {
    const client = createMockClient({
      overrides: {
        soroban: {
          read: vi.fn().mockResolvedValue(
            err(SorokitErrorCode.CONTRACT_SIMULATE_FAILED, "Contract reverted")
          ),
        },
      },
    });

    const res = await client.soroban.read({
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      method: "balance",
      args: [],
    });

    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.CONTRACT_SIMULATE_FAILED);
    }
  });
});
```

---

## 4. Integration Testing & Mock Server Scenarios

For testing realistic network responses and full request pipelines, use `setupMockServerScenario()`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import {
  setupMockServerScenario,
  teardownMockServer,
} from "sorokit-core/testing";

describe("Transaction Submission Pipeline", () => {
  // CRITICAL: Always teardown mock server after each test to prevent state pollution
  afterEach(() => {
    teardownMockServer();
  });

  it("simulates successful submission scenario", async () => {
    setupMockServerScenario({
      scenario: "success",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });

    // Network calls within this test will resolve according to the configured scenario
  });
});
```

---

## 5. Test Cleanup Best Practices

To avoid flakiness and cross-test contamination in test suites:
- **Teardown Mock Servers**: Call `teardownMockServer()` in `afterEach()`.
- **Restore Mocks**: If using `vi.spyOn` or global fetch mocks, call `vi.restoreAllMocks()` or `vi.clearAllMocks()` in `afterEach()`.
- **Stateless Assertions**: Assert on `SorokitResult` status (`status === "ok"` vs `status === "error"`), verifying structured error codes rather than exact string messages.
