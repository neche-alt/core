# transaction-dashboard

React and Vue examples for the `TransactionStatusAggregator` real-time dashboard.

## Files

| File | Purpose |
|---|---|
| `react-dashboard.example.tsx` | React dashboard — live metrics, status distribution, recent transactions, and per-transaction timeline |
| `vue-dashboard.example.vue` | Vue 3 equivalent — same aggregator, different component API |
| `transaction-timeline.tsx` | Per-transaction status timeline React component |

## Transaction timeline

`TransactionTimeline` renders a step-by-step timeline for a single transaction. It maps SDK `TransactionResult.status` values to labeled steps with timestamps where available.

### States

| Step | When shown | SDK status |
|---|---|---|
| `submitted` | After `submitTransaction` returns a hash | — (pre-ledger) |
| `pending` | Horizon received it, not yet in a ledger | `"pending"` |
| `confirming` | Included in a ledger, building confirmation | — (intermediate) |
| `success` | Transaction confirmed | `"success"` |
| `failed` | Transaction rejected by the ledger | `"failed"` |
| `not_found` | Hash unknown to Horizon | `"not_found"` |

### Delayed confirmation

When a transaction has been in `submitted` or `pending` state longer than `confirmationWindowMs` (default 30 s), `isDelayed` becomes `true` and the component renders a `role="alert"` warning. The component re-checks every second while the transaction is live. Pass a custom `confirmationWindowMs` prop to adjust the threshold.

### Accessibility

Each timeline step carries an `aria-label` that includes the step name and timestamp when available. The `<ol>` list has `aria-label="Transaction status steps"`. The delayed-confirmation warning uses `role="alert"` so screen readers announce it immediately.

### Usage

```tsx
import { TransactionTimeline } from "./transaction-timeline";

// Basic — no submittedAt, so no "Submitted" step or delay detection.
<TransactionTimeline tx={transactionResult} />

// With submission time — enables the "Submitted" step and delayed-confirmation warning.
<TransactionTimeline tx={transactionResult} submittedAt={Date.now()} />

// Custom threshold — flag as delayed after 60 s instead of 30 s.
<TransactionTimeline tx={transactionResult} submittedAt={submittedAt} confirmationWindowMs={60_000} />
```

## Dashboard snapshot

The React dashboard subscribes to a `TransactionStatusAggregator` and re-renders on every snapshot update. The most recent transaction is passed to `TransactionTimeline` automatically.

```tsx
import { TransactionStatusDashboard, dashboard, startLiveUpdates } from "./react-dashboard.example";

// Start polling your transaction source (replace with your own fetch).
const stop = startLiveUpdates(() => myApi.getRecentTransactions());

// Render the dashboard.
<TransactionStatusDashboard aggregator={dashboard} />

// Stop when done.
stop();
```

## Setup

```bash
npm install sorokit-core
```

In your own app the SDK imports become `import { ... } from "sorokit-core"`. Inside this repo they point directly to `../../src/...`.
