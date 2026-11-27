# Sorokit Core Framework Examples

This directory contains reference applications demonstrating `sorokit-core` integration across multiple frontend and serverless frameworks. All examples adhere to the framework-agnostic SDK boundary and use only public APIs.

---

## 1. Example Index

| Example | Framework / Environment | Patterns Covered | Location |
| :--- | :--- | :--- | :--- |
| **`next-serverless`** | Next.js / Serverless API | Server-side signing with secret key, batch operations, Vercel/Lambda-style endpoints | [`examples/next-serverless`](next-serverless/README.md) |
| **`react-wallet-connect`** | React 18+ / SPA | Wallet connection via Freighter, balance querying, payment building, signing | [`examples/react-wallet-connect`](react-wallet-connect/README.md) |
| **`router-swap`** | Vanilla TypeScript / Vite | DEX liquidity path quotes, atomic swap execution, settlement monitoring | [`examples/router-swap`](router-swap/README.md) |
| **`transaction-dashboard`** | React & Vue Components | Multi-framework responsive transaction status timeline, fee analytics, delayed confirmations | [`examples/transaction-dashboard`](transaction-dashboard/README.md) |
| **`vue-soroban`** | Vue 3 / Composition API | Smart contract invocation, progress tracking, method selection, state streaming | [`examples/vue-soroban`](vue-soroban/README.md) |

---

## 2. Prerequisites & Installation

Every example requires:
- **Node.js**: `^18.0.0 || ^20.0.0 || ^22.0.0`
- **Peer Dependencies**:
  - `@stellar/stellar-sdk` (Core Stellar protocol operations)
  - `@creit.tech/stellar-wallets-kit` (For browser wallet connection in React and Vue examples)

To install dependencies across the monorepo:

```bash
# From workspace root
npm install --legacy-peer-deps
```

---

## 3. Running & Typechecking Examples

### Typechecking Examples
Validate that all examples compile cleanly against the current `sorokit-core` TypeScript types:

```bash
# Typecheck router-swap example
npm run typecheck:examples

# Typecheck individual examples directly
npx tsc --noEmit -p examples/next-serverless/tsconfig.json
npx tsc --noEmit -p examples/react-wallet-connect/tsconfig.json
npx tsc --noEmit -p examples/router-swap/tsconfig.json
npx tsc --noEmit -p examples/vue-soroban/tsconfig.json
```

### Running Development Servers
For interactive examples (e.g., `router-swap` or `react-wallet-connect`):

```bash
# Start local dev server
cd examples/router-swap
npm run dev
```

---

## 4. Contributor Maintenance Checklist for SDK Releases

When updating `sorokit-core` or adding new SDK features, contributors must validate all examples against this checklist:

1. [ ] **Public Exports Only**: Ensure every example imports exclusively from `"sorokit-core"` or documented subpaths (`"sorokit-core/wallet"`, `"sorokit-core/soroban"`, `"sorokit-core/testing"`). Never import internal implementation paths (e.g. `../../src/shared/*`).
2. [ ] **Result Pattern**: Check that no example uses `try/catch` around SDK methods returning `SorokitResult`. All error handling must inspect `result.status === "error"` and handle `result.error.code`.
3. [ ] **Clean Typecheck**: Run `npm run typecheck:examples` and ensure 0 TypeScript compilation errors.
4. [ ] **Framework Independence**: Ensure state management in examples (e.g. React `useState`, Vue `ref`) wraps the SDK cleanly without leaking framework dependencies into SDK calls.
5. [ ] **No Hardcoded Secrets**: Ensure examples use Testnet or environment variables and never commit real secret keys (`S...`) or mainnet credentials.
