# Recipe 24 — Event Ordering and Ledger Finality Semantics

This recipe explains the ordering, deduplication, and confirmation guarantees that sorokit-core provides for streamed Soroban contract events, and what you should handle yourself.

---

## Stellar finality model

Stellar closes a new ledger roughly every 5 seconds. Once a ledger is closed it is **final** — there are no chain reorgs, no forks, and no mechanism by which a closed ledger can be rolled back. Any event that appears in a closed ledger is therefore immutable: it will never be removed or reordered by the network.

This is different from probabilistic finality (e.g. proof-of-work chains). You do not need to wait for confirmations before treating a Soroban event as settled.

---

## Ordering guarantees the SDK provides

### `filterContractEvents`

`filterContractEvents` preserves the input order exactly. It does not sort, group, or reorder events in any way. If you pass events in ledger-sequence order (which `subscribeContractEvents` does), the output is also in ledger-sequence order.

```ts
import { filterContractEvents } from "sorokit-core";

const transferEvents = filterContractEvents(events, { eventType: "transfer" });
// transferEvents are in the same order as `events`
```

### `subscribeContractEvents`

When a gap is detected between the last-seen ledger and the current ledger tip, the subscription layer fetches the missed ledger range and delivers those **recovered events before the current-poll events** via the callback. This guarantees chronological delivery even after a brief disconnection:

1. Recovered events (ledger `N+1` … `M-1`) — callback called first.
2. Current events (ledger `M`) — callback called second.

### `streamContractEvents`

`streamContractEvents` combines recovered and current events into a **single yielded batch per poll cycle**, in the same order: recovered events first, then current events. Within each group, ledger sequence order is preserved.

---

## Deduplication

| Layer | Deduplicates? |
|---|---|
| `subscribeContractEvents` | ✅ Yes — by event `id` across poll cycles (TTL-bounded set) |
| `streamContractEvents` | ✅ Yes — by event `id` across poll cycles (TTL-bounded set) |
| `filterContractEvents` | ❌ No — passes all matching events through, including duplicates |

If the same event id appears in both a gap-recovery batch and a live poll, the subscription layer's deduplication set will suppress the second occurrence. The callback or generator will only see it once per subscription lifetime (subject to the TTL window — see `deduplicationTtlMs`).

`filterContractEvents` is a pure filter: it deliberately does not deduplicate, so you can apply it to arbitrary snapshots without side-effects.

---

## Duplicate events

Duplicates can arise when:

- The same ledger range is covered by both gap-recovery and a live poll.
- An SDK consumer calls `filterContractEvents` on an array that already contains duplicates (e.g. a merged snapshot from two sources).

In the first case the subscription layer deduplicates before invoking the callback. In the second case `filterContractEvents` will pass both copies through — deduplication is the caller's responsibility when working with raw snapshots.

---

## Confirmation semantics

A Soroban event is **confirmed** the moment it appears in a closed ledger. There is no "pending" state for contract events: unlike transaction submissions (which can time out or be rejected), events only exist in the ledger after the transaction that emitted them was included and the ledger was closed.

Practical implication: if `subscribeContractEvents` delivers an event to your callback, that event is already final.

---

## Out-of-order receipt

Out-of-order delivery of finalized events is **not possible** at the Stellar protocol level because ledgers are totally ordered and final. Within the SDK:

- The gap-recovery mechanism explicitly fetches the missed ledger range and sorts it by ledger sequence before delivering.
- `subscribeContractEvents` always calls the callback with recovered events before current events.

The only scenario that resembles out-of-order delivery is when you merge two independent event streams yourself (e.g. the output of two separate `subscribeContractEvents` calls). In that case, sort by `ledger` before processing.

---

## What the SDK does NOT guarantee

| Guarantee | Notes |
|---|---|
| Wall-clock delivery latency | Delivery depends on polling interval and Horizon response time. Default poll interval is 1 500 ms. |
| Delivery of events emitted before subscription started | Use `queryContractEvents` to fetch historical events. |
| Exactly-once delivery across process restarts | The deduplication set lives in memory. After a restart the SDK may re-deliver events within the `recoveryWindowMs`. Persist the last-processed ledger sequence and pass it as your starting point to avoid this. |
| Delivery of events outside the recovery window | If your process is offline longer than `recoveryWindowMs` (default 60 s), events from the gap beyond that window are silently skipped. Increase `recoveryWindowMs` or use `queryContractEvents` for a full backfill. |

---

## Example: persisting the cursor across restarts

```ts
import { subscribeContractEvents, type ContractEvent } from "sorokit-core";

// Load the last-processed ledger from durable storage.
let lastLedger: number = loadCursorFromStorage() ?? 0;

const unsubscribe = subscribeContractEvents(
  "CCONTRACTID...",
  undefined,
  (events: ContractEvent[]) => {
    for (const event of events) {
      processEvent(event);
      if (typeof event.ledger === "number" && event.ledger > lastLedger) {
        lastLedger = event.ledger;
        saveCursorToStorage(lastLedger); // persist after each batch
      }
    }
  },
  {
    horizonUrl: "https://horizon-testnet.stellar.org",
    recoveryWindowMs: 5 * 60 * 1_000, // 5 minutes
  },
);
```

By persisting the cursor you can query missed events with `queryContractEvents` on startup and hand off to the live subscription from the correct ledger.
