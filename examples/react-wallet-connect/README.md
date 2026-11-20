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
| `src/AccessibleWalletControls.tsx` | Keyboard-operable controls with aria labels and live status announcements |

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

## Accessible Wallet Controls

`AccessibleWalletControls` is a drop-in replacement for the basic connect/disconnect buttons. It audits and fixes the accessibility gaps in a typical wallet integration.

### What it covers

| Concern | Implementation |
|---|---|
| Keyboard operation | All controls are `<button>` elements, operable with Enter/Space |
| Accessible names | Every button has an explicit `aria-label` including the wallet name and action |
| Focus visibility | Focus ring rendered via `onFocus`/`onBlur` — `outline` is never suppressed |
| Status announcements | `aria-live="polite"` region announces every state change to screen readers |
| Disabled state | Uses the HTML `disabled` attribute (not just visual opacity), plus `aria-disabled` |
| Error announcements | Errors rendered in a `role="alert"` region for immediate announcement |
| Account address | Full key in `title` and `aria-label`; truncated text shown visually |

### Provider-specific limitations

Extension wallets (Freighter, xBull, Lobstr, etc.) open a **separate browser popup** for approval. That popup is outside this document's focus management scope — focus cannot be moved into it programmatically from the SDK. The `aria-live` region covers this by announcing the new state once the popup resolves.

WalletConnect uses a QR-code modal injected by the WalletConnect library. That modal manages its own focus trap; no additional focus management is needed from the SDK side.

### Usage

```tsx
import { AccessibleWalletControls } from "./AccessibleWalletControls";
import { WalletStatusTracker } from "sorokit-core/wallet";

const tracker = new WalletStatusTracker();

// In your component:
<AccessibleWalletControls
  walletStatus={tracker.status}
  onConnect={() => tracker.connect(adapter)}
  onDisconnect={() => tracker.disconnect(adapter)}
  busy={loading}
/>
```

Pass `busy={true}` during any in-progress operation to prevent double-clicks — it disables all action buttons.
