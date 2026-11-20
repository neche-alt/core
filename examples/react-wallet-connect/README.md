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
- **Accessible copy-address control** (`CopyAddress`) with confirmation feedback and clipboard error handling

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment |
| `src/App.tsx` | UI: connect button, balance list, payment form, status messages |
| `src/CopyAddress.tsx` | Accessible copy-to-clipboard control for account addresses |

## CopyAddress component

`CopyAddress` renders a full account address alongside a copy button that:

- Copies the **untruncated** G-address to the clipboard using `navigator.clipboard.writeText`
- Shows `"Copied!"` on success (reverts after 2 s by default)
- Shows `"Copy failed"` when the Clipboard API is unavailable or the write is rejected (e.g. non-secure context)
- Exposes an `aria-label` on the button that changes with copy state, so screen readers announce the outcome
- Is fully keyboard accessible — focusable with Tab, activated with Enter or Space, with a visible focus ring

```tsx
import { CopyAddress } from "./CopyAddress";

// Render after wallet is connected:
<CopyAddress address={publicKey} />

// Custom feedback duration:
<CopyAddress address={publicKey} feedbackDurationMs={3000} />
```

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
