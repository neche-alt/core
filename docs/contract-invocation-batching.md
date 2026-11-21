# Contract Invocation Batching

`invokeBatchContracts` runs multiple Soroban contract calls using the same
prepare → sign → execute pipeline as `invokeContract`, capturing per-invocation
outcomes without throwing.

## Atomicity

**There is no cross-invocation atomicity.** Each invocation is a separate
transaction submitted independently. A partial batch — where some calls succeed
and others fail — is a normal outcome. Callers must inspect each result's
`status` field rather than assuming all-or-nothing behaviour.

If you need atomic multi-contract execution, use a Soroban contract that
orchestrates the calls on-chain as a single transaction.

## Size limit

Batches are capped at `BATCH_INVOCATION_LIMIT` (20) invocations. Exceeding this
returns an error immediately, before any network I/O. Split large batches into
chunks:

```ts
import { invokeBatchContracts, BATCH_INVOCATION_LIMIT } from "sorokit-core";

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

for (const batch of chunk(invocations, BATCH_INVOCATION_LIMIT)) {
  const result = await invokeBatchContracts(rpcUrl, networkConfig, horizonUrl, batch, signFn);
  if (result.status === "error") {
    console.error(result.error.message);
    continue;
  }
  for (const item of result.data) {
    if (item.status === "error") {
      console.error(`${item.contractId}.${item.method} failed: ${item.error.message}`);
    }
  }
}
```

## Per-invocation outcomes

Results are returned in the same order as the input array. Each result carries
`contractId` and `method` for correlation:

```ts
const result = await invokeBatchContracts(rpcUrl, networkConfig, horizonUrl, invocations, signFn);
if (result.status === "ok") {
  for (const item of result.data) {
    if (item.status === "ok") {
      console.log(`${item.contractId}.${item.method} → ${item.data}`);
    } else {
      console.error(`${item.contractId}.${item.method} failed: ${item.error.message}`);
    }
  }
}
```

## Sequential vs parallel execution

By default invocations run in parallel via `Promise.allSettled`. Pass
`parallel: false` for sequential execution (useful when invocations have
ordering dependencies):

```ts
const result = await invokeBatchContracts(
  rpcUrl, networkConfig, horizonUrl, invocations, signFn,
  { parallel: false },
);
```

## Server limits

The Soroban RPC server may apply its own rate limits independently of the SDK
batch limit. If you encounter rate-limit errors, reduce the concurrency by
splitting into smaller batches or switching to sequential execution.
