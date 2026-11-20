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
| `src/WalletConnectionDemo.tsx` | Polished demo: empty, loading, connected, rejected, disconnected states |

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

## Wallet Connection Demo

`WalletConnectionDemo` is a focused component that demonstrates all five wallet connection states driven by `WalletStatusTracker` from sorokit-core.

### States shown

| State | When |
|---|---|
| **Empty** | No wallet ever connected; shows a connect prompt |
| **Loading** | `connecting` or `authenticating` — spinner with extension prompt |
| **Connected** | Wallet connected; shows wallet name, truncated address, disconnect button |
| **Rejected** | `failed` or `error` — shows error message and a retry button |
| **Disconnected** | Previously connected but now disconnected; shows a reconnect button |

A `StatusBar` with a coloured dot and an `aria-live="polite"` region is always visible, so screen readers announce every state transition.

### Usage

```tsx
import { WalletConnectionDemo } from "./WalletConnectionDemo";
import { WalletStatusTracker } from "sorokit-core/wallet";
import { FreighterAdapter } from "sorokit-core/wallet";

const tracker = new WalletStatusTracker();
const adapter = new FreighterAdapter(swkInstance);

// In your component:
<WalletConnectionDemo
  status={tracker.status}
  callbacks={{
    onConnect: () => tracker.connect(adapter),
    onDisconnect: () => tracker.disconnect(adapter),
  }}
/>
```

All wallet logic stays in SDK calls (`tracker.connect`, `tracker.disconnect`). The component is purely presentational.
