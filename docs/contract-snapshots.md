# Contract Snapshot Safety

`snapshotContractState` captures a contract's on-chain instance state for comparison and audit.
Because contract state can be arbitrarily large and may contain sensitive data, the SDK enforces
configurable size bounds and supports key-level redaction.

## Size limits

Every snapshot is size-checked before it is stored. If the serialised state exceeds the limit,
`snapshotContractState` returns an error and nothing is written to the store.

```ts
import {
  snapshotContractState,
  MAX_SNAPSHOT_STATE_BYTES,
} from "sorokit-core";

// Default limit is MAX_SNAPSHOT_STATE_BYTES (2 MiB)
const result = await snapshotContractState(rpcUrl, contractId, "pre-upgrade");
if (result.status === "error") {
  console.error(result.error.message); // "Snapshot state exceeds size limit: …"
}

// Set a tighter limit per call
const bounded = await snapshotContractState(rpcUrl, contractId, "pre-upgrade", {
  maxStateBytesPerSnapshot: 512 * 1024, // 512 KiB
});
```

The default is `MAX_SNAPSHOT_STATE_BYTES` (2,097,152 bytes). Lower it for memory-constrained
environments. The estimate uses `JSON.stringify(state).length * 2` (UTF-16 approximation).

## Key redaction

Omit sensitive fields from the stored snapshot before it is persisted or compared:

```ts
const result = await snapshotContractState(rpcUrl, contractId, "baseline", {
  redactKeys: ["wasmHash", "adminKey"],
});
```

Redacted keys are removed from `state` before the size check and before storage. They will not
appear in diffs produced by `compareSnapshots`.

## Retention policy

The in-memory store is bounded. Without a policy, it defaults to 200 snapshots. Configure it
globally:

```ts
import { setContractSnapshotRetention, pruneContractSnapshots } from "sorokit-core";

setContractSnapshotRetention({
  maxSnapshots: 50,
  maxAgeMs: 60 * 60 * 1000, // 1 hour
});

// Prune explicitly (also called automatically on every write)
pruneContractSnapshots();
```

## Security considerations

- Snapshots may include WASM hashes that identify contract code. Do not log or transmit snapshots without redaction in multi-tenant environments.
- Use `redactKeys` for any field that could reveal operational secrets.
- In serverless or edge environments, call `clearSnapshots()` between requests to prevent cross-request state leakage.
