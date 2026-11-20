# react-wallet-connect

Connect a Stellar wallet with Freighter, fetch balances, and send a payment — using `sorokit-core` in a React app.

```
Connect wallet → Fetch balances → Build payment → Sign → Submit
```

## Patterns covered

- Wallet connection and disconnection with `FreighterAdapter`
- Loading account balances with `client.account.getBalances`
- Building and signing a payment with `client.transaction.buildPayment`
- Handling `SorokitResult<T>` in component state (no try/catch)
- Loading and error states per operation

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment |
| `src/App.tsx` | UI: connect button, balance list, payment form, status messages |
| `src/DiagnosticsPanel.tsx` | Opt-in `[DEBUG]` diagnostics panel (see below) |
| `src/diagnosticsUtils.ts` | Pure helpers: status symbols, colours, latency formatting, secret detection |

## Setup

```bash
# From your own CRA / Vite React project:
npm install sorokit-core @creit.tech/stellar-wallets-kit
```

You need a Stellar Wallets Kit instance. Create it once at app startup:

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});
```

Then pass it to `useSorokit`:

```ts
const { walletState, connect, balances, sendPayment } = useSorokit(kit, "testnet");
```

## Running

Because this example lives inside the sorokit-core repo, its imports point to
`../../../src/...`. In your own app they become `import { ... } from "sorokit-core"`.

Type-check the example against the SDK source:

```bash
npm run typecheck:examples
```

## SDK Diagnostics Panel

`DiagnosticsPanel` is an opt-in `[DEBUG]` section that runs `runDiagnostics` from `sorokit-core` and displays the results inline. It is intentionally distinct from the main app UI: muted colours, monospace font, dashed border, and a `[DEBUG]` label.

### What it shows

- Overall SDK status (healthy / degraded / unavailable)
- SDK version, network, and report timestamp
- Per-check rows: Horizon connectivity, Soroban RPC, wallet adapter, network configuration, runtime environment
- Latency for external checks
- Issues and recommendations per check (expand a row to see them)
- Aggregated recommendation list

### How to use it

```tsx
import { DiagnosticsPanel } from "./DiagnosticsPanel";

// Always visible (useful during local development):
<DiagnosticsPanel show={true} network="testnet" />

// Visible only in development builds:
<DiagnosticsPanel show={process.env.NODE_ENV === "development"} network="testnet" />

// Hidden — safe to leave in the tree:
<DiagnosticsPanel show={false} />
```

Pass `walletAdapter` to include a wallet availability check:

```tsx
<DiagnosticsPanel show={true} network="testnet" walletAdapter={myAdapter} />
```

### Security

The panel never renders private keys, seeds, mnemonics, or other secrets. The underlying `runDiagnostics` API is strictly read-only: it never connects a wallet, signs anything, or changes SDK state. `containsSecret` in `diagnosticsUtils.ts` provides a defence-in-depth check before any value is rendered.
