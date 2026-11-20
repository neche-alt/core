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
