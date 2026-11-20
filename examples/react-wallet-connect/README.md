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

## Localization (#104)

All user-visible strings are centralized in `src/i18n.ts` as a typed dictionary. Amounts and dates use `Intl.NumberFormat` and `Intl.DateTimeFormat` — no extra dependency added to the core SDK.

```ts
import { ui, formatAmount, formatDate } from "./i18n";

// Swap strings for another locale by replacing values in the dictionary.
ui.connectButton;         // "Connect Freighter"
ui.paymentSentStatus("TXHASH"); // "Payment sent — tx TXHASH"

formatAmount("1234.5000000", "XLM", "de-DE"); // "1.234,5 XLM"
formatDate("2024-03-15T10:00:00Z", "fr-FR");  // "15 mars 2024, 10:00"
```

To use your own translations, replace the values in `i18n.ts` or load them from any i18n library (react-i18next, vue-i18n, fluent, …) and re-export the same `WalletUiStrings` shape.

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
