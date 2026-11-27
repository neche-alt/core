# Contract Spec Compatibility

Generated contract clients can drift when a deployed contract's spec changes.
`sorokit-core` provides `compareContractSpecs` and `validateContractSpec` to
detect drift before it causes runtime errors.

## Concepts

A **contract spec** is the set of function signatures a deployed contract
exposes. When a contract is upgraded, functions may be added, removed, or
modified. Clients generated against the old spec may break silently if the
change is not caught ahead of time.

The `ContractSpec` type in this module is a framework-agnostic, in-memory
representation — it does not require a live RPC connection and works equally
in scripts, CI pipelines, and runtime checks.

## Comparing specs across versions

```ts
import { compareContractSpecs } from "sorokit-core/soroban";
import type { ContractSpec } from "sorokit-core/soroban";

// What your client was generated against
const baseline: ContractSpec = {
  contractId: "CABC...",
  functions: [
    { name: "transfer", params: ["address", "u128"], returns: "void" },
    { name: "balance",  params: ["address"],         returns: "u128" },
  ],
};

// Freshly fetched from the network / contract metadata
const candidate: ContractSpec = {
  contractId: "CABC...",
  functions: [
    { name: "transfer", params: ["address", "u128"], returns: "void" },
    { name: "balance",  params: ["address"],         returns: "u128" },
    { name: "approve",  params: ["address", "u128"], returns: "void" },
  ],
};

const report = compareContractSpecs(baseline, candidate);

switch (report.status) {
  case "identical":
    console.log("Spec unchanged — client is current.");
    break;
  case "compatible":
    console.warn("Non-breaking additions:", report.warnings);
    // Safe to continue; consider regenerating the client to expose new methods.
    break;
  case "incompatible":
    console.error("Breaking changes detected:", report.errors);
    // Regenerate the client and update call sites before deploying.
    break;
  case "unknown":
    console.error("Could not determine compatibility:", report.errors);
    // Re-fetch the spec and retry, or inspect the raw spec objects.
    break;
}
```

## Compatibility rules

| Change | `status` |
|---|---|
| No change | `identical` |
| Function(s) added only | `compatible` |
| Function removed | `incompatible` |
| Parameter types changed | `incompatible` |
| Return type changed | `incompatible` |
| Malformed input | `unknown` |

`compareContractSpecs` never throws. Malformed or missing input returns
`status: "unknown"` with a descriptive error message so callers can handle it
without wrapping in try/catch.

## Validating a spec before use

```ts
import { validateContractSpec } from "sorokit-core/soroban";

const result = validateContractSpec(rawSpec);
if (result.status === "error") {
  console.error("Invalid spec:", result.error.message);
} else {
  const spec = result.data; // typed as ContractSpec — safe to pass to compareContractSpecs
}
```

`validateContractSpec` checks:
- Input is a non-null object
- `functions` is an array
- Every function has a non-empty string `name`, a `params` array, and a string `returns`
- No duplicate function names

## Failure behavior for incompatible inputs

`compareContractSpecs` returns `status: "unknown"` — not an exception — when
either input is `null`, missing a `functions` array, or otherwise malformed.
Treat `unknown` as a signal to re-fetch the spec rather than aborting the
entire operation.

`validateContractSpec` returns a `SorokitResult` error for all structural
issues so the caller stays in the SDK's no-throw result model.

## TypeScript types

```ts
import type {
  ContractSpec,
  ContractSpecFunction,
  SpecCompatibilityReport,
  SpecCompatibilityChange,
  SpecCompatibilityStatus,
} from "sorokit-core/soroban";
```
