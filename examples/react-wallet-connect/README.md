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
