# Supported Runtime and Browser Compatibility

Sorokit Core is a framework-agnostic, universal TypeScript SDK engineered to run consistently across Node.js server runtimes, modern browsers, and edge compute platforms.

## Tested Runtime Matrix

All runtimes listed below are verified in continuous integration ([CI Workflow](https://github.com/neche-alt/core/blob/main/.github/workflows/ci.yml)):

| Environment | Supported Versions | Status | Verified Features & Notes |
|-------------|-------------------|--------|---------------------------|
| **Node.js** | `18.x`, `20.x`, `22.x` (LTS) | ✅ Tier 1 Supported | Dual ESM (`import`) / CommonJS (`require`), native `fetch`, native `AbortController`, `node:crypto` / `WebCrypto`. |
| **Modern Browsers** | Chrome ≥ 100, Firefox ≥ 100, Safari ≥ 15, Edge ≥ 100 | ✅ Tier 1 Supported | Standard ECMAScript 2022+, `window.crypto.getRandomValues`, `localStorage` persistence with memory fallback. |
| **Edge Runtimes** | Cloudflare Workers, Vercel Edge, AWS Lambda | ✅ Tier 2 Supported | Stateless SDK operations, Soroban RPC queries, transaction construction, and offline signing. |

### Minimum API Requirements

Regardless of environment, the host runtime must supply:
1. **`fetch`**: For Horizon and Soroban RPC HTTP requests. Present natively in Node.js 18+ and all modern browsers. Can be overridden per-client via `options.fetchFn`.
2. **`AbortController`**: For request timeout cancellation and deadline enforcement.
3. **Cryptographically Secure Random Generation**: Web Crypto `crypto.getRandomValues` in browser/edge, or `crypto.randomBytes` in Node.js.

```ts
import { getRuntimeCapabilities, isBrowser, isNode } from "sorokit-core/shared";

const caps = getRuntimeCapabilities();
console.log(`Environment: ${caps.environment}`);
console.log(`Fetch available: ${caps.hasFetch}`);
console.log(`Storage available: ${caps.hasStorage}`);
```

---

## Peer Dependencies and Optional Requirements

Sorokit Core separates core requirements from specialized optional adapters to minimize bundle footprint:

### 1. Mandatory Peer Dependency

- **`@stellar/stellar-sdk` (13.3.0)**:
  - Required for core Stellar protocol primitives, Keypair operations, and XDR encoding/decoding.
  - Must be installed in every host project:
    ```bash
    npm install @stellar/stellar-sdk@13.3.0
    ```

### 2. Optional Peer Dependencies

- **`@walletconnect/sign-client` (`>=2.0.0`)**:
  - **Purpose**: Enables QR-code and deep-link mobile wallet connections via `WalletConnectAdapter`.
  - **Requirement**: Optional. If not installed, core SDK features and other wallet adapters function normally.
  - **Failure behavior**: If `WalletConnectAdapter.connect()` is called without the peer installed, it returns a structured error:
    `SorokitErrorCode.WALLET_CONNECT_FAILED` ("WalletConnect requires @walletconnect/sign-client. Install it: npm install @walletconnect/sign-client").
  - **Installation** (only if using WalletConnect):
    ```bash
    npm install @walletconnect/sign-client
    ```

- **`@creit.tech/stellar-wallets-kit` (`>=1.0.0`)**:
  - **Purpose**: Powering `SwkSignAdapter` and third-party wallet aggregators.
  - **Requirement**: Optional. Native browser adapters (`FreighterAdapter`, `LobstrAdapter`, `XBullAdapter`, `HanaAdapter`, `AlbedoAdapter`) do not require this package.
  - **Installation** (only if using Stellar Wallets Kit):
    ```bash
    npm install @creit.tech/stellar-wallets-kit
    ```

---

## Browser-Only Features & Guard Semantics

Certain wallet integrations rely on browser-specific window injection (`window.freighter`, `window.xbull`) or pop-up communication (`window.open`, `postMessage`).

### Browser-Only Adapters

The following adapters require a browser environment:
- `FreighterAdapter`
- `LobstrAdapter`
- `XBullAdapter`
- `HanaAdapter`
- `AlbedoAdapter`

### Guard Semantics in Non-Browser Runtimes

When called in Node.js or SSR contexts:
1. `adapter.isAvailable()` immediately returns `false`.
2. Calling `adapter.connect()` or `adapter.signTransaction()` immediately returns a failed `SorokitResult` with:
   - `status`: `"error"`
   - `error.code`: `SorokitErrorCode.WALLET_BROWSER_ONLY`
   - `error.message`: `"<AdapterName> requires a browser environment."`
3. No exceptions are thrown and server execution is not interrupted.

```ts
import { FreighterAdapter } from "sorokit-core/wallet";

const adapter = new FreighterAdapter();
if (!adapter.isAvailable()) {
  console.log("Freighter is not available in this runtime (e.g. Node.js server or extension missing).");
}
```

---

## Storage and SSR Compatibility

In browser runtimes, session persistence and key metadata default to `window.localStorage`. To ensure safety during Server-Side Rendering (SSR) and inside sandboxed iframes (where `localStorage` access may throw a `SecurityError`), Sorokit Core automatically detects access errors and transparently falls back to an in-memory storage provider (`MemoryStorage`).

---

## Linking Compatibility Claims to CI Coverage

Compatibility is continuously validated in the project's GitHub Actions pipeline ([`.github/workflows/ci.yml`](https://github.com/neche-alt/core/blob/main/.github/workflows/ci.yml)):
- **Node.js Automated Test Suite**: Full unit, property, and integration tests executed against Node.js LTS.
- **Simulated Browser Suite**: Browser-specific APIs and DOM bindings executed in a simulated browser environment via `jsdom` (`src/tests/*.jsdom.test.ts`).
- **TypeScript Strict Validation**: `npm run typecheck` asserts type definitions across both ESM and CommonJS consumer surfaces.
