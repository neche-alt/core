# Network Configuration & Safe Defaults Reference

This document provides a comprehensive reference for configuring Stellar and Soroban network endpoints in `sorokit-core`, including default presets, validation rules, endpoint failover, and a checklist for safely moving from Testnet to Mainnet.

---

## 1. Network Configuration Options

Every `sorokit-core` client requires network configuration via `createSorokitClient` or `resolveNetwork`. The configuration shape is defined by `NetworkConfig`:

```ts
export interface NetworkConfig {
  /** Network identifier: "mainnet" | "testnet" | "futurenet" */
  network: NetworkType;
  /** Horizon REST server base URL */
  horizonUrl: string;
  /** Soroban JSON-RPC server base URL */
  rpcUrl: string;
  /** Stellar network passphrase used to sign transaction envelopes */
  networkPassphrase: string;
}
```

---

## 2. Canonical Safe Defaults

`sorokit-core` exports `NETWORK_DEFAULTS` with tested, official SDF and provider endpoints:

| Network Preset (`network`) | Horizon Endpoint (`horizonUrl`) | Soroban RPC Endpoint (`rpcUrl`) | Canonical Network Passphrase (`networkPassphrase`) |
| :--- | :--- | :--- | :--- |
| **`mainnet`** | `https://horizon.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/soroban/rpc` | `Public Global Stellar Network ; September 2015` |
| **`testnet`** | `https://horizon-testnet.stellar.org` | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` |
| **`futurenet`** | `https://horizon-futurenet.stellar.org` | `https://rpc-futurenet.stellar.org` | `Test SDF Future Network ; October 2022` |

---

## 3. Custom Endpoints & Overrides

For self-hosted infrastructure or dedicated RPC providers (e.g. Blockdaemon, QuickNode), provide overrides during client creation:

```ts
import { createSorokitClient } from "sorokit-core";

const clientResult = createSorokitClient({
  network: "mainnet",
  horizonUrl: "https://my-private-horizon.example.com",
  rpcUrl: "https://my-private-soroban-rpc.example.com",
});
```

You can also resolve network configuration standalone:

```ts
import { resolveNetwork } from "sorokit-core";

const configResult = resolveNetwork("testnet", {
  rpcUrl: "https://custom-testnet-rpc.example.com",
});

if (configResult.status === "ok") {
  console.log("Resolved RPC URL:", configResult.data.rpcUrl);
}
```

---

## 4. URL Validation Behavior

`resolveNetwork` enforces strict security constraints to prevent silent network misdirection:

- **HTTPS Mandatory for Remote Endpoints**: All external URLs must use the `https://` protocol scheme. Unencrypted `http://` URLs for remote hosts are rejected with `INVALID_CONFIG` to prevent man-in-the-middle attacks.
- **Localhost Exception**: `http://` is permitted strictly for local development on `localhost`, `127.0.0.1`, and `[::1]`.
- **Structural Validation**: URLs are validated structurally before any network call. Empty strings, malformed syntax, or unsupported protocols (e.g. `ftp://`) return `INVALID_CONFIG` with an actionable error hint.
- **Invalid Network Identifier**: Passing an unsupported network type returns `INVALID_NETWORK`.

---

## 5. Testnet-to-Mainnet Migration Checklist

Before switching any application or deployment pipeline to Mainnet, verify every item in this checklist:

1. [ ] **Passphrase Verification**: Ensure the client resolves `Public Global Stellar Network ; September 2015`. Signing a transaction with a testnet passphrase on mainnet will fail signature verification.
2. [ ] **Dedicated Production Endpoints**: Public SDF Horizon and RPC endpoints have rate limits. Configure dedicated RPC endpoints (with API keys or authenticated proxies) for production traffic.
3. [ ] **Mainnet Safety Limits**: Verify transaction spending limits using `checkMainnetSafety` and `DEFAULT_MAINNET_SAFETY_THRESHOLD_XLM` to prevent accidental large transfers.
4. [ ] **Fee Policy and Congestion**: Mainnet experiences surge pricing during congestion. Enable fee estimation (`client.transaction.estimateFee`) rather than hardcoding static fees.
5. [ ] **Key Management**: Ensure real secret keys (`S...`) are stored in secure key vaults (e.g. AWS KMS, HashiCorp Vault) or hardware wallets and never committed to source code or environment files.
6. [ ] **Preflight Capabilities**: Execute `checkNetworkCapabilities` to verify that your selected mainnet RPC provider is healthy and running Protocol 20+.
