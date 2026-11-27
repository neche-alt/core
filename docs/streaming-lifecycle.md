# Streaming API: lifecycle and cursor semantics

The SDK exposes two streaming surfaces: an async generator for account and transaction state changes, and an event-emitter interface for lower-level subscriptions. This guide specifies the startup, unsubscribe, reconnect, cursor, and delivery semantics for each surface, and includes runnable cleanup examples.

---

## Streams overview

| Surface | Transport | Cursor support | Use case |
|---------|-----------|---------------|---------|
| `client.account.stream` | HTTP polling | No (stateless) | Live account state |
| `client.transaction.stream` | HTTP polling (default), SSE, auto | Yes (`nextCursor`) | Paginated transaction history |
| `streamTransactions` | HTTP polling / SSE / auto | Yes (`cursor` config + `nextCursor` result) | Direct streaming without a client |
| `StreamEventEmitter` | In-process | No | Internal SDK event fan-out |

---

## Startup semantics

By default, the stream emits the current state immediately on the first poll (`emitOnStart: true`). Disable this if you only want events that arrive after the stream starts:

```ts
for await (const result of client.transaction.stream(
  publicKey,
  { emitOnStart: false },
  signal,
)) { /* ... */ }
```

The first emission occurs synchronously on the next event-loop tick after the first successful poll. No data is buffered before the consumer is ready because async generators are pull-based: the producer yields only when the consumer calls `next()`.

---

## Unsubscribe / teardown

All streams accept an `AbortController` signal. Aborting the signal stops the stream cleanly after the current iteration completes — no further polls are issued and no further values are yielded.

```ts
import { createSorokitClient, resolveNetwork } from "sorokit-core";

const net = resolveNetwork("testnet");
if (net.status === "error") throw new Error(net.error.message);

const client = createSorokitClient({ network: "testnet" });
const ac = new AbortController();

// Start the stream in a background task
const task = (async () => {
  for await (const result of client.transaction.stream(
    "GABC…PUBLIC_KEY",
    { intervalMs: 3000 },
    ac.signal,
  )) {
    if (result.status === "ok") {
      console.log("transactions:", result.data.transactions.length);
    }
    if (result.status === "error" && result.error.code === "ABORTED") {
      break; // stream was aborted cleanly
    }
  }
})();

// Stop after 30 seconds (or from any event handler)
setTimeout(() => ac.abort(), 30_000);
await task;
```

Calling `ac.abort()` is idempotent — subsequent calls are no-ops.

For the event-emitter surface, the return value of `emitter.on()` is the unsubscribe function:

```ts
import { StreamEventEmitter } from "sorokit-core";

const emitter = new StreamEventEmitter<{ payment: { amount: string } }>();

const unsubscribe = emitter.on("payment", async (payload) => {
  console.log("received payment:", payload.amount);
});

// Stop receiving events
unsubscribe();
```

Calling `unsubscribe()` is safe to call multiple times.

---

## Reconnect semantics

Streams use automatic retry with exponential backoff for transient network errors (timeouts, network connectivity failures, and 5xx responses from Horizon). This is enabled by default (`enableAutoRetry: true`).

**Backoff schedule**: 1 s → 2 s → 4 s → 8 s → 16 s → 30 s (capped). After 5 consecutive transient failures the stream emits an error result and pauses for 60 seconds before resuming.

Permanent errors (404, 400, non-transient contract errors) are emitted as error results without retry and do not trigger the backoff.

```ts
for await (const result of client.transaction.stream(publicKey, {}, signal)) {
  if (result.status === "error") {
    if (result.error.code === "TIMEOUT" || result.error.code === "NETWORK") {
      // Transient — the stream retries automatically; you may log here
      console.warn("transient error, retrying:", result.error.message);
    } else if (result.error.code === "ABORTED") {
      break; // clean stop
    } else {
      // Permanent — decide whether to break or surface to the user
      console.error("permanent error:", result.error.message);
      break;
    }
  }
}
```

To disable automatic retry and handle reconnect logic yourself, pass `enableAutoRetry: false`.

---

## Cursor semantics

Cursors are opaque string tokens that identify a position in the Horizon transaction log. They allow a stream to resume from where it left off after a disconnect, restart, or page boundary.

### How cursors work

- Each `streamTransactions` yield includes a `nextCursor: string | null` field.
- Pass `nextCursor` back as `cursor` in the next stream config to receive only transactions that arrived after that position.
- If `nextCursor` is `null`, there are no further records in the requested direction; the stream will keep polling for new ones.

```ts
import { streamTransactions, createCursorStore } from "sorokit-core";

const cursorStore = createCursorStore(); // localStorage in browsers, memory otherwise
const CURSOR_KEY = "tx-stream:GABC…PUBLIC_KEY";

// Load persisted cursor on startup
const savedCursor = await cursorStore.load(CURSOR_KEY);

const ac = new AbortController();

for await (const result of streamTransactions(
  "https://horizon-testnet.stellar.org",
  "GABC…PUBLIC_KEY",
  {
    cursor: savedCursor,       // resume from last known position
    order: "asc",              // ascending order required for cursor-based resume
    enableAutoRetry: true,
  },
  ac.signal,
)) {
  if (result.status === "ok") {
    // Process transactions
    for (const tx of result.data.transactions) {
      console.log("tx hash:", tx.hash);
    }

    // Persist cursor after processing, so a restart resumes here
    if (result.data.nextCursor !== null) {
      await cursorStore.save(CURSOR_KEY, result.data.nextCursor);
    }
  }
}
```

### CursorStore implementations

| Class | Environment | Persistence |
|-------|-------------|-------------|
| `MemoryCursorStore` | Any | In-process only (lost on restart) |
| `LocalStorageCursorStore` | Browser | Survives page reload |
| `createCursorStore()` | Any | Auto-selects: localStorage in browsers, memory in Node |

Construct a `LocalStorageCursorStore` with an explicit `Storage` instance for server-side rendering or test environments:

```ts
import { LocalStorageCursorStore } from "sorokit-core";

// Tests / SSR — provide a custom Storage implementation
const store = new LocalStorageCursorStore(myStorageImplementation);
```

Constructing `LocalStorageCursorStore` without a usable `Storage` throws a descriptive error immediately (fail-fast) rather than silently holding an `undefined` reference.

---

## Delivery semantics

### Exactly-once delivery

The SDK does not guarantee exactly-once delivery at the network level. After a reconnect, Horizon may return events that were already processed by the consumer. Use `PersistentEventDeduplicationStore` to prevent duplicate processing:

```ts
import {
  streamTransactions,
  PersistentEventDeduplicationStore,
  createCursorStore,
} from "sorokit-core";

const dedup = new PersistentEventDeduplicationStore(
  10_000,       // max tracked IDs
  60 * 60_000,  // 1-hour TTL
);

const cursorStore = createCursorStore();
const CURSOR_KEY = "tx-stream:dedup-example";
const savedCursor = await cursorStore.load(CURSOR_KEY);

const ac = new AbortController();

for await (const result of streamTransactions(
  "https://horizon-testnet.stellar.org",
  "GABC…PUBLIC_KEY",
  { cursor: savedCursor, order: "asc" },
  ac.signal,
)) {
  if (result.status === "ok") {
    for (const tx of result.data.transactions) {
      if (await dedup.has(tx.hash)) continue; // already processed

      await processTransaction(tx);
      await dedup.add(tx.hash);
    }

    if (result.data.nextCursor !== null) {
      await cursorStore.save(CURSOR_KEY, result.data.nextCursor);
    }
  }
}
```

`PersistentEventDeduplicationStore` evicts entries older than the TTL and caps the total at `maxSize` (oldest first).

### Event ordering

- Streams are ordered by Horizon's cursor, not by wall-clock time.
- Ascending order (`order: "asc"`) is required for correct cursor-based resumption.
- Descending order (`order: "desc"`, the default) returns the most recent transactions first and is suitable for displaying history without cursor resumption.

### Backpressure

`StreamEventEmitter` applies per-listener backpressure: if a listener returns a promise, the emitter does not invoke that listener with its next event until the promise resolves. Slow consumers cannot accumulate unbounded concurrent handler work.

---

## Complete runnable cleanup example

```ts
import {
  createSorokitClient,
  resolveNetwork,
  createCursorStore,
  PersistentEventDeduplicationStore,
} from "sorokit-core";

const PUBLIC_KEY = "GABC…PUBLIC_KEY";
const CURSOR_KEY = `tx-stream:${PUBLIC_KEY}`;

async function runTransactionStream(signal: AbortSignal): Promise<void> {
  const net = resolveNetwork("testnet");
  if (net.status === "error") throw new Error(net.error.message);

  const client = createSorokitClient({ network: "testnet" });
  const cursorStore = createCursorStore();
  const dedup = new PersistentEventDeduplicationStore();

  const savedCursor = await cursorStore.load(CURSOR_KEY);

  for await (const result of client.transaction.stream(
    PUBLIC_KEY,
    {
      cursor: savedCursor,
      order: "asc",
      intervalMs: 5000,
      enableAutoRetry: true,
    },
    signal,
  )) {
    if (result.status === "error") {
      if (result.error.code === "ABORTED") break;        // clean shutdown
      console.warn("stream error:", result.error.message); // transient — retrying
      continue;
    }

    for (const tx of result.data.transactions) {
      if (await dedup.has(tx.hash)) continue;
      console.log("new transaction:", tx.hash);
      await dedup.add(tx.hash);
    }

    if (result.data.nextCursor !== null) {
      await cursorStore.save(CURSOR_KEY, result.data.nextCursor);
    }
  }
}

// Usage
const ac = new AbortController();
const streamTask = runTransactionStream(ac.signal);

// Teardown (from any context)
process.on("SIGINT", () => ac.abort());
process.on("SIGTERM", () => ac.abort());

await streamTask;
```
