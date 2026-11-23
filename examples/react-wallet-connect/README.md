# react-wallet-connect

Connect a Stellar wallet with Freighter, fetch balances, and send a payment — using `sorokit-core` in a React app.

```
Connect wallet → Fetch balances → Build payment → Review summary → Confirm → Sign → Submit
```

## Patterns covered

- Wallet connection and disconnection with `FreighterAdapter`
- Loading account balances with `client.account.getBalances`
- Building a payment with `client.transaction.buildPayment`
- **Showing a confirmation summary before the wallet prompt opens** (#105)
- Handling `SorokitResult<T>` in component state (no try/catch)
- Loading and error states per operation

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment flow |
| `src/App.tsx` | UI: connect button, balance list, payment form, confirmation summary |
| `src/TransactionConfirmationSummary.tsx` | Reusable summary panel shown before signing |

## Confirmation summary (#105)

A demo should teach integrators to show users what they are approving before
the wallet extension opens. This example enforces a two-step flow:

1. The user fills in the payment form and clicks **Review & send**.
2. `useSorokit` builds the transaction XDR and fetches a fee estimate (if
   available), then sets `pendingSummary` — it does **not** open the wallet.
3. `App.tsx` renders `TransactionConfirmationSummary`, which displays:
   - Network (e.g. `testnet`)
   - Destination address
   - Operation summary (e.g. "Send 10 XLM to GDEST000…")
   - Asset
   - Amount
   - Estimated fee in stroops (labelled "—" when unavailable)
4. The user clicks **Confirm & open wallet** → `confirmPayment()` is called →
   the wallet extension opens for signing → the transaction is submitted.
5. If the user clicks **Cancel** → `cancelPayment()` discards the pending XDR
   without opening the wallet extension.

```tsx
// In your own component:
{pendingSummary && (
  <TransactionConfirmationSummary
    summary={pendingSummary}
    onConfirm={confirmPayment}
    onCancel={cancelPayment}
  />
)}
```

Fields that cannot be determined (e.g. fee estimation fails) are set to `null`
in the summary and rendered as "—" in the panel — they are never hidden.

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
const {
  walletState,
  connect,
  balances,
  sendPayment,
  pendingSummary,
  confirmPayment,
  cancelPayment,
} = useSorokit(kit, "testnet");
```

## Running

Because this example lives inside the sorokit-core repo, its imports point to
`../../../src/...`. In your own app they become `import { ... } from "sorokit-core"`.

Type-check the example against the SDK source:

```bash
yarn typecheck:examples
```
