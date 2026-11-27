# vue-soroban

Vue 3 example: connect a wallet, pick a contract method, simulate the call with actionable feedback, then invoke it with progress steps.

```
Connect wallet → Select method → Simulate (fee estimate + validation) → Invoke → Show result
```

## Patterns covered

- Wallet connection with `FreighterAdapter` using Vue's `ref` / `reactive`
- **Simulation feedback** via `simulationFeedback` from `src/soroban/simulationFeedback.ts`
  - Shows estimated fee before asking the user to sign
  - Surfaces actionable failure details (insufficient balance, missing trustline, auth errors)
  - Never implies that a successful simulation guarantees execution
- Calling `client.soroban.invoke` with a sign callback
- Progress steps (`preparing` → `simulating` → `signing` → `confirming`) via `onProgress`
- Reading contract state without signing via `client.soroban.read`
- Account state streaming with an `AbortController`

## Files

| File | Purpose |
|---|---|
| `src/useContract.ts` | Composable: client setup, wallet state, simulation feedback, contract invoke, account stream |
| `src/App.vue` | UI: wallet panel, method selector, simulation feedback panel, invoke button, progress indicator |

## Simulation feedback

Before presenting the wallet-signing prompt, the example runs a simulation and surfaces the result:

```ts
import {
  buildPendingEvent,
  buildSimulationProgressEvent,
  buildRpcErrorEvent,
} from "sorokit-core/soroban"; // or from "../../../src/soroban/simulationFeedback"

// Emit pending state
simulationFeedback.value = buildPendingEvent();

const prepared = await client.soroban.prepare({ contractId, method, args, sourcePublicKey });

if (prepared.status === "error") {
  // Actionable failure message — never raw error codes
  simulationFeedback.value = buildRpcErrorEvent(prepared.error.message);
  return;
}

// Show estimated fee; include the disclaimer that simulation ≠ guaranteed execution
simulationFeedback.value = buildSimulationProgressEvent({ success: true, fee: prepared.data.fee });

// Now ask the wallet to sign
```

A `SimulationProgressEvent` has:

| Field | Type | Description |
|---|---|---|
| `state` | `"pending" \| "success" \| "validation_failed" \| "rpc_error"` | Current state |
| `message` | `string` | Human-readable label for the UI |
| `fee` | `string \| undefined` | Estimated fee in stroops (success only) |
| `detail` | `string \| undefined` | Actionable failure explanation |
| `rawError` | `string \| undefined` | Original error string for logs |

## Setup

```bash
npm install sorokit-core @creit.tech/stellar-wallets-kit
```

Initialise Stellar Wallets Kit before mounting the app:

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

Then pass it to `useContract`:

```ts
const {
  walletState,
  connect,
  invokeMethod,
  progress,
  simulationFeedback,
} = useContract(kit, contractId, "testnet");
```

## Running type-checks

```bash
npm run typecheck:examples
```
