# next-serverless

Next.js example: server-side transaction signing with a secret key, batch operations, and a Vercel/Lambda-style serverless handler.

```
API route (server) — load account → build tx → sign with secret key → submit
Client page (browser) — trigger action → poll result → show status
```

## Patterns covered

- Server-side signing with `signTransactionOffline` (no browser wallet needed)
- Batch account fetches with `client.account.getAccountsBatch`
- Building a payment on the server and submitting from an API route
- Vercel/Lambda handler pattern: one-shot client, sign, submit, return result
- Separating server-only code (secret keys) from browser code

## Files

| File | Purpose |
|---|---|
| `src/sorokitServer.ts` | Server-side helpers: client factory, sign-and-submit, batch fetch |
| `src/pages/api/payment.ts` | Next.js API route: receives POST, builds, signs, and submits |
| `src/pages/api/balances.ts` | API route: batch balance fetch for multiple public keys |
| `src/pages/index.tsx` | Client page: triggers the payment and displays the result |
| `src/lambda.ts` | Drop-in AWS Lambda / Vercel Edge handler (same logic, different runtime) |

## Balance presentation

The `/api/balances` route returns the raw `accounts` payload **and** a
`formatted` view that is safe to render directly:

```jsonc
{
  "accounts": [/* raw AccountInfo[] — unchanged */],
  "formatted": [
    {
      "publicKey": "G…",
      "balances": [
        { "assetType": "native", "assetCode": "XLM", "assetIssuer": null,
          "assetLabel": "XLM (native)", "amount": "1,234.5" },
        { "assetType": "credit_alphanum4", "assetCode": "USDC", "assetIssuer": "G…",
          "assetLabel": "USDC · GABC…WXYZ", "amount": "12.3456789" }
      ]
    }
  ]
}
```

The formatted view is built with the public `formatDisplayAmount` /
`formatDisplayAsset` helpers. `formatDisplayAmount` formats balances as decimal
strings — it never routes the value through `Number`, so balances that exceed
`Number.MAX_SAFE_INTEGER` (or carry many decimal places) are preserved exactly.
`formatDisplayAsset` exposes the asset code with issuer context (abbreviated by
default) and falls back to a labelled `"Unknown asset"` entry for unrecognized
asset types.

```ts
// In this in-repo example the helpers resolve to the source
// (relative path from src/pages/api/balances.ts):
import { formatDisplayAmount, formatDisplayAsset } from "../../../../../src/utility";
// In your own app they are the published package API:
import { formatDisplayAmount, formatDisplayAsset } from "sorokit-core/utility";
```

## Setup

```bash
npm install sorokit-core @creit.tech/stellar-wallets-kit next react react-dom
```

Set your secret key as an environment variable — never hard-code it:

```bash
# .env.local
SIGNING_SECRET_KEY=S...
STELLAR_NETWORK=testnet
```

## Security note

`signTransactionOffline` accepts a raw secret key. Keep it in an environment
variable and never expose it to the browser. The API routes in this example are
server-only (`pages/api/`) and Next.js never bundles them into the client.

## Cold-start patterns

Serverless containers pay a one-time initialisation cost on the first request after deployment or after the container goes idle. The `coldStart.ts` module provides three helpers that reduce this overhead.

**Lazy singleton client** — `lazyGetClient()` creates the `SorokitClient` once per container lifetime and reuses it on every warm invocation. This is safe because the client holds no open connections, only configuration.

```ts
import { lazyGetClient } from "./coldStart";

// First call in the container: creates the client (~cold start).
// Every subsequent call in the same container: returns the cached instance.
const client = lazyGetClient();
```

**Per-request deadline** — `withDeadline(ms)` wraps `AbortController` with a `setTimeout`. Pass the signal to any SDK call that accepts one. Always call `cancel()` in a `finally` block to release the timer.

```ts
import { withDeadline } from "./coldStart";

const { signal, cancel } = withDeadline(8_000); // 8 s budget
try {
  const result = await client.account.getAccountsBatch(keys, { signal });
  return result;
} finally {
  cancel();
}
```

**Bounded concurrency** — Pass `concurrency` to `getAccountsBatch` to cap simultaneous upstream requests and avoid triggering rate limits.

```ts
import { lazyGetClient } from "./coldStart";

const client = lazyGetClient();
// At most 3 Horizon requests in-flight at any time.
const result = await client.account.getAccountsBatch(keys, { concurrency: 3 });
```

**Graceful shutdown** — call `registerShutdown()` once at startup to reset the singleton on `SIGTERM`.

```ts
import { registerShutdown } from "./coldStart";
registerShutdown();
```

The full drop-in example lives in `src/coldStart.ts`. The corresponding test coverage is in `src/tests/coldStart.test.ts`.

## Running type-checks

```bash
npm run typecheck:examples
```
