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
- **Network identity badge** (`NetworkBadge`) showing network name and testnet/mainnet distinction
- **Mainnet confirmation guard** (`useMainnetGuard` + `MainnetConfirmDialog`) for risky mainnet actions

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment |
| `src/App.tsx` | UI: network badge, connect button, balance list, payment form |
| `src/NetworkBadge.tsx` | Network identity badge, mainnet guard hook, confirmation dialog |

## NetworkBadge component

`NetworkBadge` always displays the active network name alongside a recognisable
testnet/mainnet distinction. It updates immediately when the `network` prop changes.

```tsx
import { NetworkBadge } from "./NetworkBadge";
import type { NetworkType } from "sorokit-core/network";

<NetworkBadge network="testnet" />
// → "Testnet — Test network — no real assets"

<NetworkBadge network="mainnet" />
// → "Mainnet — Real assets — transactions are irreversible" (amber warning style)
```

## Mainnet confirmation guard

`useMainnetGuard` gates any action that moves real assets behind an explicit
user confirmation. On testnet and futurenet it resolves immediately without
showing any prompt.

```tsx
import { useMainnetGuard, MainnetConfirmDialog } from "./NetworkBadge";

const guard = useMainnetGuard(network); // "mainnet" | "testnet" | "futurenet"

async function handleSend() {
  const confirmed = await guard.requestConfirmation();
  if (!confirmed) return; // user cancelled or non-mainnet — guard already resolved
  await sendPayment(...);
}

// Render the confirmation dialog when guard.isPending is true
{guard.isPending && (
  <MainnetConfirmDialog
    actionDescription="Send 10 XLM to GDEST…"
    onConfirm={guard.confirm}
    onCancel={guard.cancel}
  />
)}
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
