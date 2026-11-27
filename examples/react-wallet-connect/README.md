# react-wallet-connect

Connect a Stellar wallet with Freighter, fetch balances, and send a payment — using `sorokit-core` in a React app. On reload the app detects a persisted session and shows a consent prompt before reconnecting.

```
Connect wallet → Fetch balances → Build payment → Sign → Submit
Reload → Detect session → Consent prompt (with trust level) → Reconnect or clear
```

## Patterns covered

- Wallet connection and disconnection with `FreighterAdapter`
- **Reconnect-on-reload with explicit consent** via `reconnectWithConsent`
  - Persists the session after a successful connect (`saveSession`)
  - On reload, detects the saved session and surfaces a consent prompt
  - Shows device trust level (from `deviceTrust.ts`) in the prompt
  - On rejection, clears the session (`clearSession`) and returns to idle
- Loading account balances with `client.account.getBalances`
- Building and signing a payment with `client.transaction.buildPayment`
- Handling `SorokitResult<T>` in component state (no try/catch)
- Loading and error states per operation
- Distinguishing user rejection from transport or contract failure

## Handling wallet rejection

When a user declines a wallet prompt, `useSorokit` sets `error` to a calm, actionable message rather than a generic failure string. The UI renders these notices with an amber background (`#fff8e1`) so users understand they made a deliberate decision and know what to do next.

| Error code | Displayed message |
|---|---|
| `WALLET_SIGN_REJECTED` | "You declined the transaction. When you're ready, press Send again to review and approve it." |
| `WALLET_CONNECT_FAILED` + rejection keyword | "Connection declined. Select a wallet and try again." |
| Any other failure | Original SDK error message |

The SDK utility `walletErrorMessage` from `sorokit-core/wallet` handles this mapping. Rejection messages never suggest automatic resubmission.

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment |
| `src/App.tsx` | UI: connect button, balance list, payment form, status messages |
| `src/DiagnosticsPanel.tsx` | Opt-in `[DEBUG]` diagnostics panel (see below) |
| `src/diagnosticsUtils.ts` | Pure helpers: status symbols, colours, latency formatting, secret detection |

## Setup

```bash
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
const {
  walletState,
  connect,
  balances,
  sendPayment,
  pendingReconnect,
  approveReconnect,
  rejectReconnect,
} = useSorokit(kit, "testnet");
```

## Accessibility

### Reduced motion

The example listens to `prefers-reduced-motion` via `window.matchMedia` and removes CSS transitions when the user prefers reduced motion. The `motionSafeTransition` helper in `src/a11y.ts` returns `"none"` when reduced motion is active.

### Color contrast and color-only indicators

Status colors (success, error, neutral) use dark foreground tokens that meet WCAG AA (4.5:1 on white). No status is communicated by color alone — each state also carries `role="alert"` or `role="status"` and visible text.

When `forced-colors` or `prefers-contrast: more` is active, all status colors fall back to the CSS system keyword `ButtonText`, which the browser maps to the user's high-contrast foreground color.

### Checks used

| Check | Method |
|---|---|
| Reduced motion respected | `window.matchMedia("(prefers-reduced-motion: reduce)")` with live listener |
| High contrast respected | `window.matchMedia("(forced-colors: active)")` and `prefers-contrast: more` |
| Status not color-only | Each state has `role`, `aria-label`, and text in addition to color |
| Color contrast | Tokens verified manually against WCAG AA (4.5:1 on white) |

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
