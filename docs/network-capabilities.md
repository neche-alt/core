# Soroban Network Capability Preflight

## Context & Motivation

A deployment or smart contract invocation flow can fail late and unhelpfully if the target network endpoint does not support Soroban operations (requires Stellar Protocol 20+) or if the endpoint's network passphrase mismatches the local client configuration.

`sorokit-core` provides dedicated capability preflight utilities (`checkNetworkCapabilities` and `preflightDeploymentCapabilities`) and automatically checks capabilities before contract deployment in `buildContractDeploy`.

---

## Capability Status & Error Classification

| Scenario | Response Status | Error Code | Description / Recovery |
| :--- | :--- | :--- | :--- |
| **Supported** | `ok(NetworkCapabilities)` | `null` | RPC supports Protocol 20+ and passphrase matches expectation. |
| **Unsupported (Protocol < 20)** | `err(SorokitError)` | `UNSUPPORTED_NETWORK` | The endpoint runs an older protocol version without Soroban support. Switch to an updated RPC node. |
| **Unsupported (Passphrase Mismatch)** | `err(SorokitError)` | `UNSUPPORTED_NETWORK` | Endpoint reported a different network passphrase than expected (e.g. Testnet vs Mainnet mix-up). |
| **Unavailable** | `err(SorokitError)` | `SERVICE_UNAVAILABLE` | Endpoint is down, times out, or cannot be reached. Retry with exponential backoff or use a fallback endpoint. |

---

## Standalone Usage

Check endpoint capabilities prior to deploying or submitting transactions:

```ts
import { checkNetworkCapabilities, SorokitErrorCode } from "sorokit-core";

const capabilities = await checkNetworkCapabilities({
  rpcUrl: "https://soroban-testnet.stellar.org",
  expectedPassphrase: "Test SDF Network ; September 2015",
  minProtocolVersion: 20, // Soroban minimum protocol
});

if (capabilities.status === "ok") {
  console.log("Protocol version:", capabilities.data.protocolVersion);
  console.log("Friendbot faucet:", capabilities.data.friendbotUrl);
} else {
  if (capabilities.error.code === SorokitErrorCode.UNSUPPORTED_NETWORK) {
    console.error("Endpoint does not support Soroban:", capabilities.error.message);
  } else if (capabilities.error.code === SorokitErrorCode.SERVICE_UNAVAILABLE) {
    console.error("Endpoint is unreachable:", capabilities.error.message);
  }
}
```

---

## Deployment Preflight Integration

`buildContractDeploy` automatically executes a capability preflight before initiating WASM upload and transaction assembly:

```ts
import { buildContractDeploy, SorokitErrorCode } from "sorokit-core";

const deployTx = await buildContractDeploy(wasmBuffer, deployerPublicKey, {
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkConfig,
  // skipCapabilityPreflight: false (default: preflight check is active)
});

if (deployTx.status === "error") {
  if (deployTx.error.code === SorokitErrorCode.UNSUPPORTED_NETWORK) {
    console.error("Deployment aborted: network endpoint lacks Soroban capability.");
  }
}
```
