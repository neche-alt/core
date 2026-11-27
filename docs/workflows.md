# Sorokit workflows

These examples use the public functions exported from `sorokit-core`. Each operation returns a `SorokitResult`; branch on `status` before reading `data` or `error`.

## Complete transaction lifecycle

The lifecycle is intentionally explicit: resolve a network, build unsigned XDR, ask a wallet to sign, submit the signed envelope, and monitor the resulting hash.

```ts
import {
  resolveNetwork,
  buildPaymentTransaction,
  submitTransaction,
  getTransactionStatus,
} from "sorokit-core";

const network = resolveNetwork("testnet");
if (network.status === "error") throw new Error(network.error.message);

const built = await buildPaymentTransaction(
  network.data.horizonUrl,
  network.data,
  sourcePublicKey,
  { destination, amount: "5", sequenceNumber, estimatedFee: "100" },
);
if (built.status === "error") throw new Error(built.error.message);

const signedXdr = await wallet.signTransaction(built.data, network.data.networkPassphrase);
const submitted = await submitTransaction(
  network.data.horizonUrl,
  network.data,
  signedXdr,
);
if (submitted.status === "error") throw new Error(submitted.error.message);

const status = await getTransactionStatus(network.data.horizonUrl, submitted.data.hash);
if (status.status === "ok" && status.data.status === "failed") {
  // Keep the original XDR and apply the recovery policy before retrying.
}
```

## Multisignature signing

Build the envelope once, collect signatures independently, and merge only signatures that match the same transaction hash. A rejected signature should be surfaced as a result and must not mutate the envelope.

```ts
import { buildMultiSigEnvelope, collectSignature, mergeSignatures } from "sorokit-core";

const envelope = buildMultiSigEnvelope({ transactionXdr, signers, threshold: 2 });
if (envelope.status === "error") throw new Error(envelope.error.message);
const first = await collectSignature(envelope.data, firstWallet);
const second = await collectSignature(envelope.data, secondWallet);
const merged = mergeSignatures(envelope.data, [first, second]);
```

## Soroban contract interaction

Prepare a contract call with ABI-typed arguments, simulate it before signing, then submit the prepared transaction. Simulation errors are actionable and should be displayed without attempting a submission.

```ts
const prepared = await client.soroban.prepare({
  contractId,
  method: "transfer",
  publicKey,
  args: [/* xdr.ScVal arguments */],
});
if (prepared.status === "error") return showError(prepared.error);

const simulation = await client.soroban.simulate(prepared.data.xdr);
if (simulation.status === "error") return recoverFromSimulation(simulation.error);
const signed = await client.wallet.signTransaction(adapter, {
  transactionXdr: prepared.data.xdr,
  networkPassphrase,
});
if (signed.status === "error") return showError(signed.error);
return client.soroban.execute(signed.data);
```

## Multi-endpoint failover and safe writes

When configuring multiple Horizon or Soroban RPC endpoints, requests automatically route to secondary healthy endpoints if the primary encounters 5xx, 429, or network disconnects. For mission-critical workflows:

1. **Stale read handling:** When failing over between nodes, ledger heights may temporarily differ. Verify response ledger numbers against your known high-water mark sequence.
2. **Safe write handling:** If a transaction submission times out during an endpoint switch, check its status using the immutable transaction hash before rebuilding or re-signing. Re-fetch account sequence numbers to avoid `tx_bad_seq` sequence desynchronization.
3. **Endpoint recovery:** An unhealthy primary automatically resumes receiving traffic once its `recoveryIntervalMs` passes and a request succeeds.

## Error recovery

Use the error code rather than parsing message text. A timeout or transient network error can be retried with the same immutable XDR. A sequence conflict requires rebuilding with a fresh account sequence. A wallet rejection should end the workflow without an automatic retry. Never mutate a submitted XDR while recovering.

## Trustline approval, cost planning, and refunds

`buildApprovedTrustlineTransaction` evaluates explicit issuer and asset rules before delegating to the existing bulk trustline builder. `analyzeTransactionCosts` and `summarizeTransactionCosts` are deterministic and work with incomplete fee histories, while `forecastTransactionCosts` accepts planned operation counts and can return a budget warning. `issueRefund` parses a single original payment, validates a full or partial amount, and builds a new payment transaction; the original XDR remains unchanged.
