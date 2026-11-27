# transaction-dashboard

A React component that subscribes to a `TransactionStatusAggregator` and renders live metrics, status distribution, and recent transactions — using `sorokit-core` in a framework-agnostic way.

```
Poll source → Aggregate → Subscribe → Render metrics + recent txs
```

## Patterns covered

- Subscribing to `TransactionStatusAggregator` with `aggregator.subscribe`
- Streaming live updates with `streamTransactionStatus`
- Rendering `DashboardSnapshot` (metrics, chart data, recent entries)
- Responsive layout that works at mobile, tablet, and desktop widths

## Files

| File | Purpose |
|---|---|
| `react-dashboard.example.tsx` | Full React component with inline responsive styles |
| `responsive-layout.test.ts` | Layout token audit — verifies overflow prevention at all viewport sizes |

## Responsive layout

The dashboard is audited at three viewport sizes:

| Breakpoint | Behaviour |
|---|---|
| Mobile (≤ 480 px) | Single-column grid; metrics strip wraps to multiple lines; transaction hashes truncated with ellipsis |
| Tablet (≤ 768 px) | Single or two-column grid depending on available width (`auto-fit`) |
| Desktop (> 768 px) | Two-column grid; full metrics strip in one row |

All layout is implemented with inline styles so the component is self-contained and needs no external CSS. Key rules that prevent overflow:

- `width: 100%; maxWidth: 960` on the outer container — fills narrow screens, caps on wide ones.
- `flexWrap: wrap` on the metrics strip — items reflow instead of overflowing.
- `gridTemplateColumns: repeat(auto-fit, minmax(240px, 1fr))` — grid collapses to one column automatically.
- `overflow: hidden; textOverflow: ellipsis; whiteSpace: nowrap; minWidth: 0` on hash cells — long hashes never break the row.

## Setup

```bash
npm install sorokit-core
```

```ts
import {
  TransactionStatusAggregator,
  streamTransactionStatus,
} from "sorokit-core";
import { TransactionStatusDashboard, startLiveUpdates } from "./react-dashboard.example";

// Start polling your transaction source
const stop = startLiveUpdates(async () => fetchRecentTransactions());

// Render <TransactionStatusDashboard /> anywhere in your React tree
// Call stop() on unmount to cancel polling
```

## Running the layout tests

```bash
npm run test -- examples/transaction-dashboard/responsive-layout.test.ts
```
