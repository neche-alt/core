# transaction-dashboard

React and Vue examples for a live transaction status dashboard powered by `sorokit-core`.

## Patterns covered

- Subscribing to `TransactionStatusAggregator` for live snapshot updates
- Polling a transaction source with `streamTransactionStatus`
- **Error recovery affordances (#106)**:
  - Read failures (snapshot reload, balance fetch) show a **Retry** button — the operation is idempotent and safe to repeat immediately
  - Write failures (transaction submission) show a **status-check prompt** with a block-explorer link so the user confirms the transaction did not land before resubmitting, preventing double-spends

## Error recovery rules

| Error kind | Recovery control | Why |
|---|---|---|
| `read` | "Retry" button | Re-fetching data has no side-effects |
| `write` | Status-check link + warning | Blind resubmission can double-spend |

## Files

| File | Framework | Purpose |
|---|---|---|
| `react-dashboard.example.tsx` | React | Aggregator subscription, metrics, error recovery |
| `vue-dashboard.example.vue` | Vue 3 | Same patterns with Composition API |

## Setup

```ts
import { TransactionStatusAggregator, streamTransactionStatus } from "sorokit-core/transaction";

const dashboard = new TransactionStatusAggregator({ maxEntries: 1000 });

// Start polling
const stop = streamTransactionStatus(fetchRecentTxs, dashboard, { intervalMs: 5000 });

// Subscribe a UI listener
const unsub = dashboard.subscribe((snapshot) => render(snapshot));

// Tear down on unmount
stop();
unsub();
```

## Signalling a write error

```ts
// After a failed submission, set an error with kind "write" and the txHash.
// The dashboard will show a status-check link instead of a retry button.
setDashError({
  kind: "write",
  message: "Submission timed out — outcome unknown.",
  txHash: result.txHash,
});
```

Type-check against the SDK source:

```bash
npm run typecheck:examples
```
