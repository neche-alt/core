# soroban-lifecycle

A runnable walkthrough of the full Soroban contract invocation lifecycle: simulate, prepare, sign, submit, and confirm.

```
estimateFee (optional) → prepareContractCall → signFn → executeContract → confirmed tx hash
```

## Simulation vs confirmed execution

**Simulation** (the prepare step) is a pre-flight operation. It calls the Soroban RPC simulate endpoint, calculates resource limits and the minimum fee, and assembles the final transaction XDR. No ledger state changes. You can run it freely without spending any XLM.

**Submission** (the execute step) writes to the ledger. The transaction hash returned by `executeContract` is proof of on-chain inclusion. Never treat a simulation result as confirmation.

## Patterns covered

- Standalone fee estimation with `simulateTransaction` before asking for a signature
- Building and assembling a transaction XDR via `prepareContractCall`
- Wallet-agnostic signing — pass any `signFn: (xdr: string) => Promise<string>`
- Submitting and polling for confirmation via `executeContract`
- Typed recovery branches for each failure mode

## Files

| File | Purpose |
|---|---|
| `src/invokeLifecycle.ts` | `runLifecycle` — full pipeline; `estimateFeeBeforeInvoke` — standalone simulation |

## Setup

```bash
npm install sorokit-core @stellar/stellar-sdk
```

Set environment variables:

```bash
# .env
RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
CONTRACT_ID=C...          # deployed contract address
SOURCE_PUBLIC_KEY=G...    # funded account that invokes the contract
```

## Running the example

```bash
npx ts-node src/invokeLifecycle.ts
```

The placeholder `signFn` in `main()` does not actually sign — replace it with your wallet adapter before running against a live contract.

## Recovery guidance

| Step | Error code | Meaning | Action |
|---|---|---|---|
| Prepare | `CONTRACT_PREPARE_FAILED` | Bad contract ID, failed simulation, or bad method args | Fix input, retry — no ledger state changed |
| Sign | `WALLET_SIGN_FAILED` | `signFn` threw or returned empty string | Check wallet, retry signing |
| Execute — network | `SERVICE_UNAVAILABLE` | RPC node unreachable | Retry after back-off |
| Execute — timeout | `OPERATION_TIMEOUT` | Polling budget exhausted | Query Horizon by hash before retrying to avoid double-submit |
| Execute — rejected | `CONTRACT_INVOKE_FAILED` | Transaction rejected on-chain | Inspect contract error, fix inputs |

## Running type-checks

```bash
npm run typecheck:examples
```
