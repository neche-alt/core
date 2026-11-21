# TTL-Aware Contract Data Reads

Soroban persistent and instance storage entries expire at a known ledger sequence
(`liveUntilLedgerSeq`). Applications should distinguish three states:

| State | Meaning |
|---|---|
| `"present"` | Entry exists and has not expired at the current ledger |
| `"expired"` | Entry exists in the response but its TTL has elapsed |
| `"missing"` | Entry was not in the RPC response (never written or already archived) |

## Classifying entry state

```ts
import { classifyContractDataTtl, buildContractDataTtlResult } from "sorokit-core";

// Low-level classification
const state = classifyContractDataTtl(latestLedger, entry?.liveUntilLedgerSeq);
// → "present" | "expired" | "missing"

// Full result with remainingLedgers
const result = buildContractDataTtlResult(latestLedger, entry?.liveUntilLedgerSeq);
// → { ttlState, liveUntilLedgerSeq?, remainingLedgers?, latestLedger }
```

## Reading with TTL awareness

```ts
import { readContractDataWithTtl } from "sorokit-core";
import { rpc as SorobanRpc, Address, xdr } from "@stellar/stellar-sdk";

const rpc = new SorobanRpc.Server(rpcUrl);
const key = xdr.LedgerKey.contractData(/* ... */);
const response = await rpc.getLedgerEntries(key);
const entry = response.entries[0];

const result = readContractDataWithTtl(
  response.latestLedger,
  entry?.liveUntilLedgerSeq,
  {
    errorOnExpired: true,  // return error instead of ok for expired entries
    errorOnMissing: false, // report missing as ok with ttlState: "missing"
  },
);

if (result.status === "error") {
  // Entry is expired — renew before using
  console.error(result.error.message);
} else {
  const { ttlState, remainingLedgers } = result.data;
  if (ttlState === "missing") {
    // Data was never written or has been archived
  }
}
```

## Renewal guidance

```ts
import { shouldRenewContractData, calculateStorageRent, renewContractStorage } from "sorokit-core";

const rentResult = await calculateStorageRent([contractId], { rpcUrl, networkPassphrase });
if (rentResult.status === "ok") {
  const entry = rentResult.data.entries[0];
  if (shouldRenewContractData(entry.remainingLedgers, 10_000)) {
    // Fewer than 10 000 ledgers (~2 days on Mainnet) remain — renew
    const renewal = await renewContractStorage(contractId, 100_000, renewOptions);
    // Sign and submit renewal.data.operationXdr
  }
}
```

## Safe refresh considerations

- **Do not cache stale reads.** When `ttlState === "expired"`, the data may have been
  reset by the protocol. Treat it as unavailable and renew before trusting values.
- **Missing ≠ expired.** A missing entry was never written or has been permanently
  removed; renewing it will not restore data. Check whether the contract must first
  re-initialise the entry.
- **Race window.** Between reading TTL and completing a renewal transaction, the entry
  may expire. Set `thresholdLedgers` conservatively (at least 2–3× the expected
  submission latency in ledgers).
