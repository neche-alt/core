# next-app-router

Next.js App Router example: demonstrating the server/client component boundary with sorokit-core.

```
Server Component (page.tsx)
  └─ Client Component (PaymentForm.tsx) ──fetch──► Route Handler (api/sign-and-submit/route.ts)
                                                        ├─ signTransactionOffline  [server-only]
                                                        └─ createSorokitClient     [safe anywhere]
```

## Why this matters

Next.js App Router bundles Client Components (`"use client"`) for the browser. Any module they import is included in the client bundle. The sorokit-core SDK has paths that use Node.js APIs (`crypto`, BIP39 derivation) which are unavailable in browsers and must never be bundled client-side.

## SDK subpath boundary

| Import path | Safe in client bundle? | Notes |
|---|---|---|
| `sorokit-core` (index) | ✅ Yes | General SDK helpers |
| `src/client/createSorokitClient` | ✅ Yes | Client factory, no Node APIs |
| `src/transaction/buildTransaction` | ✅ Yes | XDR building, pure JS |
| `src/wallet/signTransaction` | ✅ Yes | Browser wallet adapter signing |
| `src/wallet/signTransactionOffline` | ❌ Server only | Uses Node `crypto` via Stellar SDK |
| `src/security/keyManagement` | ❌ Server only | BIP39, Node `crypto`, key derivation |

## Files

| File | Boundary | Purpose |
|---|---|---|
| `src/app/page.tsx` | Server Component | Root page — no `"use client"`, may import server utilities |
| `src/app/layout.tsx` | Server Component | Root layout |
| `src/app/api/sign-and-submit/route.ts` | Route Handler (server) | Signs XDR with secret key, submits, returns hash |
| `src/components/PaymentForm.tsx` | Client Component | UI form — calls Route Handler via `fetch()` |

## Setup

```bash
npm install next react react-dom
```

Set environment variables in `.env.local` — never commit secrets:

```bash
# .env.local
SIGNING_SECRET_KEY=S...
STELLAR_NETWORK=testnet
```

## Running

```bash
npx next dev
```

## Guard script

The `scripts/check-client-boundary.mjs` script fails the build if any `"use client"` file imports server-only modules:

```bash
node scripts/check-client-boundary.mjs
```

Add this to your CI pipeline or as a pre-build step:

```json
"scripts": {
  "check:boundary": "node scripts/check-client-boundary.mjs"
}
```

## Typecheck

```bash
tsc -p examples/next-app-router/tsconfig.json --noEmit
```

## How the boundary works

1. `page.tsx` is a **Server Component** — Next.js renders it on the server. It can import `signTransactionOffline` safely (though this example delegates that to the Route Handler).

2. `PaymentForm.tsx` is a **Client Component** (`"use client"`). It is bundled for the browser. It must not import Node-only paths. It calls the Route Handler via `fetch()`.

3. `api/sign-and-submit/route.ts` is a **Route Handler** — always server-side. It imports `signTransactionOffline`, reads the secret key from `process.env`, signs, submits, and returns only the transaction hash to the browser.

## Security note

The signing secret key is read from `process.env.SIGNING_SECRET_KEY` on the server. It never appears in the client bundle, never travels to the browser, and never appears in API responses — only the resulting transaction hash is returned.
