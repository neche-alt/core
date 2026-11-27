# Recipe 21 — Soroban Event Filters

Monitor selected contract methods precisely with `ContractEventFilter`, including topic matching, `contractId` exact-match behavior, cursor-based pagination, and filter composition.

## Imports

```ts
import {
  filterContractEvents,
  andEventFilters,
  orEventFilters,
  subscribeContractEvents,
  type ContractEventFilter,
  type ContractEvent,
} from "sorokit-core";
```

---

## ContractEventFilter shape

```ts
interface ContractEventFilter {
  /** Exact match on event.name */
  name?: string;
  /** Exact match on event.eventType */
  eventType?: string;
  /** Exact match on event.emitter (source account or contract address) */
  emitter?: string;
  /** Exact match on event.contractId */
  contractId?: string;
  /** Topic patterns — ANY topic in the event matching ANY pattern returns true */
  topics?: Array<string | RegExp>;
  /** Alias for topics */
  topicPatterns?: Array<string | RegExp>;
  /** All sub-filters must pass (logical AND) */
  and?: ContractEventFilter[];
  /** At least one sub-filter must pass (logical OR) */
  or?: ContractEventFilter[];
}
```

All fields are optional. An empty filter object `{}` passes every event.

---

## Matching semantics

### contractId

Exact string comparison with no case folding or prefix matching.

```ts
// Matches only events whose contractId is exactly this 56-character string
const filter: ContractEventFilter = {
  contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};
```

### name and eventType

Both are exact string comparisons. When a filter sets both `name` and `eventType`, the event must satisfy each independently.

### topics (OR semantics across topics and patterns)

The filter passes when **any** topic in the event matches **any** pattern in the filter's `topics` array:

```
topics.some(topic =>
  topicPatterns.some(pattern => matchesTopicPattern(topic, pattern))
)
```

A `string` pattern tests strict equality; a `RegExp` pattern uses `RegExp.test()`.

### and / or arrays

`and` requires all sub-filters to pass. `or` requires at least one sub-filter to pass. Both can be nested inside a parent filter that also carries top-level field constraints — the top-level fields must pass first, then the `and`/`or` conditions are evaluated.

---

## Representative topic values

Soroban events encode topic values as base64 XDR. Common examples:

| Semantic meaning | XDR base64 topic value        |
|------------------|-------------------------------|
| `swap`           | `AAAADQAAAAZzd2FwAAA=`        |
| `transfer`       | `AAAADQAAAAh0cmFuc2Zlcg==`    |
| `mint`           | `AAAADQAAAARtaW50`             |
| `burn`           | `AAAADQAAAARidXJu`             |
| `token`          | `AAAADQAAAAV0b2tlbgA=`        |
| `liquidity`      | `AAAADQAAAAtsaXF1aWRpdHk=`    |
| `fee`            | `AAAADQAAAANmZWU=`             |

Decode any topic at the Stellar Laboratory or with `SorobanClient.xdr.ScVal.fromXDR(base64, "base64")`.

---

## Examples

### Empty filter — receive all events

```ts
const all = filterContractEvents(events);
// or
const all2 = filterContractEvents(events, {});
```

### Single topic filter

```ts
const swapEvents = filterContractEvents(events, {
  topics: ["AAAADQAAAAZzd2FwAAA="],
});
```

### Multiple topic patterns — any match wins

```ts
// Returns events that contain either the "swap" or the "mint" topic
const swapOrMint = filterContractEvents(events, {
  topics: ["AAAADQAAAAZzd2FwAAA=", "AAAADQAAAARtaW50"],
});
```

### RegExp topic pattern

Useful when you want to match a prefix or cannot construct the exact XDR value:

```ts
// Matches any topic whose base64 encoding starts with "AAAADQAAAAV"
const tokenTopics = filterContractEvents(events, {
  topics: [/^AAAADQAAAAV/],
});
```

### contractId filter

```ts
const AMM_CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const ammEvents = filterContractEvents(events, {
  contractId: AMM_CONTRACT,
});
```

### Combining contractId and topics

```ts
// Only swap events from the AMM contract
const ammSwaps = filterContractEvents(events, {
  contractId: AMM_CONTRACT,
  topics: ["AAAADQAAAAZzd2FwAAA="],
});
```

### AND semantics with andEventFilters

```ts
const ammSwapFilter = andEventFilters(
  { contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA" },
  { eventType: "swap" },
);

const results = filterContractEvents(events, ammSwapFilter);
```

### OR semantics with orEventFilters

```ts
// mint events from either contract
const AMM_CONTRACT  = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TOKEN_CONTRACT = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5UZQDTQNQZJW";

const mintOrBurn = orEventFilters(
  { contractId: AMM_CONTRACT, eventType: "mint" },
  { contractId: TOKEN_CONTRACT, eventType: "mint" },
);
```

### Nested and[] / or[] inside ContractEventFilter

```ts
// AMM contract AND (swap OR liquidity_add)
const filter: ContractEventFilter = {
  contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  or: [
    { eventType: "swap" },
    { eventType: "liquidity_add" },
  ],
};
```

### Predicate function for arbitrary logic

When filter composition is insufficient, pass a plain predicate:

```ts
const highValueSwaps = filterContractEvents(events, (evt) => {
  if (evt.eventType !== "swap") return false;
  const value = evt.value as { amount?: bigint } | undefined;
  return (value?.amount ?? 0n) > 1_000_000n;
});
```

---

## Cursor-based pagination

Horizon returns events with an `id` field (also called `paging_token`) that serves as the cursor for the next page. After processing a page, pass the last event's `id` as the `cursor` parameter to retrieve subsequent pages.

```ts
const AMM_CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

async function fetchSwapPage(cursor?: string): Promise<{
  events: ContractEvent[];
  nextCursor: string | undefined;
}> {
  const params = new URLSearchParams({
    contract_id: AMM_CONTRACT,
    type: "contract",
    limit: "50",
    order: "asc",
    ...(cursor ? { cursor } : {}),
  });

  const res = await fetch(`https://horizon.stellar.org/events?${params}`);
  const json = await res.json();

  // filterContractEvents narrows to swap events only
  const swapEvents = filterContractEvents(
    json._embedded?.records ?? [],
    { topics: ["AAAADQAAAAZzd2FwAAA="] },
  );

  const nextCursor = swapEvents.at(-1)?.id;
  return { events: swapEvents, nextCursor };
}

// Walk pages until exhausted
let cursor: string | undefined;
do {
  const page = await fetchSwapPage(cursor);
  for (const evt of page.events) {
    console.log("swap", evt.id, evt.value);
  }
  cursor = page.nextCursor;
} while (cursor !== undefined);
```

### Pagination boundary: missing id

An event without an `id` field cannot be used as a cursor. Always guard:

```ts
const nextCursor = page.events.at(-1)?.id;
if (!nextCursor) {
  // End of stream or events without paging tokens — stop pagination
  break;
}
```

### Ledger-based boundary (alternative cursor)

When you need to resume from a known ledger rather than a paging token:

```ts
const fromLedger = 3_000_001;

const recentEvents = filterContractEvents(events, (evt) =>
  (evt.ledger ?? 0) >= fromLedger,
);
```

---

## Live subscription with subscribeContractEvents

`subscribeContractEvents` polls Horizon and delivers deduplicated events to a callback. Pass a `ContractEventFilter` or predicate directly:

```ts
import { subscribeContractEvents } from "sorokit-core";

const stop = subscribeContractEvents(
  {
    horizonUrl: "https://horizon.stellar.org",
    intervalMs: 5_000,
  },
  orEventFilters(
    { contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", eventType: "swap" },
    { contractId: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5UZQDTQNQZJW", eventType: "transfer" },
  ),
  (evt) => {
    console.log(`[${evt.eventType}] contract=${evt.contractId} ledger=${evt.ledger}`);
  },
);

// Later, stop polling
stop();
```

---

## See also

- [Recipe 13 — Balance Alerts Streaming](./13-balance-alerts-streaming.md)
- [Recipe 04 — Soroban Invoke](./04-soroban-invoke.md)
- [ADR 003 — Streaming Architecture](../adr/003-streaming-architecture.md)
- [Contract Event Archival](../contract-event-archival.md)
