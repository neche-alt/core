<div align="center">

<h1>sorokit-core</h1>

<p><strong>Framework-agnostic TypeScript SDK for Stellar.</strong></p>

<p>
  The execution layer for wallet connection, transaction handling,<br/>
  and Soroban smart contract interaction — with a no-throw result model throughout.
</p>

<p>
  <a href="https://github.com/Just-Bamford/sorokit-core/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
  <img src="https://img.shields.io/badge/typescript-%5E5.0-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/stellar-mainnet%20%7C%20testnet%20%7C%20futurenet-6f42c1" alt="Stellar Networks" />
  <img src="https://img.shields.io/badge/runtime-node%20%7C%20browser-brightgreen" alt="Node + Browser" />
</p>

<p>Part of the <a href="https://github.com/Just-Bamford">sorokit</a> ecosystem.</p>

<br/>

</div>

---

## Overview

`sorokit-core` gives you a single typed client for everything you need to build on Stellar: connecting wallets, reading accounts, building and submitting transactions, and invoking Soroban contracts. Every function returns a `SorokitResult<T>` — no try/catch, no uncaught promise rejections, no surprises.

It is deliberately stateless and framework-agnostic. It runs in Node, the browser, React, Vue, Svelte, or any environment that can execute TypeScript — with no opinion about how you manage state.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Supported Imports](#supported-imports)
- [Modules](#modules)
- [API Reference](#api-reference)
- [wallet](#wallet)
  - [account](#account)
  - [transaction](#transaction)
  - [soroban](#soroban)
- [Result Type](#result-type)
- [Wallet Adapters](#wallet-adapters)
- [Network Management](#network-management)
- [Streaming](#streaming)
- [Networks](#networks)
- [Testing Utilities](#testing-utilities)
- [Examples](#examples)
- [Recipes and Cookbook](#recipes-and-cookbook)
- [Workflow and Architecture Guides](#workflow-and-architecture-guides)
- [Video Tutorials](#video-tutorials)
- [New in This Release](#new-in-this-release)
- [Design Principles](#design-principles)
- [Release Automation](#release-automation)
- [License](#license)

---

## Prerequisites

- **Node.js**: `^18.0.0 || ^20.0.0 || ^22.0.0`
- **TypeScript**: `^5.0.0` (recommended)
- **Stellar Account**: Keypair on Stellar Testnet or Mainnet
- **Browser Extension (optional)**: [Freighter](https://www.freighter.app/) for interactive browser signing

---

## Installation

```bash
# Core SDK and Stellar SDK
npm install sorokit-core @stellar/stellar-sdk

# If using browser wallet adapters via StellarWalletsKit:
npm install @creit.tech/stellar-wallets-kit
```

---

## Supported Imports

`sorokit-core` provides both a root entrypoint and focused subpath imports:

```ts
// Root entrypoint
import {
  createSorokitClient,
  FreighterAdapter,
  WalletType,
  ok,
  err,
  SorokitErrorCode,
} from "sorokit-core";

// Modular subpaths
import { FreighterAdapter, WalletType } from "sorokit-core/wallet";
import { readContract, simulateTransaction } from "sorokit-core/soroban";
import { resolveNetwork, NETWORK_DEFAULTS } from "sorokit-core/network";
import { createMockWalletAdapter, createMockClient } from "sorokit-core/testing";
```

---

## Quick Start

A complete verified guide is available in [Canonical Quickstart Guide](docs/quickstart.md).

```ts
import { createSorokitClient, FreighterAdapter } from "sorokit-core";
import { StellarWalletsKit, WalletNetwork, allowAllModules } from "@creit.tech/stellar-wallets-kit";

// 1. Initialize client for Testnet
const clientResult = createSorokitClient({ network: "testnet" });
if (clientResult.status === "error") throw new Error(clientResult.error.message);
const client = clientResult.data;

// 2. Connect a wallet (e.g. Freighter via StellarWalletsKit)
const swk = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: "freighter",
  modules: allowAllModules(),
});
const adapter = new FreighterAdapter(swk);
const conn = await client.wallet.connect(adapter);
if (conn.status === "error") throw new Error(conn.error.message);

const { publicKey } = conn.data;
console.log("Connected public key:", publicKey);

// 3. First Wallet Operation: Fetch balances
const account = await client.account.get(publicKey);
if (account.status === "ok") {
  console.log("Balances:", account.data.balances);
}

// 4. First Contract Operation: Read-only contract call (simulation)
const contractResult = await client.soroban.read({
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  method: "balance",
  args: [],
  publicKey,
});

if (contractResult.status === "ok") {
  console.log("Contract value:", contractResult.data.result);
} else {
  console.error("Read failed:", contractResult.error.message);
}
```

---

## Modules

| Module        | Responsibility                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `wallet`      | Connect/disconnect wallets, sign transactions, offline signing, wallet status tracking                        |
| `account`     | Fetch account info, balances, stream state, balance alerts, activity summaries, key rotation, sponsorship     |
| `transaction` | Build/submit/track transactions, fee estimation, multi-sig support, path payments, history export, webhooks   |
| `soroban`     | Read/invoke contracts, simulate transactions, contract interaction builder, event decoding, deploy validation |
| `network`     | Network configuration, circuit breaker, dynamic network switching, network resolution                         |
| `shared`      | Logging, tracing, caching, configuration, validation, server factory                                          |

---

## API Reference

The [hosted API reference](https://tochukwujustice.github.io/core/) is published by
GitHub Actions after a successful deployment. It documents the public exports from
`src/index.ts`, including parameter descriptions, return values, and examples.

### Task-Based Navigation

If you are looking to accomplish a specific goal, jump straight to the relevant task guide and recipes:

| Task | Primary API | Key Recipes & Guides |
| :--- | :--- | :--- |
| **Connect Wallet** | `client.wallet.connect`, `FreighterAdapter` | [Key rotation](docs/recipes/08-key-rotation.md), [Account recovery](docs/recipes/10-account-recovery.md) |
| **Check Balances** | `client.account.get`, `client.account.stream` | [Trustlines](docs/recipes/11-trustline-management.md), [Balance alerts](docs/recipes/13-balance-alerts-streaming.md) |
| **Send Payments** | `client.transaction.buildPayment`, `submit` | [Fee estimation](docs/recipes/15-fee-estimation.md), [Batch payment](docs/recipes/05-batch-payment.md), [Memos](docs/recipes/09-payment-with-memo.md) |
| **Smart Contracts** | `client.soroban.read`, `invoke`, `buildContractDeploy` | [Soroban invoke](docs/recipes/04-soroban-invoke.md), [Deployment](docs/recipes/14-contract-deployment.md), [NFT minting](docs/recipes/20-nft-minting.md) |
| **DEX & Swaps** | `client.transaction.buildPathPayment` | [Atomic swap](docs/recipes/03-dex-atomic-swap.md), [DEX routing](docs/recipes/19-dex-routing.md), [Offers](docs/recipes/07-offer-management.md) |
| **Multi-Sig** | `MultiSigContractExecution` | [Multi-sig approval](docs/recipes/01-multisig-approval.md) |

Generate and view full TypeDoc reference locally:

```bash
npm ci --legacy-peer-deps
npm run docs
```

Open `docs/api/index.html` in a browser. Generated HTML is ignored by Git.

The documentation workflow validates pull requests, and publishes on pushes to
`main`, published releases, and manual runs. To enable hosting for this repository,
select **Settings → Pages → Build and deployment → Source → GitHub Actions**,
then run the workflow. The workflow also preserves generated HTML on `gh-pages`.
Ensure the `github-pages` environment permits the branches and release tags you
intend to deploy. For a fork, use
`https://<owner>.github.io/<repository>/` and update the hosted link above.
Documentation is only live after the workflow and GitHub Pages deployment succeed.

### `wallet`

```ts
client.wallet.connect(adapter); // → SorokitResult<WalletState>
client.wallet.disconnect(adapter); // → SorokitResult<WalletState>
client.wallet.signTransaction(adapter, input); // → SorokitResult<string>
client.wallet.emptyState(); // → SorokitResult<WalletState>
```

### `account`

```ts
// Fetch full account info
client.account.get(publicKey); // → SorokitResult<AccountInfo>

// Fetch all balances
client.account.getBalances(publicKey); // → SorokitResult<AssetBalance[]>

// Filter balances by asset code, issuer, type, or exclude zero balances
client.account.getAssetBalances(publicKey, {
  assetCode: "USDC",
  assetIssuer: "GA5Z...",
  excludeZero: true,
}); // → SorokitResult<AssetBalance[]>

// Get account activity summary (new)
client.account.getAccountActivitySummary(publicKey); // → SorokitResult<ActivitySummary>

// Create balance alerts (new)
client.account.createBalanceAlert(publicKey, {
  minBalance: "100",
  onAlert: (balance) => console.log("Low balance alert"),
});

// Rotate account keys (new)
client.account.rotateKey(publicKey, params); // → SorokitResult<Transaction>

// Manage account sponsorship (new)
client.account.sponsorAccount(publicKey, sponsorKey); // → SorokitResult<Transaction>

// Poll Horizon and stream account state changes
for await (const result of client.account.stream(publicKey)) {
  if (result.status === "ok") console.log(result.data.balances);
}
```

### `transaction`

```ts
// Build common transaction types (returns XDR string)
client.transaction.buildPayment(sourceKey, params); // → SorokitResult<string>
client.transaction.buildCreateAccount(sourceKey, params); // → SorokitResult<string>
client.transaction.buildTrustline(sourceKey, params); // → SorokitResult<string>

// Build multi-signature transactions (new)
client.transaction.buildMultiSigTransaction(sourceKey, params); // → SorokitResult<string>

// Build path payments (new)
client.transaction.buildPathPayment(sourceKey, params); // → SorokitResult<string>

// Submit and query
client.transaction.submit(signedXdr); // → SorokitResult<TransactionResult>
client.transaction.getStatus(hash); // → SorokitResult<TransactionResult>

// Estimate fee from a pre-built XDR
client.transaction.estimateFee({ kind: "xdr", transactionXdr: xdr });

// Or estimate from payment params directly
client.transaction.estimateFee({
  kind: "payment",
  publicKey,
  destination: "GDEST...",
  amount: "10",
}); // → SorokitResult<FeeEstimate>

// Get fee analytics (new)
client.transaction.getFeeAnalytics(params); // → SorokitResult<FeeAnalytics>

// Query transaction history (new)
client.transaction.queryTransactionHistory(publicKey, { limit: 50 }); // → SorokitResult<Transaction[]>

// Export transaction history (new)
client.transaction.exportTransactionHistory(publicKey, format); // → SorokitResult<string>

// Validate destination (new)
client.transaction.validateDestination("GDEST..."); // → SorokitResult<boolean>

// Validate transaction offline (new)
client.transaction.validateTransactionOffline(transactionXdr); // → SorokitResult<ValidationResult>

// Stream transactions for an account
for await (const result of client.transaction.stream(publicKey)) {
  if (result.status === "ok") console.log(result.data.transactions);
}

// Batch submission — submit many signed XDRs at once
import { submitBatch, suggestRetryStrategy, getTransactionStatus } from "sorokit-core/transaction";

const batch = await submitBatch([xdr1, xdr2, xdr3], {
  horizonUrl,
  networkPassphrase,
  mode: "sequential", // or "parallel"
});

if (batch.status === "ok") {
  // Per-item failures never abort the whole batch. Check each entry individually.
  for (const [i, tx] of batch.data.transactions.entries()) {
    if (tx.status === "failed") console.error(`Item ${i} failed: ${tx.error}`);
  }

  // Inspect one item by index
  const item = getTransactionStatus(batch.data, 0);

  // Get a retry strategy based on the mix of successes and failures
  const { data: retry } = suggestRetryStrategy(batch.data);
  // retry.strategy: "none" | "retry_failed" | "retry_all"
  // retry.failedIndices: number[] — indices of the failed items
}
```

#### Network-aware fee estimation

Fee estimates adapt to the target network instead of assuming a single global
base fee. The floor/fallback used by `estimateFee`, `calculateFeeTiers`,
`fetchFeeTiers` and `fetchCongestionFeeEstimate` is derived from the network's
effective base fee:

| Network     | Base-fee multiplier | Effective floor |
|-------------|---------------------|-----------------|
| `mainnet`   | 1×                  | 100 stroops     |
| `testnet`   | 1×                  | 100 stroops     |
| `futurenet` | 2×                  | 200 stroops     |
| custom      | 1× (default)        | 100 stroops     |

Simulated `minResourceFee` values are clamped up to this floor so a low
simulation can never recommend a fee the network would reject, and fee tiers /
congestion estimates fall back to the same floor when Horizon has no data.
Custom networks can override the policy with `baseFeeMultiplier` on their
resolved network config. Surge detection (fee > 2× the recent median) is
unchanged and still triggers `onFeeSurge`.

```ts
import {
  getNetworkBaseFee,
  NETWORK_BASE_FEE_MULTIPLIERS,
} from "sorokit-core/transaction";

getNetworkBaseFee("futurenet");              // 200
NETWORK_BASE_FEE_MULTIPLIERS.futurenet;      // 2
```

#### Bounded Horizon pagination

`exportTransactionHistory` and `queryTransactionHistory` walk Horizon pages by
advancing a cursor to the last record's `paging_token`. Traversal is bounded so
a misbehaving endpoint cannot lose data or loop forever:

- a page with **no records** ends the sweep;
- a **full page whose last record has no `paging_token`** (a malformed next link)
  ends the sweep without following the broken link;
- a **repeated cursor** — a full page whose last `paging_token` does not advance —
  ends the sweep instead of fetching the same page forever;
- a hard cap (`HORIZON_MAX_PAGES`) limits the total number of pages fetched.

```ts
import {
  exportTransactionHistory,
  HORIZON_PAGE_LIMIT,
  HORIZON_MAX_PAGES,
} from "sorokit-core/transaction";

HORIZON_PAGE_LIMIT; // 200 — records requested per Horizon page
HORIZON_MAX_PAGES;  // safety cap on pages fetched in one sweep

const result = await exportTransactionHistory(horizonUrl, publicKey, {
  format: "json",
});
```

Deterministic fixtures covering first, middle, final, empty, malformed-link,
and repeated-cursor pages live in `src/tests/horizonPaginationFixtures.test.ts`.

### Smaller imports

The SDK also exposes module bundles for applications that only need one part of the API:

```ts
import { FreighterAdapter } from "sorokit-core/wallet";
import { buildSetOptionsTransaction } from "sorokit-core/transaction";
import { getOffers } from "sorokit-core/account";
```

These subpaths emit independent ESM, CommonJS, and declaration files while the root import remains backward compatible.

### `soroban`

```ts
client.soroban.simulate(transactionXdr)         // → SorokitResult<SimulateTransactionResult>
client.soroban.prepare(params)                  // → SorokitResult<PreparedContractCall>
client.soroban.execute(signedXdr)               // → SorokitResult<string> (tx hash)
client.soroban.read(params)                     // → SorokitResult<ContractCallResult>

// Contract interaction builder (new)
const builder = new ContractInteractionBuilder(client, contractId);
builder
  .method('transfer')
  .arg('to', destination)
  .arg('amount', amount)
  .build();

// Contract state tracking (new)
client.soroban.trackContractState(contractId, keys); // → AsyncGenerator

// Decode contract events (new)
client.soroban.decodeContractEvent(event); // → DecodedEvent | null

// Get contract call identity (new)
client.soroban.getCallIdentity(contractId); // → SorokitResult<ContractIdentity>

// Parse contract results (new)
client.soroban.parseContractResult(result); // → SorokitResult<ParsedResult>

// Simulate before execution (new)
client.soroban.simulator.simulate(transaction); // → SorokitResult<SimulationResult>

// Get factory statistics (new)
client.soroban.getFactoryStatistics(factoryId); // → SorokitResult<FactoryStats>

// Full invoke pipeline: prepare → sign → execute in one call
client.soroban.invoke(params, (xdr) =>
  adapter.signTransaction({ transactionXdr: xdr, ... })
)
```

#### Nested contract failure decoding

`decodeNestedContractFailure` traverses a full failure tree from a simulation or invocation
error without dropping the original RPC response:

```ts
import { decodeNestedContractFailure, formatNestedContractFailure } from "sorokit-core";

const tree = decodeNestedContractFailure(simulationError);

// Human-readable indented summary
console.log(formatNestedContractFailure(tree));
// [0] ROUTER_SLIPPAGE_EXCEEDED: The realized swap price exceeded …
//   [1] ROUTER_INSUFFICIENT_LIQUIDITY: Insufficient liquidity …

// Programmatic access — raw value preserved at every node
for (const node of tree.flat) {
  console.log(node.depth, node.decoded.message, node.decoded.raw);
}
```

See [docs/nested-contract-failures.md](docs/nested-contract-failures.md) for full details.

#### Contract deployment

`buildContractDeploy` validates its configuration before any network call, so a
missing endpoint or a malformed deployer address fails immediately with an
`INVALID_CONFIG` error naming every offending field and how to fix it. Call the
same check directly from a deployment script to fail before you spend a build:

```ts
import { validateDeployConfig, collectDeployConfigIssues } from "sorokit-core";

const check = validateDeployConfig({
  rpcUrl,
  horizonUrl,
  networkConfig,
  deployer,
});
if (check.status === "error") {
  console.error(check.error.message);
  // Deployment configuration is invalid — 2 problems found:
  //   1. rpcUrl — rpcUrl is missing. Fix: Set rpcUrl to the Soroban RPC endpoint …
  //   2. deployer — deployer is not a valid Stellar public key: "GNOPE". Fix: …
  process.exit(1);
}

// Or render the issues yourself — each has { field, reason, hint }
const issues = collectDeployConfigIssues({
  rpcUrl,
  horizonUrl,
  networkConfig,
  deployer,
});
```

`buildContractDeploy` also validates the WASM itself before any network call.
A missing, oversized, or structurally malformed module fails locally with a
`TX_BUILD_FAILED` error naming the exact problem, instead of surfacing later as
an opaque RPC or simulation failure after the upload attempt. Run the same
check from a deployment script to fail before you spend a build:

```ts
import { validateContractWasm } from "sorokit-core";
import fs from "node:fs";

const wasm = fs.readFileSync("contract.wasm");
const wasmCheck = validateContractWasm(wasm);
if (wasmCheck.status === "error") {
  console.error(wasmCheck.error.message);
  // Contract WASM is missing or empty. …
  // Invalid WASM format: section 1 declares 500 bytes but only 8 remain (truncated module).
  // Invalid WASM format: unsupported version. Only WASM version 1 … is supported.
  process.exit(1);
}
```

The WASM check covers the magic and version-1 headers, the 256 KB deploy size
limit, and a structural walk of the section table — truncated length encodings,
sections that overflow the buffer, unknown section ids, and duplicate known
sections — all without I/O.

---

## Result Type and Error Handling

Every function in `sorokit-core` returns a `SorokitResult<T>`. Nothing throws. Nothing rejects silently.

```ts
type SorokitResult<T> =
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: SorokitError };
```

**Usage:**

```ts
const result = await client.account.get(publicKey);

if (result.status === "ok") {
  console.log(result.data.balances);
} else {
  console.error(result.error.code, result.error.message);
}
```

### Distinguishing Error Domains

Developers can safely distinguish between the 5 operational failure domains using `classifyErrorDomain` or dedicated predicate helpers:

```ts
import {
  classifyErrorDomain,
  isInvalidInputError,
  isWalletRejectionError,
  isNetworkFailureError,
  isSimulationFailureError,
  isLedgerExecutionError,
} from "sorokit-core";

const domain = classifyErrorDomain(result.error);
switch (domain) {
  case "invalid_input":
    // Client-side validation failed; do not retry without correcting inputs
    break;
  case "wallet_rejection":
    // User declined signing in wallet; notify user cleanly
    break;
  case "network_failure":
    // Transport or rate limit failure; safe to retry with backoff
    break;
  case "simulation_failure":
    // Contract execution reverted; inspect error.cause, do not submit to ledger
    break;
  case "ledger_execution_failure":
    // Failed consensus (sequence mismatch or fee surge); refresh sequence and retry
    break;
}
```

For full error codes, causes, and safe recovery procedures, see the [Structured SDK Error Reference](docs/error-reference.md).

---

## Wallet Adapters

Four adapters ship with `sorokit-core`. All require a [Stellar Wallets Kit](https://github.com/creit-tech/stellar-wallets-kit) instance initialised separately:

```ts
import {
  FreighterAdapter,
  XBullAdapter,
  LobstrAdapter,
  HanaAdapter,
  SWKSignAdapter,
} from "sorokit-core";

const adapter = new FreighterAdapter(swkInstance);
const adapter = new XBullAdapter(swkInstance);
const adapter = new LobstrAdapter(swkInstance);
const adapter = new HanaAdapter(swkInstance); // NEW
const adapter = new SWKSignAdapter(swkInstance); // NEW
```

**New Features:**

- `HanaAdapter` - Support for Hana wallet integration
- `SWKSignAdapter` - Custom SWK-based signing adapter
- `signTransactionOffline()` - Sign transactions without wallet connection (NEW)
- `walletStatusTracker` - Real-time wallet connection monitoring (NEW)
- `defineWalletAdapterContractTests` - Reusable conformance test suite exported via `sorokit-core/testing` (NEW)

Pass the adapter to `client.wallet.connect()` and `client.wallet.signTransaction()`. The adapter is the only stateful object in the system — the client itself remains stateless.

---

## Network Management

The SDK includes a circuit breaker, endpoint failover, and dynamic network switching.

### Circuit breaker

`CircuitBreaker` and `CircuitBreakerRegistry` wrap individual RPC calls and enforce a fail-fast ceiling once an endpoint accumulates consecutive transient failures (5xx, timeout, or network error). Permanent errors (404, bad params) pass through without tripping the circuit.

```ts
import { CircuitBreaker, CircuitBreakerRegistry } from "sorokit-core";

// Per-endpoint breaker (create one instance, reuse across calls)
const cb = new CircuitBreaker("https://soroban-testnet.stellar.org", {
  failureThreshold: 5,       // trip after 5 consecutive transient failures
  recoveryWindowMs: 60_000,  // wait 60 s before allowing a probe request
  onStateChange: (evt) => console.log(evt.from, "→", evt.to),
});

const result = await cb.call(() => rpc.simulateTransaction(tx));

// Registry — shared breaker per endpoint, no manual wiring needed
const registry = new CircuitBreakerRegistry({ failureThreshold: 5 });
await registry.call(rpcUrl, () => rpc.simulateTransaction(tx));
```

**State machine:** `CLOSED` (normal) → `OPEN` (fail-fast) → `HALF_OPEN` (probe) → `CLOSED` (recovered) or back to `OPEN` (probe failed).

Call `cb.reset()` or `registry.resetAll()` to restore `CLOSED` state manually — useful between tests.

### Endpoint failover

`EndpointPool` manages an ordered list of RPC endpoints. `createFailoverFetch` wraps `fetch` so that retryable responses (408, 425, 429, 5xx) and network errors automatically retry against the next healthy endpoint. The retry ceiling equals the number of configured endpoints — a failed write operation is never retried more times than there are endpoints.

```ts
import { EndpointPool, createFailoverFetch, configureEndpointFailover } from "sorokit-core";

const pool = configureEndpointFailover(
  "https://primary-rpc.example.com",
  ["https://backup-rpc.example.com"],
  { failureThreshold: 2, recoveryIntervalMs: 30_000 },
);

const fetchWithFailover = createFailoverFetch(pool);
// Use fetchWithFailover anywhere you would pass a custom fetch to the Stellar SDK.
```

Health is tracked per-endpoint: `pool.markSuccess()` / `pool.markFailure()` update the state, and `pool.getHealth()` returns a snapshot. `pool.check()` performs active probes and `pool.startHealthMonitoring()` runs them on a periodic interval — call the returned teardown function to stop.

### Dynamic network switching

```ts
// Switch at runtime — no client recreation needed
client.network.switchNetwork("mainnet");

// Programmatic endpoint resolution
const resolved = await client.network.resolveNetwork("testnet");
if (resolved.status === "ok") {
  console.log(resolved.data.horizonUrl, resolved.data.rpcUrl);
}
```

---

## Streaming

Account and transaction streams use async generators and poll Horizon at a configurable interval. Use an `AbortController` to stop a stream at any point:

```ts
const ac = new AbortController();

for await (const result of client.account.stream(
  publicKey,
  { intervalMs: 3000 },
  ac.signal,
)) {
  if (result.status === "ok") {
    // handle state update
  }
}

// Stop the stream from anywhere
ac.abort();
```

The same pattern applies to `client.transaction.stream()`.

### Cursor-based resumption

Transaction streams yield a `nextCursor` on each page. Save it with `createCursorStore()` and pass it back as `cursor` to resume without replaying history. Use `PersistentEventDeduplicationStore` to prevent duplicate processing across reconnects:

```ts
import { streamTransactions, createCursorStore, PersistentEventDeduplicationStore } from "sorokit-core";

const cursorStore = createCursorStore(); // localStorage in browsers, memory in Node
const dedup = new PersistentEventDeduplicationStore();
const CURSOR_KEY = `tx-stream:${publicKey}`;

const savedCursor = await cursorStore.load(CURSOR_KEY);
const ac = new AbortController();

for await (const result of streamTransactions(horizonUrl, publicKey, {
  cursor: savedCursor,
  order: "asc",
  enableAutoRetry: true,
}, ac.signal)) {
  if (result.status === "ok") {
    for (const tx of result.data.transactions) {
      if (await dedup.has(tx.hash)) continue;
      await processTransaction(tx);
      await dedup.add(tx.hash);
    }
    if (result.data.nextCursor !== null) {
      await cursorStore.save(CURSOR_KEY, result.data.nextCursor);
    }
  }
}
```

For the full specification — startup semantics, reconnect backoff schedule, cursor ordering requirements, delivery guarantees, and event-emitter backpressure — see [docs/streaming-lifecycle.md](docs/streaming-lifecycle.md).

### Real-time transaction SSE

Transaction streams can use Horizon Server-Sent Events to avoid polling latency.
The `sse` and `auto` transports fall back to polling when the endpoint is
unavailable or closes before emitting an event:

```ts
for await (const result of client.transaction.stream(publicKey, {
  transport: "auto",
})) {
  if (result.status === "ok") console.log(result.data.transactions);
}
```

### HTTP connection pooling

Configure a bounded per-origin pool before creating Horizon or Soroban servers.
Default behavior is unchanged when no pool is configured:

```ts
import { createConnectionPool, setConnectionPool } from "sorokit-core";

setConnectionPool(createConnectionPool({
  maxPoolSize: 10,
  keepAliveTimeoutMs: 30_000,
  socketTimeoutMs: 30_000,
}));
```

### Metrics and profiling

Use `Counter` for event counts and `Timer` for operation latency. Timers write to
the existing bounded metrics collector and can be exported with
`getPerformanceMetrics()` or `exportPerformanceMetrics()`:

```ts
const cacheHits = new Counter("cache.hit");
cacheHits.increment();
const timer = startTimer("transaction.submit");
try {
  await submit();
  timer.stop(true);
} catch (error) {
  timer.stop(false);
  throw error;
}
```

Applications that only need one subsystem can use the tree-shakeable
`sorokit-core/wallet` and `sorokit-core/account` entry points.

---

## Networks

`sorokit-core` provides canonical network configurations and safe defaults for all Stellar networks:

| Network Preset | Horizon Endpoint | Soroban RPC Endpoint | Network Passphrase |
| :--- | :--- | :--- | :--- |
| `mainnet` | `https://horizon.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/soroban/rpc` | `Public Global Stellar Network ; September 2015` |
| `testnet` | `https://horizon-testnet.stellar.org` | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` |
| `futurenet` | `https://horizon-futurenet.stellar.org` | `https://rpc-futurenet.stellar.org` | `Test SDF Future Network ; October 2022` |

```ts
import { createSorokitClient, resolveNetwork } from "sorokit-core";

// 1. Preset network
const client = createSorokitClient({ network: "testnet" });

// 2. Custom RPC or Horizon endpoints (HTTPS mandatory for remote hosts)
const customClient = createSorokitClient({
  network: "mainnet",
  horizonUrl: "https://my-horizon.example.com",
  rpcUrl: "https://my-rpc.example.com",
});
```

### Testnet-to-Mainnet Checklist
When deploying to Mainnet:
- Confirm client resolves the mainnet passphrase (`Public Global Stellar Network ; September 2015`).
- Use dedicated RPC infrastructure rather than public testing nodes.
- Validate endpoint health with `checkNetworkCapabilities`.
- Ensure spending thresholds and fee limits (`checkMainnetSafety`) are active.

See the complete [Network Configuration and Safe Defaults Guide](docs/network-configuration.md).

---

## Testing Utilities

The `sorokit-core/testing` subpath provides mock clients, wallet adapters, and network server scenarios for consumer test suites without hitting real network endpoints:

```ts
import {
  createMockClient,
  createMockWalletAdapter,
  setupMockServerScenario,
  teardownMockServer,
} from "sorokit-core/testing";

// 1. Mock wallet adapter with vi.fn() stubs
const adapter = createMockWalletAdapter();

// 2. Mock client with partial method overrides
const client = createMockClient({
  overrides: {
    soroban: {
      read: vi.fn().mockResolvedValue(ok({ result: 100n })),
    },
  },
});

// 3. Integration test mock server scenarios with proper cleanup
setupMockServerScenario({ scenario: "success", horizonUrl, rpcUrl });
// In afterEach: teardownMockServer();
```

See the complete [Consumer Testing Guide](docs/testing-guide.md) for isolating wallet, RPC, and smart contract behavior.

For scenarios that need to run against real, live testnet (account funding, payments, multi-sig, a real Soroban contract invoke, DEX offers, account merge), see `src/tests/e2e.test.ts` and run `npm run test:e2e` — it self-funds every account via Friendbot, so no secrets are required. It's skipped by default in `npm test` and runs nightly in CI (`.github/workflows/e2e.yml`).

### Mocked transaction lifecycle tests

`src/tests/transaction-lifecycle.test.ts` exercises the full build → simulate → sign → submit → status flow with every significant outcome (success, wallet rejection, simulation error, submission timeout, confirmed, not found) entirely via mocked Horizon/RPC — no real network required:

```bash
vitest run src/tests/transaction-lifecycle.test.ts
```

### Flaky test reproducibility

Randomized and stress tests in `src/tests/flaky-test-reproducibility.test.ts` pin their seed via the `SEED` environment variable. If CI reports a failure, copy the seed from the run log and re-run:

```bash
SEED=<reported-seed> vitest run src/tests/flaky-test-reproducibility.test.ts
```

The active seed and full runtime context (Node version, platform, arch, timezone) are printed at the start of every run so they appear in CI artifacts.

### Telemetry redaction

`src/tests/telemetry-redaction.test.ts` uses sentinel values for account IDs, secret keys, mnemonics, raw XDR payloads, and API keys and asserts none of them appear in exported spans or metrics on success or failure paths. Run directly with:

```bash
vitest run src/tests/telemetry-redaction.test.ts
```

### Stellar SDK version compatibility

`src/tests/sdk-version-compatibility.test.ts` covers every version-range boundary (compatible, major-mismatch, older-than-supported, newer-minor, unknown) and verifies that unsupported versions surface actionable package guidance:

```bash
vitest run src/tests/sdk-version-compatibility.test.ts
```

---

## Examples

### Minimal working examples

The two tasks new users reach for first — sending a payment and calling a Soroban contract — shown end-to-end with the full error-check idiom.

#### Send a payment

```ts
import { createSorokitClient, FreighterAdapter } from "sorokit-core";
// swkInstance is your initialised @creit.tech/stellar-wallets-kit instance

// 1. Create client
const clientResult = createSorokitClient({ network: "testnet" });
if (clientResult.status === "error") throw new Error(clientResult.error.message);
const client = clientResult.data;

// 2. Connect wallet and get the public key
const adapter = new FreighterAdapter(swkInstance);
const conn = await client.wallet.connect(adapter);
if (conn.status === "error") throw new Error(conn.error.message);
const { publicKey } = conn.data;

// 3. Build the payment transaction (returns a signed-envelope XDR stub)
const tx = await client.transaction.buildPayment(publicKey, {
  destination: "GDEST...WXYZ",
  amount: "10",
  // asset defaults to native XLM; pass { code: "USDC", issuer: "GA5Z..." } for custom assets
});
if (tx.status === "error") throw new Error(tx.error.message);

// 4. Sign with the connected wallet
const signed = await client.wallet.signTransaction(adapter, {
  transactionXdr: tx.data,
  networkPassphrase: client.networkConfig.networkPassphrase,
});
if (signed.status === "error") throw new Error(signed.error.message);

// 5. Submit to Horizon
const result = await client.transaction.submit(signed.data);
if (result.status === "ok") {
  console.log("Confirmed in ledger:", result.data.ledger);
} else {
  console.error("Submit failed:", result.error.code, result.error.message);
}
```

#### Call a Soroban smart contract

```ts
import { createSorokitClient, FreighterAdapter } from "sorokit-core";
import { nativeToScVal, Address } from "@stellar/stellar-sdk";

// 1. Create a client with an RPC endpoint (required for Soroban)
const clientResult = createSorokitClient({
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
});
if (clientResult.status === "error") throw new Error(clientResult.error.message);
const client = clientResult.data;

// 2. Connect wallet
const adapter = new FreighterAdapter(swkInstance);
const conn = await client.wallet.connect(adapter);
if (conn.status === "error") throw new Error(conn.error.message);
const { publicKey } = conn.data;

// 3. Use the all-in-one invoke helper: prepare → sign → execute
const result = await client.soroban.invoke(
  {
    contractId: "CCONTRACT...ID",
    method: "transfer",
    args: [
      new Address(publicKey).toScVal(),           // from
      new Address("GDEST...WXYZ").toScVal(),       // to
      nativeToScVal(1_000_000, { type: "i128" }), // amount (in contract units)
    ],
    publicKey,
  },
  // signing callback — receives the assembled XDR, returns the signed XDR
  async (xdr) => {
    const sig = await client.wallet.signTransaction(adapter, {
      transactionXdr: xdr,
      networkPassphrase: client.networkConfig.networkPassphrase,
    });
    if (sig.status === "error") throw new Error(sig.error.message);
    return sig.data;
  },
);

if (result.status === "ok") {
  console.log("Transaction hash:", result.data);
} else {
  console.error("Contract call failed:", result.error.code, result.error.message);
}
```

For read-only contract calls (no signing required):

```ts
const balance = await client.soroban.read({
  contractId: "CCONTRACT...ID",
  method: "balance",
  args: [new Address(publicKey).toScVal()],
  publicKey,
});
if (balance.status === "ok") console.log("Balance:", balance.data.result);
```

---

### Example apps

| Example | Shows |
| --- | --- |
| [`examples/router-swap`](examples/router-swap) | DEX swap: path discovery, quote, sign, submit, track |
| [`examples/authorized-multi-contract`](examples/authorized-multi-contract) | Authorized multi-contract workflow: surface required auth, gate on signer approval, verify each confirmed result; failure cases for missing and rejected authorization |
| [`examples/react-wallet-connect`](examples/react-wallet-connect) | React: connect wallet, fetch balances, build + sign + submit payment |
| [`examples/vue-soroban`](examples/vue-soroban) | Vue 3: contract method selection, invoke with progress, account streaming |
| [`examples/next-serverless`](examples/next-serverless) | Next.js + Lambda: server-side signing, batch account ops, Vercel/AWS handler |

Examples are type-checked against the SDK source with `npm run typecheck:examples`.

For a side-by-side comparison of `stellar-sdk` patterns vs `sorokit-core`, see [docs/migration-guide.md](docs/migration-guide.md).

Having trouble? The [troubleshooting decision tree](docs/troubleshooting.md) covers wallet setup, endpoint configuration, signing failures, contract errors, circuit-breaker state, and streaming issues — with diagnostic commands and escalation data that excludes secrets and private keys.

---

## Design Principles

**Stateless** — no internal state, no singleton, no side effects beyond network calls. Create as many clients as you need.

**No-throw** — every function returns `SorokitResult<T>`. Errors are values, not exceptions.

**Framework-agnostic** — zero dependency on React, Vue, or any UI framework. Works in Node, the browser, and server-side rendering environments.

**Adapter-based wallets** — wallet integration is delegated to [Stellar Wallets Kit](https://github.com/creit-tech/stellar-wallets-kit), keeping `sorokit-core` decoupled from wallet implementation details.

For the *why* behind these and other design decisions — options considered, trade-offs accepted — see [Architecture Decision Records](docs/adr/README.md).

---

## Examples

| Example                                        | Shows                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`examples/router-swap`](examples/router-swap) | Frontend router integration: quote → swap → transaction tracking, with wallet signing and router error handling |

Examples are type-checked against the SDK source with `npm run typecheck:examples`.

---

## New in This Release

### Major Features

- ✅ **Circuit Breaker** - Automatic resilience for failed network requests
- ✅ **Dynamic Network Switching** - Change networks without recreating the client
- ✅ **Transaction Simulation** - Test transactions before sending (simulator module)
- ✅ **Contract Interaction Builder** - Fluent API for complex contract calls
- ✅ **Event Decoding** - Programmatic contract event parsing
- ✅ **Deploy Validation** - Pre-flight validation for contract deployments with actionable error messages
- ✅ **Offline Signing** - Sign transactions without wallet connection
- ✅ **Multi-Signature Support** - Build and manage multi-sig transactions
- ✅ **Path Payments** - Advanced path payment calculations
- ✅ **Transaction History** - Export and query historical transactions with flexible formats
- ✅ **Wallet Adapters** - Hana and SWK signing adapters for extended wallet support
- ✅ **Balance Alerts** - Monitor account balance changes in real-time
- ✅ **Activity Summaries** - Aggregate account activity metrics and analytics
- ✅ **Key Rotation** - Rotate account keys securely
- ✅ **Sponsorship** - Manage account sponsorships
- ✅ **Distributed Tracing** - Debug transactions and calls with detailed tracing
- ✅ **Advanced Logging** - Structured logging with multiple levels and configurable output
- ✅ **Configuration Management** - Centralized config validation with per-field guidance

### Testing Enhancements

- 30+ new test files with comprehensive coverage
- Property-based testing for transaction building
- Router integration tests with real-world scenarios
- Network resilience and circuit breaker tests
- Contract deployment validation tests
- End-to-end transaction lifecycle tests with mocked RPC (#89) — exercises the full build → simulate → sign → submit → status flow including wallet rejection, simulation error, submission timeout, and confirmation outcomes without hitting a real network
- Flaky test diagnosis reproducibility (#90) — deterministic seeds via `SEED` env variable, runtime context capture, and focused reproduction commands emitted to CI logs
- Telemetry redaction tests (#87) — sentinel sensitive values asserted absent from spans/metrics on both success and failure paths
- Protocol compatibility tests for Stellar SDK peer versions (#86) — full version-range boundary coverage and actionable incompatibility guidance

### Performance

- Bundle size tracking with 50 KB gzipped budget
- Optimized network calls with circuit breaker
- Efficient contract state tracking
- Reduced memory footprint with streaming

---

## Security

Sorokit Core enforces a two-tier dependency audit policy in CI.

| Severity | CI behaviour |
|---|---|
| **critical / high** | Blocking — CI fails |
| **moderate / low** | Non-blocking — uploaded as `audit-advisory-report` artifact |

The blocking check runs `npm audit --audit-level=high`. A separate advisory step writes a full JSON report and uploads it as a GitHub Actions artifact so every pull request has a visible record of lower-severity findings.

See [`docs/security-audit-policy.md`](docs/security-audit-policy.md) for the full policy, remediation process, and local audit commands.

---

## Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

---

## Recipes and Cookbook

The [`docs/recipes/`](docs/recipes/) directory contains 15 practical, copy-paste-ready recipes for common Stellar and Soroban patterns. Each recipe includes a problem statement, working code, and testing tips.

| # | Recipe | Use case |
| --- | --- | --- |
| 1 | [Multi-sig approval workflow](docs/recipes/01-multisig-approval.md) | N-of-M signatures for high-value payments |
| 2 | [Escrow with timelock](docs/recipes/02-escrow-timelock.md) | Funds held until a future timestamp |
| 3 | [DEX atomic swap](docs/recipes/03-dex-atomic-swap.md) | Swap two assets atomically on the Stellar DEX |
| 4 | [Soroban contract invoke with error handling](docs/recipes/04-soroban-invoke.md) | Invoke a smart contract with full error recovery |
| 5 | [Batch payment with progress tracking](docs/recipes/05-batch-payment.md) | Send many payments, track success/failure per item |
| 6 | [Portfolio rebalancing](docs/recipes/06-portfolio-rebalancing.md) | Read balances and swap to hit target allocations |
| 7 | [Offer management on DEX](docs/recipes/07-offer-management.md) | Create, update, and cancel limit orders |
| 8 | [Account key rotation](docs/recipes/08-key-rotation.md) | Replace a compromised signing key securely |
| 9 | [Payment with memo (SEP-7 style)](docs/recipes/09-payment-with-memo.md) | Attach a memo for exchange routing or identification |
| 10 | [Account recovery workflow](docs/recipes/10-account-recovery.md) | Recover account access via designated guardians |
| 11 | [Trustline management](docs/recipes/11-trustline-management.md) | Add, audit, and remove asset trustlines |
| 12 | [Path payment (cross-asset)](docs/recipes/12-path-payment.md) | Send one asset, recipient receives a different asset |
| 13 | [Real-time balance alerts and streaming](docs/recipes/13-balance-alerts-streaming.md) | React to balance changes without polling yourself |
| 14 | [Contract deployment with validation](docs/recipes/14-contract-deployment.md) | Deploy a Soroban WASM with pre-flight checks |
| 15 | [Fee estimation and surge pricing](docs/recipes/15-fee-estimation.md) | Estimate fees accurately before building a transaction |
| 16 | [Flash Loan Pattern](docs/recipes/16-flash-loan-pattern.md) | Borrow, use, repay in one tx |
| 17 | [Bridge Integration](docs/recipes/17-bridge-integration.md) | Cross-chain pattern |
| 18 | [Staking and Rewards](docs/recipes/18-staking-rewards.md) | Stake assets and claim rewards |
| 19 | [DEX Routing](docs/recipes/19-dex-routing.md) | Route trades across multiple pools |
| 20 | [NFT Minting](docs/recipes/20-nft-minting.md) | Mint unique tokens via contracts |

---

## Workflow and Architecture Guides

The documentation now includes task-oriented, executable workflows and a contributor-facing architecture guide:

| Guide | Use it for |
| --- | --- |
| [`docs/workflows.md`](docs/workflows.md) | Complete transaction lifecycle, wallet signing, multisignature signing, Soroban calls, trustline approval, cost planning, refunds, and recovery patterns |
| [`docs/architecture.md`](docs/architecture.md) | Module boundaries, data flow, result/error conventions, extension guidance, and migration from direct Stellar SDK usage |
| [`docs/adr/`](docs/adr/README.md) | Architecture Decision Records — the problem, options, decision, and consequences behind major design choices (no-throw results, stateless client, wallet adapters, error classification, streaming transport, module structure) |
| [`docs/contract-spec-compatibility.md`](docs/contract-spec-compatibility.md) | Comparing and validating contract specs across deployed versions to catch client drift before it causes runtime errors |

Both guides use the current exported API shape and keep policy, construction, signing, submission, and recovery concerns separate.

---

## Video Tutorials

[`docs/videos.md`](docs/videos.md) is a 10-part video tutorial series covering the common workflows below. Each entry links to the full timestamped script, verbatim transcript, and working code examples — all ready to record against. Full-length transcripts are available in each tutorial's **Transcript** subsection inside [`docs/videos.md`](docs/videos.md).

| #  | Tutorial                                                                                                              | Length |
|----|-----------------------------------------------------------------------------------------------------------------------|:------:|
| 1  | [Getting Started & Wallet Connection](docs/videos.md#tutorial-1--getting-started--wallet-connection-2-min)           | 2 min  |
| 2  | [Building and Submitting a Payment](docs/videos.md#tutorial-2--building-and-submitting-a-payment-2-min)              | 2 min  |
| 3  | [Multi-Sig Approval (Setup)](docs/videos.md#tutorial-3--multi-sig-approval-setup-4-min)                              | 4 min  |
| 4  | [Soroban Contract Read & Invoke](docs/videos.md#tutorial-4--soroban-contract-read--invoke-3-min)                     | 3 min  |
| 5  | [The SorokitResult No-Throw Model](docs/videos.md#tutorial-5--the-sorokitresult-no-throw-model-2-min)                | 2 min  |
| 6  | [Unit Testing with Sorokit Mocks](docs/videos.md#tutorial-6--unit-testing-with-sorokit-mocks-3-min)                  | 3 min  |
| 7  | [Deploying a Soroban Contract](docs/videos.md#tutorial-7--deploying-a-soroban-contract-3-min)                        | 3 min  |
| 8  | [Debugging with DevTools & Diagnostics](docs/videos.md#tutorial-8--debugging-with-devtools--sorokit-diagnostics-3-min) | 3 min  |
| 9  | [Multi-Signature Workflows End-to-End](docs/videos.md#tutorial-9--multi-signature-workflows-end-to-end-4-min)        | 4 min  |
| 10 | [Error Handling Patterns & Recovery](docs/videos.md#tutorial-10--error-handling-patterns--recovery-2-min)            | 2 min  |

See [`docs/videos.md`](docs/videos.md) for recorded video links once they're published, and for the full production recording checklist and YouTube hosting guide.

---

## Release Automation

Two scripts help maintain consistent release metadata and catch problems before cutting a release.

| Script | npm command | Purpose |
|---|---|---|
| `scripts/check-release-metadata.mjs` | `npm run check:release-metadata` | Audits release branches and tags for version drift |
| `scripts/pre-release-check.mjs` | `npm run pre-release:check` | Validates version/tag, changelog, dist, and exports before tagging |

See [docs/release-automation.md](docs/release-automation.md) for the full check list and maintainer actions.

---

## License

[MIT](LICENSE)

# Factory statistics

API servers can expose `getFactoryStatistics` at a route such as
`GET /factory/:id/statistics`. Supply an adapter that reads the factory pair
count and deployment metadata; the function returns Sorokit's standard
structured JSON result.

# Decode factory and router events

```ts
import { decodeContractEvent, queryContractEvents } from "sorokit-core";

const events = await queryContractEvents(factoryId, undefined, { horizonUrl });
for (const event of events) {
  const decoded = decodeContractEvent(event);
  if (decoded?.type === "factory.pair_created") {
    console.log(decoded.data);
  }
}
```

Pass custom decoders as the second argument to support application-specific
events. Custom decoders run first, so adding new built-in event types remains
backward-compatible.

### Mainnet transaction safety

Mainnet submissions require explicit confirmation when native XLM exposure exceeds
1,000 XLM (configurable). Both `client.transaction.submit` and its
`submitTransaction` alias return `MAINNET_SAFETY_LIMIT` before contacting Horizon
unless `bypassMainnetSafety` is exactly `true`:

```ts
const result = await client.transaction.submitTransaction(signedXdr, {
  mainnetSafetyThresholdXlm: 1000,
  bypassMainnetSafety: true, // Set only after reviewing the transaction.
});
```

**Key behavior:**

- The check runs client-side, before any network call, so a failed safety check
  never consumes a sequence number.
- Failures return `SorokitErrorCode.MAINNET_SAFETY_LIMIT` with an actionable message
  that names the required opt-in.
- Operations whose native exposure cannot be bounded from the XDR (account merges,
  balance claims, liquidity pool operations, Soroban contract calls) also require
  `bypassMainnetSafety: true` regardless of the threshold.
- Testnet, Futurenet, and custom networks are unaffected.
- `bypassMainnetSafety` must be the literal `true`. Truthy values such as `1`,
  `"true"`, or `{}` are treated as absent and the check still fires.
- An invalid threshold (NaN, Infinity, negative) returns `SorokitErrorCode.INVALID_CONFIG`.

Warnings include the native amount, threshold, source account, operation count,
and operation types whose exposure cannot be determined from XDR. Native offers
and payment spend limits are counted with exact stroop arithmetic. Fees, reserve
changes, and non-native asset valuations are outside this guard.

Soroban submissions use the same guard. Pass safety options as the fourth argument
to `client.soroban.execute`, or the fifth to `client.soroban.invoke`:

```ts
await client.soroban.execute(signedXdr, undefined, undefined, {
  bypassMainnetSafety: true,
});
```
