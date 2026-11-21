# Recipe 23 — Contract Metadata Cache Invalidation

> **Issue #48 — Improve contract metadata lookup cache invalidation**

Sorokit caches contract metadata (the method list and the typed ABI schema) in
memory so repeated calls to `getContractMethods` and `parseContractSchema` do
not hit the network on every invocation. This recipe explains the cache
structure, its default lifetime, and how to clear it correctly when stale data
would cause problems.

---

## Cache structure

| Cache layer | Key pattern | What it holds |
|---|---|---|
| Method / ABI cache | `sorokit:contract-metadata:{contractId}` | `ContractMethod[]` — method names, parameter names, and types |
| Typed schema cache | `sorokit:contract-schema:{contractId}` | `ContractSchema` — full typed signatures used by `validateContractArgs` |

Both caches share the same two-layer strategy: an in-memory LRU map (bounded
by `setMetadataCacheCapacity` / `setContractSchemaCacheCapacity`) plus an
optional external `SorokitCache` you pass to the call options.

## Default TTL

Both caches use `DEFAULT_CONTRACT_METADATA_TTL_MS`, which is **1 hour**
(3 600 000 ms). Pass `options.ttlMs` to override per-call.

```ts
// Use a 10-minute TTL instead
await parseContractSchema(rpcUrl, contractId, { ttlMs: 10 * 60 * 1000 });
```

---

## When to invalidate

| Trigger | Why stale data is dangerous |
|---|---|
| **Contract upgrade** | The on-chain Wasm changes; old method signatures or parameter types no longer match the deployed code, causing silent mis-encoding or `CONTRACT_PREPARE_FAILED` errors. |
| **RPC endpoint change** | Different nodes may reflect different ledger states during a rollout or migration; the in-memory cache does not know you switched endpoints. |
| **Explicit refresh** | You need the most current ABI right now (e.g. to show it in a developer tool or to validate before a critical transaction). |

---

## Invalidation functions

### `invalidateContractMetadataCache(contractId, cache?)` — full refresh ✅

Clears **both** the method cache and the schema cache for the given contract.
Use this after a contract upgrade or when switching RPC endpoints.

```ts
import { invalidateContractMetadataCache } from "sorokit-core/soroban/contractMetadata";

// After an upgrade transaction has been confirmed:
invalidateContractMetadataCache(contractId);

// If you also keep an external cache (e.g. Redis adapter):
invalidateContractMetadataCache(contractId, myExternalCache);
```

The next call to `getContractMethods` or `parseContractSchema` for that
contract will re-fetch from the network and repopulate both caches.

### `invalidateContractCache(contractId, cache?)` — method list only

Clears only the method/ABI cache (`sorokit:contract-metadata:{contractId}`).
The schema cache (`sorokit:contract-schema:{contractId}`) is left intact.

Use this only when you are certain that the typed parameter schema has not
changed and you want to refresh just the raw method list.

```ts
import { invalidateContractCache } from "sorokit-core/soroban/contractMetadata";

invalidateContractCache(contractId);
```

> **Prefer `invalidateContractMetadataCache` after a contract upgrade.**
> Both caches encode argument types. If only the method cache is cleared but
> the schema cache still holds the old types, `validateContractArgs` will
> silently accept calls that the upgraded contract will reject.

---

## Explicit refresh behavior

"Explicit refresh" means forcing a network re-fetch by clearing the cache
before the next call, not by waiting for the TTL to expire.

After calling either invalidation function, the **very next** call to
`getContractMethods` or `parseContractSchema` will:

1. Miss the in-memory cache.
2. Miss the external cache (if you passed one and it was also cleared).
3. Issue a fresh RPC request (`getLedgerEntries`) to read the deployed Wasm.
4. Parse the `contractspecv0` custom section.
5. Repopulate both caches with a new TTL.

No background refresh or stale-while-revalidate logic is involved — the cache
is empty until the next synchronous caller fills it.

---

## Full example — invalidate then re-invoke after an upgrade

```ts
import {
  invalidateContractMetadataCache,
  parseContractSchema,
  validateContractArgs,
} from "sorokit-core/soroban/contractMetadata";
import { invokeContract } from "sorokit-core/soroban/invokeContract";

const rpcUrl     = "https://soroban-testnet.stellar.org";
const contractId = "CABC..."; // your contract address

// 1. Upgrade transaction confirmed on-chain.
//    Stale argument types must not reach the encoder.
invalidateContractMetadataCache(contractId);

// 2. Re-fetch the fresh ABI schema.
const schemaResult = await parseContractSchema(rpcUrl, contractId);
if (schemaResult.status === "error") throw new Error(schemaResult.error.message);

const schema = schemaResult.data;
console.log("Updated methods:", schema.methods.map(m => m.name));

// 3. Validate arguments against the new schema before invoking.
const validationResult = validateContractArgs(schema, "new_fn", 1);
if (validationResult.status === "error") {
  throw new Error(`Argument mismatch after upgrade: ${validationResult.error.message}`);
}

// 4. Invoke with confidence.
await invokeContract(rpcUrl, { contractId, method: "new_fn", args: [ /* ... */ ] });
```

---

## Resetting the entire cache (testing / dev tools)

```ts
import { resetMetadataCache } from "sorokit-core/soroban/contractMetadata";

// Clears all contracts from both the metadata and schema caches.
// Use for test isolation or when reinitialising the SDK.
resetMetadataCache();
```

> `resetMetadataCache()` clears **all** contracts. For production code, prefer
> the targeted functions above so you only evict what changed.

---

## Cache stats

```ts
import { getContractMetadataCacheStats } from "sorokit-core/soroban/contractMetadata";

const stats = getContractMetadataCacheStats();
// { metadataEntries: number, schemaEntries: number, inFlightRequests: number }
console.log(stats);
```

Use this to monitor memory pressure or verify that invalidation took effect.
