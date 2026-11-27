# sorokit-core — Vite Minimal Example

A minimal Vite + TypeScript application that imports only `sorokit-core/transaction` and `sorokit-core/network`. Its primary purpose is to verify that the SDK's ESM build tree-shakes correctly: unused modules (wallet adapters, Soroban helpers, etc.) must not appear in the production bundle.

## Running the example

```bash
# From this directory
npm install
npm run build      # produces dist/
npm run dev        # optional: start dev server
```

## Tree-shaking verification

Run the consumer bundle analyzer from the **repo root**:

```bash
node scripts/analyze-consumer-bundle.mjs
```

The script builds this example, reads the output in `dist/assets/`, and checks that wallet-adapter symbols (`discoverAvailableWallets`, `freighter`, `xbull`, `lobstr`, `WalletConnect`, `connectWallet`) are absent.

### Interpreting the output

**Clean bundle** (expected):

```
✅ Tree-shaking verified: no wallet adapter code found in the bundle.
   Importing only sorokit-core/transaction and sorokit-core/network
   produces a clean bundle without wallet adapters.
```

**Violation** (requires investigation):

```
❌ Tree-shaking violations detected (1):
   index-BxYz1234.js: "discoverAvailableWallets"
```

A violation means a module imported by `sorokit-core/transaction` or `sorokit-core/network` transitively re-exports wallet adapter code. Trace the import chain to find the leaking barrel export and add a more specific subpath import or remove the cross-module dependency.

## CI

The `.github/workflows/ci.yml` `vite-example` job runs this build and the analyzer on every push and pull request, using `--ci` mode (exits 1 on violations).

## What this example does NOT cover

- Authentication or wallet connection (use `sorokit-core/wallet`)
- Soroban contract calls (use `sorokit-core/soroban`)
- Server-side rendering (see `examples/next-serverless`)
