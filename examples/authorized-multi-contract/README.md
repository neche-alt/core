# Authorized multi-contract invocations example

A multi-step contract workflow that makes the authorization boundary between
nested contract calls explicit: it surfaces which signer each step requires
before any network call, gates every step on explicit signer approval, invokes
the steps in order, and verifies the final result by collecting each confirmed
transaction hash.

```
Surface required auth → Confirm signer approval → Invoke → Verify confirmed hash → Next step
```

## When this matters

A contract workflow often composes several contract calls — for example a
bridge that *locks* tokens on one contract and *mints* them on another — and
each call may `require_auth` on a different account. Without surfacing the
authorization boundary, the wrong signer reaches the network and fails
late and vaguely (an opaque Soroban auth error after the upload), or a step
proceeds without the user ever consenting to sign.

This example separates three concerns:

1. **Surfacing required auth** — `describeRequiredAuth` reads each step's
   `ContractMethod.authorizationRequirements.requiredSigners` and reports, per
   step, which signers are required and whether the invoking account is among
   them. No I/O; call it to render an approval screen or to fail fast on a
   misconfigured signer before the first network call.
2. **Signer approval** — a `SignerApproval` callback asks the wallet/user to
   consent to each step's authorization. Resolve `ok` to approve, `err` to
   reject. Wire it to a wallet sign-request prompt, a `confirm()` dialog, or a
   policy engine.
3. **Invoke and verify** — an injected `InvokeStep` runs each approved step.
   The example ships `createInvoke`, which routes each step through
   `invokeContract` and signs the prepared XDR with the connected wallet.
   `invokeContract` polls until the transaction is confirmed, so every returned
   hash is a verified final result.

## Failure cases

- **Missing authorization** — a step's invoking account is not one of its
  required signers. `runAuthorizedWorkflow` returns `INVALID_AUTH` naming the
  step, the method, the required signers, and the invoking account — before any
  network call.
- **Rejected authorization** — the `SignerApproval` callback resolves `err`
  (the user declines the sign prompt). `runAuthorizedWorkflow` returns
  `WALLET_SIGN_REJECTED` for that step, without invoking it.

## Files

| File | Purpose |
| --- | --- |
| `src/authorizedMultiContract.ts` | `describeRequiredAuth`, `runAuthorizedWorkflow`, `createInvoke`, and the `AuthorizedStep` / `RequiredAuth` types — framework-agnostic, no I/O beyond the injected `invoke`. |

## Running the checks

The example is type-checked against the SDK source with its own project file:

```bash
npx tsc --noEmit -p examples/authorized-multi-contract/tsconfig.json
```

Its behaviour is covered by `src/tests/authorized-multi-contract-example.test.ts`,
which runs as part of the normal suite (`npm run test`). The test injects an
`invoke` double, so it exercises the workflow logic — auth surfacing, approval
gating, result verification, and both failure cases — without a network.

## Using it

```ts
import {
  describeRequiredAuth,
  runAuthorizedWorkflow,
  createInvoke,
} from "sorokit-core"; // in your app: from this example's module

const steps = [
  {
    name: "lock",
    params: { contractId: "C_LOCK", method: "lock", publicKey: signerA, args: [/*...*/] },
    metadata: { name: "lock", inputs: [], returnType: null,
      authorizationRequirements: { requiredSigners: [signerA] } },
  },
  {
    name: "mint",
    params: { contractId: "C_MINT", method: "mint", publicKey: signerB, args: [/*...*/] },
    metadata: { name: "mint", inputs: [], returnType: null,
      authorizationRequirements: { requiredSigners: [signerB] } },
  },
];

// 1. Surface what each step requires (render this in the UI before signing).
const auth = describeRequiredAuth(steps);

// 2. Wire the real invoke + a signer-approval prompt.
const invoke = createInvoke({ networkConfig, rpcUrl, horizonUrl, adapter });
const approval = async (a) =>
  window.confirm(`Approve ${a.step} (${a.method}) for ${a.invokingAccount}?`)
    ? ok(undefined)
    : err(WALLET_SIGN_REJECTED, "declined");

// 3. Run the workflow; each confirmed hash verifies the final result.
const result = await runAuthorizedWorkflow(steps, { approval, invoke });
if (result.status === "ok") {
  console.log("confirmed:", result.data.txHashes);
} else {
  console.error(result.error.code, result.error.message); // INVALID_AUTH | WALLET_SIGN_REJECTED | …
}
```
