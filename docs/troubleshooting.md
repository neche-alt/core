# Troubleshooting decision tree

Integration failures with Sorokit Core can originate from wallet setup, endpoint configuration, signing, or contract behavior. This guide provides a structured decision tree with diagnostic commands, expected signals, and escalation data.

> **Security note**: none of the commands or outputs in this guide include private keys, secret seeds, or wallet mnemonics. Never share those when escalating an issue.

---

## Quick diagnostics: run this first

```ts
import { runDiagnostics } from "sorokit-core";

const report = await runDiagnostics({ network: "testnet" });

console.log("Overall status:", report.status);
// "healthy" | "degraded" | "unavailable"

for (const check of report.checks) {
  console.log(`[${check.status}] ${check.name}: ${check.message}`);
  for (const rec of check.recommendations) {
    console.log("  → ", rec);
  }
}

// Escalation snapshot (safe to share — no secrets):
console.log(JSON.stringify({
  version: report.version,
  network: report.network,
  timestamp: report.timestamp,
  issues: report.issues,
  summary: report.summary,
}, null, 2));
```

The full `DiagnosticsReport` returned by `runDiagnostics` is safe to include in GitHub issues. It contains no keys, secrets, or sensitive wallet data.

---

## Decision tree

### Step 1 — Is the runtime capable?

**Signal**: `report.checks` includes an `environment` entry with status `degraded`.

**Expected output from `checkEnvironment()`:**
```
[degraded] Runtime environment: Runtime is missing 1 capability/capabilities.
  → Run on Node 18+ or pass options.fetchFn with a fetch-compatible implementation.
```

**Fixes:**
- Node.js < 18: upgrade, or install `node-fetch` and pass it as `options.fetchFn`.
- `AbortController` missing: add a polyfill (`abort-controller` on npm).

---

### Step 2 — Can you reach Horizon?

**Diagnostic command:**
```ts
import { checkHorizonConnectivity, resolveNetwork } from "sorokit-core";

const net = resolveNetwork("testnet");
if (net.status === "error") throw new Error(net.error.message);

const result = await checkHorizonConnectivity(net.data.horizonUrl, {
  timeoutMs: 5000,
});
console.log(result.status, result.latencyMs, result.issues);
```

**Expected signal when healthy:**
```
healthy 123 []
```

| Signal | Meaning | Fix |
|--------|---------|-----|
| `unavailable` + "timed out" | Horizon unreachable from this network | Check firewall, VPN, or try `curl https://horizon-testnet.stellar.org/ledgers?limit=1` |
| `unavailable` + "HTTP 5xx" | Horizon endpoint is down | Switch to a backup Horizon URL via `resolveNetwork` override |
| `degraded` + high latency | Endpoint is slow | Use a geographically closer Horizon provider |

---

### Step 3 — Can you reach Soroban RPC?

**Diagnostic command:**
```ts
import { checkSorobanRpcConnectivity, resolveNetwork } from "sorokit-core";

const net = resolveNetwork("testnet");
if (net.status === "error") throw new Error(net.error.message);

const result = await checkSorobanRpcConnectivity(net.data.rpcUrl, {
  timeoutMs: 5000,
});
console.log(result.status, result.latencyMs, result.issues);
```

**Expected signal when healthy:**
```
healthy 85 []
```

| Signal | Meaning | Fix |
|--------|---------|-----|
| `unavailable` + "timed out" | RPC node unreachable | Verify RPC URL; use `configureEndpointFailover` for automatic backup |
| `unavailable` + "HTTP 403" | Node requires auth | Check whether your provider requires an API key in the URL or headers |
| `degraded` | Slow node | Switch RPC provider or configure endpoint failover with a backup |

---

### Step 4 — Is your wallet available?

**Diagnostic command:**
```ts
import { checkWalletAdapterStatus } from "sorokit-core";
import { FreighterAdapter } from "sorokit-core"; // or whichever adapter you use

const adapter = new FreighterAdapter();
const result = checkWalletAdapterStatus(adapter);
console.log(result.status, result.issues);
```

**Expected signal when healthy:**
```
healthy []
```

| Signal | Meaning | Fix |
|--------|---------|-----|
| `unavailable` + "not available" in browser | Extension not installed | Install the wallet extension and reload |
| `unavailable` + "not available" in Node | Running outside browser | Wallet adapters require a browser; use a mock adapter for server-side tests |
| `unavailable` + "threw" | Adapter initialization error | Check that the adapter is constructed before `isAvailable()` is called |

---

### Step 5 — Is your network configuration valid?

**Diagnostic command:**
```ts
import { checkNetworkConfiguration } from "sorokit-core";

const result = checkNetworkConfiguration({
  network: "mainnet",
  horizonUrl: "https://horizon.stellar.org",
  rpcUrl: "https://soroban-rpc.mainnet.stellar.gateway.fm",
  // Optional: catch passphrase mismatches before submitting
  expectedNetworkPassphrase: "Public Global Stellar Network ; September 2015",
});
console.log(result.status, result.issues);
```

| Signal | Meaning | Fix |
|--------|---------|-----|
| `unavailable` + "Unknown network" | Unrecognised network string | Use `"testnet"`, `"mainnet"`, or `"futurenet"` |
| `degraded` + "plaintext HTTP on mainnet" | HTTP URL on mainnet | Change to an `https://` URL |
| `unavailable` + "passphrase does not match" | Signing against the wrong network | Align `expectedNetworkPassphrase` with the selected network |

---

### Step 6 — Transaction build failures

**Symptoms**: `buildPaymentTransaction`, `buildTransaction`, or similar returns `status: "error"`.

**Diagnostic steps:**

1. Check `result.error.code` — do not parse `result.error.message`.

| Error code | Meaning | Fix |
|------------|---------|-----|
| `VALIDATION` | Invalid amount, address, or parameter | Check `validateAmount`, `validateStellarAddress` output first |
| `NETWORK` | Horizon returned an error | Inspect `result.error.cause` for the Horizon error body |
| `SEQUENCE_CONFLICT` | Sequence number mismatch | Re-fetch account sequence and rebuild — do NOT resubmit the original XDR |
| `TIMEOUT` | Request timed out | Retry with the same XDR (transaction envelope is immutable) |

2. For amount errors specifically:

```ts
import { validateAmount } from "sorokit-core";

const check = validateAmount("100.12345678"); // 8 decimal places — invalid
if (check.status === "error") {
  console.error(check.error.message);
  // "Amount "100.12345678" has more than 7 decimal places (stroop precision)."
}
```

---

### Step 7 — Signing failures

**Symptoms**: `wallet.signTransaction` returns `status: "error"` or rejects.

| Signal | Meaning | Fix |
|--------|---------|-----|
| `WALLET_REJECTED` | User declined in wallet UI | Surface to user; do not retry automatically |
| `WALLET_NOT_CONNECTED` | Adapter not connected | Call `client.wallet.connect()` before signing |
| `INVALID_NETWORK` | Wallet is on a different network | Match the wallet network to your `networkPassphrase` |
| `SIGNING_ERROR` | Unexpected adapter error | Check adapter version compatibility; see `sdkVersionCompatibility` |

---

### Step 8 — Soroban contract invocation failures

**Symptoms**: `client.soroban.simulate` or `client.soroban.execute` returns an error.

**Diagnostic steps:**

1. Always call `simulate` before `execute`:

```ts
const simulation = await client.soroban.simulate(prepared.data.xdr);
if (simulation.status === "error") {
  // Inspect simulation.error — do not submit
  console.error(simulation.error.message, simulation.error.code);
  return;
}
```

2. Common simulation error codes and their causes:

| Error code | Meaning | Fix |
|------------|---------|-----|
| `CONTRACT_ERROR` | Contract returned an error value | Decode the XDR error value; check contract state preconditions |
| `RESOURCE_EXHAUSTED` | Insufficient resource budget | Increase fee or simplify the invocation |
| `NETWORK` | RPC node error during simulation | Retry once; if persistent, check RPC health with `checkSorobanRpcConnectivity` |

---

### Step 9 — Circuit breaker open

**Symptoms**: calls throw `CircuitOpenError` immediately without reaching the network.

```ts
import { CircuitOpenError } from "sorokit-core";

try {
  await cb.call(() => rpc.simulateTransaction(tx));
} catch (err) {
  if (err instanceof CircuitOpenError) {
    console.log("Circuit open since:", new Date(err.openedAt).toISOString());
    console.log("Endpoint:", err.endpoint);
    // Wait for the recovery window, or manually reset for testing:
    // cb.reset();
  }
}
```

**Checks:**
- `cb.getMetrics()` shows `state`, `consecutiveFailures`, and `lastOpenedAt`.
- The circuit moves to `HALF_OPEN` automatically after `recoveryWindowMs` (default 60 s).
- If a probe succeeds, the circuit closes. If it fails, it reopens.
- In tests, call `cb.reset()` to restore `CLOSED` state without waiting.

---

### Step 10 — Streaming and cursor issues

See [Streaming API lifecycle and cursor semantics](./streaming-lifecycle.md) for full guidance.

Quick checks:
- Missed events on reconnect: ensure you are passing the cursor returned by `cursorStore.load()` as the starting cursor.
- Duplicate events: `PersistentEventDeduplicationStore` deduplicates by event ID within a 1-hour TTL window.
- Stream does not stop: call the unsubscribe function returned by `emitter.on()` and abort the `AbortController`.

---

## Escalation checklist

Before opening a GitHub issue, collect the following (never include private keys or secret seeds):

```ts
import { runDiagnostics } from "sorokit-core";

const report = await runDiagnostics({ network: "testnet" /* or mainnet */ });

const escalationData = {
  sdkVersion: report.version,
  network: report.network,
  timestamp: report.timestamp,
  overallStatus: report.status,
  checkSummary: report.summary,
  issues: report.issues,
  recommendations: report.recommendations,
  // Add manually:
  nodeVersion: process.version,  // Node.js version if applicable
  errorCode: "...",              // result.error.code from the failing call
  operationType: "...",          // e.g. "buildPaymentTransaction", "soroban.simulate"
};

console.log(JSON.stringify(escalationData, null, 2));
```

Include this JSON block in your issue report. It contains no secrets.
