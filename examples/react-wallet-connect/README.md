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

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, reconnect consent flow, account ops, payment |
| `src/App.tsx` | UI: reconnect consent banner, connect button, balance list, payment form, status messages |

## Reconnect consent flow

```ts
import { reconnectWithConsent } from "sorokit-core/wallet";
import { saveSession, clearSession } from "sorokit-core/wallet";

// Save a session after a successful connect:
await saveSession({ publicKey, walletType, network });

// On mount, attempt to restore with consent:
const outcome = await reconnectWithConsent(
  adapter,
  async (ctx) => {
    // ctx includes publicKey, walletType, network, connectedAt, trustEvaluation
    return showConsentDialog(ctx); // return true to approve, false to reject
  },
);

if (outcome.outcome === "connected") setWalletState(outcome.state);
if (outcome.outcome === "rejected")  clearSession(); // already cleared internally
```

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

## Running

Because this example lives inside the sorokit-core repo, its imports point to
`../../../src/...`. In your own app they become `import { ... } from "sorokit-core"`.

Type-check the example against the SDK source:

```bash
npm run typecheck:examples
```
