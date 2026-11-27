# Privacy Guidance for Telemetry and Diagnostics

Sorokit Core provides observability and health instrumentation to help operators monitor latency, success rates, and RPC connectivity. This guide defines the data collection boundaries, configuration and disable mechanisms, automated redaction guarantees, and safe diagnostics export procedures.

---

## 1. Privacy Principles

1. **Privacy by Default**: No private keys, seed phrases, mnemonics, passwords, or transaction payload envelopes are ever captured.
2. **Zero-Overhead When Unconfigured**: If `initTelemetry()` is not called, tracing and metric collection are complete no-ops. No background tasks or network traffic are generated.
3. **Automated Redaction**: Sensitive attributes, secret keys, and authorization tokens are automatically redacted to `"[REDACTED]"` before reaching export sinks.
4. **Explicit Operator Control**: Operators can disable telemetry at runtime with a single function call.

---

## 2. Collected Data Reference

When telemetry is explicitly initialized via `initTelemetry()`, the SDK records high-level operational metadata:

| Category | Collected Fields | Example | Never Collected |
|----------|-----------------|---------|-----------------|
| **Spans** | Operation name, duration (ms), status code | `wallet.connect`, `24ms`, `ok` | Secret keys (`S...`), seed phrases, PINs |
| **Metrics** | Operation duration histograms, error counters, cache hit/miss | `transaction.submit.duration_ms`, `cache_hit` | Account balances, amounts, raw XDR envelopes |
| **Wallet** | Wallet adapter identifier, availability | `freighter`, `lobstr` | Keypair secret keys, mnemonic words |
| **Network** | Network identifier, RPC latency | `testnet`, `mainnet`, `45ms` | Passwords, authorization headers, private tokens |

---

## 3. Configuration and Disable Behavior

### Initialization

```ts
import { initTelemetry } from "sorokit-core";

const result = initTelemetry({
  serviceName: "payment-service",
  exporter: "otlp", // "jaeger" | "datadog" | "otlp" | "console" | "memory" | "none"
  samplingRate: 0.1, // Sample 10% of requests
});

if (result.status === "ok") {
  console.log("Telemetry initialized:", result.data.instanceId);
}
```

### Complete Disable & Opt-Out

Telemetry can be disabled in three ways:

1. **Default Unconfigured**: Simply do not call `initTelemetry()`. Spans and metrics will no-op with zero runtime overhead.
2. **Configuration Flag**: Pass `enabled: false`:
   ```ts
   initTelemetry({
     serviceName: "payment-service",
     enabled: false,
   });
   ```
3. **Runtime Teardown**: Call `disableTelemetry()` (or `shutdownTelemetry()`):
   ```ts
   import { disableTelemetry } from "sorokit-core";

   await disableTelemetry();
   ```

---

## 4. Automated Redaction Expectations

Sorokit Core enforces automated redaction across all telemetry spans and logging transports:

- **Sensitive Key Patterns**: Any attribute key matching `/(secret|password|token|mnemonic|private|seed|authorization|api[-_]?key|payload|envelope[-_]?xdr|signature)/i` is automatically replaced with `"[REDACTED]"`.
- **Stellar Secret Key Pattern**: Any string matching the Stellar Ed25519 secret key format (`^S[A-Z2-7]{55}$`) is immediately replaced with `"[REDACTED]"` regardless of the attribute key name.
- **Recursive Sanitization**: Nested objects and arrays within span attributes are traversed and sanitized recursively.

```ts
import { traceSpan } from "sorokit-core";

await traceSpan("transaction.execute", (span) => {
  // Safe: preserved
  span?.setAttribute("network", "testnet");

  // Sensitive: automatically redacted to "[REDACTED]"
  span?.setAttribute("secretKey", "SB2W...");
  span?.setAttribute("transaction.envelope_xdr", "AAAA...");
});
```

---

## 5. Safe Diagnostics Export Workflow

When generating diagnostic bundles for support tickets, bug reports, or error monitoring systems (e.g. Sentry), use `exportSafeDiagnostics` to ensure no sensitive credentials or keys leak into external systems:

```ts
import { runDiagnostics, exportSafeDiagnostics } from "sorokit-core";

// 1. Run local health and runtime diagnostics
const report = await runDiagnostics();

// 2. Export a sanitized diagnostic bundle
const safeBundle = exportSafeDiagnostics(report, {
  environment: "production",
  appVersion: "1.0.0",
  // Even if application metadata accidentally contains sensitive fields:
  apiSecret: "super-secret-token", // Sanitized to "[REDACTED]"
});

// 3. Output or transmit the safe bundle
console.log("Safe diagnostics:", JSON.stringify(safeBundle, null, 2));
```

The exported bundle includes:
- `sdkVersion`: Installed SDK version
- `network`: Active Stellar network
- `status`: Aggregated health status (`healthy`, `degraded`, `unavailable`)
- `checks`: List of endpoint connectivity, wallet adapter availability, and runtime checks
- `redacted`: Hardcoded to `true` confirming automated sanitization was executed
