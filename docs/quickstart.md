# Canonical SDK Quickstart: Sorokit Core

This guide provides a verified path from installation to your first successful wallet and contract operation using `sorokit-core`.

---

## 1. Prerequisites

Before using `sorokit-core`, ensure you have:
- **Node.js**: Version 18.x or higher (Node 20+ or 22+ recommended)
- **Package Manager**: `npm`, `pnpm`, or `yarn`
- **Stellar Account**: A public key (`G...`) on Stellar Testnet or Mainnet (you can fund a testnet account via Friendbot)
- **Browser Wallet (Optional)**: If connecting in the browser, install the [Freighter browser extension](https://www.freighter.app/)

---

## 2. Installation

Install `sorokit-core` and the required peer dependencies:

```bash
# Core SDK + Stellar SDK
npm install sorokit-core @stellar/stellar-sdk

# If connecting browser wallets via StellarWalletsKit:
npm install @creit.tech/stellar-wallets-kit
```

With `pnpm`:
```bash
pnpm add sorokit-core @stellar/stellar-sdk @creit.tech/stellar-wallets-kit
```

With `yarn`:
```bash
yarn add sorokit-core @stellar/stellar-sdk @creit.tech/stellar-wallets-kit
```

---

## 3. Supported Imports

`sorokit-core` supports root and subpath imports with full TypeScript type definitions:

```ts
// Root entrypoint — client creation, common adapters, response helpers, and error codes
import {
  createSorokitClient,
  FreighterAdapter,
  WalletType,
  ok,
  err,
  SorokitErrorCode,
} from "sorokit-core";

// Subpath imports — modular access
import { connectWallet, disconnectWallet } from "sorokit-core/wallet";
import { readContract, simulateTransaction } from "sorokit-core/soroban";
import { getAccount, getBalances } from "sorokit-core/account";
import { buildPayment, submitTransaction } from "sorokit-core/transaction";
import { resolveNetwork, NETWORK_DEFAULTS } from "sorokit-core/network";

// Testing utilities (mock client & mock wallet adapter)
import { createMockClient, createMockWalletAdapter } from "sorokit-core/testing";
```

---

## 4. First Wallet Operation (Connect & Read Balances)

`sorokit-core` uses a strict **no-throw result model** (`SorokitResult<T>`). Every operation returns `{ status: "ok", data: T }` or `{ status: "error", error: SorokitError }`.

### Browser (Freighter / StellarWalletsKit)

```ts
import { createSorokitClient, FreighterAdapter } from "sorokit-core";
import { StellarWalletsKit, WalletNetwork, allowAllModules } from "@creit.tech/stellar-wallets-kit";

// 1. Initialize Sorokit client for Testnet
const clientResult = createSorokitClient({ network: "testnet" });
if (clientResult.status === "error") {
  console.error("Client initialization failed:", clientResult.error.message);
  return;
}
const client = clientResult.data;

// 2. Initialize StellarWalletsKit and wrap with FreighterAdapter
const swk = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: "freighter",
  modules: allowAllModules(),
});
const adapter = new FreighterAdapter(swk);

// 3. Connect wallet
const connection = await client.wallet.connect(adapter);
if (connection.status === "error") {
  console.error("Wallet connection failed:", connection.error.message);
  return;
}

const { publicKey } = connection.data;
console.log("Connected wallet public key:", publicKey);

// 4. Fetch account info and balances
const accountResult = await client.account.get(publicKey);
if (accountResult.status === "ok") {
  console.log("Account balances:", accountResult.data.balances);
} else {
  console.error("Failed to fetch account:", accountResult.error.message);
}
```

### Headless / Testing Environment

In automated tests or server-side scripts where browser extensions are not present, use the built-in testing adapter:

```ts
import { createSorokitClient } from "sorokit-core";
import { createMockWalletAdapter, MOCK_PUBLIC_KEY } from "sorokit-core/testing";

const clientResult = createSorokitClient({ network: "testnet" });
if (clientResult.status === "ok") {
  const client = clientResult.data;
  const mockAdapter = createMockWalletAdapter();

  const conn = await client.wallet.connect(mockAdapter);
  if (conn.status === "ok") {
    console.log("Connected to test wallet:", conn.data.publicKey);
  }
}
```

---

## 5. First Soroban Contract Operation (Read-Only Call)

Simulating or reading a Soroban smart contract view function does **not** require a wallet signature or transaction fees.

```ts
import { createSorokitClient } from "sorokit-core";

// 1. Initialize client
const clientResult = createSorokitClient({ network: "testnet" });
if (clientResult.status === "error") {
  throw new Error(clientResult.error.message);
}
const client = clientResult.data;

// 2. Read from a deployed Soroban contract
const readResult = await client.soroban.read({
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  method: "balance",
  args: [], // Native arguments or ScVal array
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
});

if (readResult.status === "ok") {
  console.log("Contract call result:", readResult.data.result);
} else {
  console.error("Contract read failed with code:", readResult.error.code);
  console.error("Actionable hint:", readResult.error.recovery?.action);
}
```

---

## 6. Boundary and Failure Cases

Every failure returns structured metadata you can inspect without parsing strings:

```ts
import { createSorokitClient, SorokitErrorCode } from "sorokit-core";

const clientResult = createSorokitClient({ network: "testnet" });
if (clientResult.status === "ok") {
  const client = clientResult.data;

  // Attempting an invalid contract ID fails gracefully:
  const res = await client.soroban.read({
    contractId: "invalid-id",
    method: "test",
  });

  if (res.status === "error") {
    switch (res.error.code) {
      case SorokitErrorCode.INVALID_CONFIG:
      case SorokitErrorCode.VALIDATION:
        console.warn("Input validation failed:", res.error.message);
        break;
      case SorokitErrorCode.CONTRACT_READ_FAILED:
      case SorokitErrorCode.CONTRACT_SIMULATE_FAILED:
        console.warn("Contract read or simulation failed:", res.error.message);
        break;
      default:
        console.warn("Unexpected failure:", res.error.message);
    }
  }
}
```
