# Event cursor recovery example

A restartable contract event consumer: resume from a durable position after a
restart without losing events or replaying an unbounded history.

```
Load cursor → subscribe(startLedger) → recover events after cursor (bounded) → persist cursor → repeat
```

## The problem

`subscribeContractEvents` tracks the last ledger it processed **in memory**. A
restart loses that position, so the consumer either skips the events that
arrived while it was down or starts again from the current tip and misses the
gap. This example wires the subscription to a small **cursor store**: every
delivered batch advances a persisted "last processed ledger", and on the next
start the consumer passes that ledger as `startLedger` so the subscription
recovers the events after it.

## Cursor persistence and replay handling

- **Durable position.** The cursor is the highest ledger the consumer has fully
  processed. `createRestartableConsumer` loads it from a `CursorStore` before
  subscribing and writes it back after every batch.
- **Bounded replay.** Recovery is bounded by `recoveryWindowMs` (default 60 s,
  ~11 ledgers). On restart the subscription recovers only the ledgers inside the
  window that are newer than the cursor, so a long downtime never replays from
  genesis. Events older than the window are not replayed — persist the cursor
  frequently enough that the restart always lands inside the window.
- **No replay of the cursor ledger.** On the first poll after a resume, if the
  tip has not advanced past the cursor nothing new is delivered; the ledger the
  consumer already processed is not re-emitted (the per-session deduplication set
  starts empty on restart, so the subscription skips it explicitly).
- **Exactly-once is the consumer's job.** The SDK deduplicates event ids within a
  session only. Across restarts, deduplicate by event `id` (a stable paging token)
  if your downstream sink is not idempotent.
- **Advance the cursor with the work.** Call `store.save(ledger)` only after the
  batch is durably recorded downstream (write-ahead log, transactional outbox, or
  a flush). This example saves after `onEvents` returns, so pair it with a durable
  sink or move the `save` into your own commit.

`InMemoryCursorStore` is shown for the example and tests. Swap in a file,
database, or KV store by implementing `CursorStore`:

```ts
export interface CursorStore {
  load(): number | undefined;   // last processed ledger, or undefined on first run
  save(ledger: number): void;    // record that the consumer has processed up to ledger
}
```

## Files

| File | Purpose |
| --- | --- |
| `src/restartableConsumer.ts` | `CursorStore`, `InMemoryCursorStore`, `createRestartableConsumer` — framework-agnostic, no I/O beyond the passed-through `fetch`. |

## Running the checks

The example is type-checked against the SDK source with its own project file:

```bash
npx tsc --noEmit -p examples/event-cursor-recovery/tsconfig.json
```

Its resume behaviour is covered by `src/tests/event-cursor-recovery-example.test.ts`
and the cursor-recovery primitive by `src/tests/contract-event-cursor-resume.test.ts`,
both of which run as part of the normal suite (`npm run test`). Those tests
exercise the real SDK subscription with only Horizon faked, so the example
cannot silently drift from the API it documents.

## Using it

```ts
import {
  createRestartableConsumer,
  InMemoryCursorStore,
} from "sorokit-core"; // in your app: from this example's module

const store = new InMemoryCursorStore(); // replace with a durable store
const consumer = createRestartableConsumer("CONTRACT_ID", {
  horizonUrl: "https://horizon-testnet.stellar.org",
  store,
  recoveryWindowMs: 60_000,
  onEvents: (events) => {
    // record events durably; the cursor advances once this returns
  },
});

consumer.start();
// ...process events across the session...
consumer.stop();

// Later — restart with the same store: it resumes from the persisted ledger.
consumer.start();
```
