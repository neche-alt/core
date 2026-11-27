# Structured SDK Error Reference & Recovery Guide

`sorokit-core` operations never throw unexpected exceptions. Every public method returns a discriminated union: `SorokitResult<T>`:

```ts
export type SorokitResult<T> =
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: SorokitError };
```

---

## The `SorokitError` Structure

When `result.status === "error"`, the error contains structured data for safe branching and recovery:

```ts
export interface SorokitError {
  /** Stable enum identifier */
  code: SorokitErrorCode;
  /** Human-readable explanation */
  message: string;
  /** Coarse category classification */
  category: SorokitErrorCategory;
  /** Underlying cause or diagnostic data */
  cause?: unknown;
  /** Sanitized operation context */
  context?: SorokitErrorContext;
  /** Actionable recovery advice */
  recovery?: RecoveryGuidance;
  /** Distributed tracing ID */
  traceId?: string;
}
```

---

## The Five Failure Domains

Developers need to distinguish 5 operational failure domains to select the appropriate recovery strategy:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SDK Failure Domains                             │
├──────────────────────────┬─────────────────────────────┬───────────────┤
│ Failure Domain           │ Typical Codes               │ Safe Recovery │
├──────────────────────────┼─────────────────────────────┼───────────────┤
│ 1. Invalid Input         │ VALIDATION, INVALID_CONFIG, │ Do NOT retry. │
│                          │ INVALID_ADDRESS             │ Fix inputs.   │
├──────────────────────────┼─────────────────────────────┼───────────────┤
│ 2. Wallet Rejection      │ WALLET_SIGN_REJECTED,       │ Do NOT retry. │
│                          │ WALLET_NOT_CONNECTED        │ Prompt user.  │
├──────────────────────────┼─────────────────────────────┼───────────────┤
│ 3. Network Failure       │ NETWORK_ERROR, RATE_LIMITED │ Safe to retry │
│                          │ SERVICE_UNAVAILABLE         │ with backoff. │
├──────────────────────────┼─────────────────────────────┼───────────────┤
│ 4. Simulation Failure    │ CONTRACT_SIMULATE_FAILED,   │ Do NOT submit.│
│                          │ SOROBAN_SIMULATION_FAILED   │ Inspect args. │
├──────────────────────────┼─────────────────────────────┼───────────────┤
│ 5. Ledger Execution      │ TX_SUBMIT_FAILED,           │ Bump fee or   │
│                          │ TX_SEQUENCE_CONFLICT        │ refresh seq.  │
└──────────────────────────┴─────────────────────────────┴───────────────┘
```

---

### 1. Invalid Input (`invalid_input`)

* **Stable Type Names**: `SorokitErrorCategory.VALIDATION`, `SorokitErrorCode.VALIDATION`, `SorokitErrorCode.INVALID_CONFIG`, `SorokitErrorCode.INVALID_ADDRESS`, `SorokitErrorCode.XDR_INVALID`, `SorokitErrorCode.MAINNET_SAFETY_LIMIT`.
* **Causes**: Client-side validation failed before contacting the network (e.g. malformed public key, missing endpoint URL, negative amount, invalid WASM header).
* **Safe Recovery Suggestion**: **Non-retryable**. Do not automatically resubmit identical parameters. Inspect `error.message` and `error.cause`, prompt the user to correct the input field, and revalidate.

**Example**:
```ts
import { isInvalidInputError } from "sorokit-core";

if (result.status === "error" && isInvalidInputError(result.error)) {
  console.warn("Input error detected:", result.error.message);
  showUserValidationMessage(result.error.message);
}
```

---

### 2. Wallet Rejection (`wallet_rejection`)

* **Stable Type Names**: `SorokitErrorCategory.WALLET`, `SorokitErrorCode.WALLET_SIGN_REJECTED`, `SorokitErrorCode.WALLET_NOT_CONNECTED`, `SorokitErrorCode.WALLET_CONNECT_FAILED`.
* **Causes**: User actively declined to sign in their browser extension (e.g. Freighter, Lobstr), dismissed the modal, or the wallet was locked/disconnected.
* **Safe Recovery Suggestion**: **Non-retryable**. Do not trigger another signature prompt in a loop. Display a clear notification that the signature request was canceled and let the user initiate the action again when ready.

**Example**:
```ts
import { isWalletRejectionError } from "sorokit-core";

if (result.status === "error" && isWalletRejectionError(result.error)) {
  console.log("Transaction signing was cancelled by user.");
  toast.info("Transaction signing was cancelled. Click 'Submit' when ready to sign.");
}
```

---

### 3. Network Failure (`network_failure`)

* **Stable Type Names**: `SorokitErrorCategory.NETWORK`, `SorokitErrorCategory.TIMEOUT`, `SorokitErrorCode.NETWORK_ERROR`, `SorokitErrorCode.SERVICE_UNAVAILABLE`, `SorokitErrorCode.RATE_LIMITED`, `SorokitErrorCode.OPERATION_TIMEOUT`.
* **Causes**: Transport-level failure, DNS resolution error, RPC/Horizon server offline, HTTP 429 rate limit, or operation timeout.
* **Safe Recovery Suggestion**: **Retryable with backoff**. Check network connectivity. For `RATE_LIMITED` or `SERVICE_UNAVAILABLE`, wait with exponential backoff and jitter before retrying.

**Example**:
```ts
import { isNetworkFailureError } from "sorokit-core";

if (result.status === "error" && isNetworkFailureError(result.error)) {
  console.warn("Network error encountered:", result.error.message);
  await delay(1000 * Math.pow(2, attempt));
  return retryOperation();
}
```

---

### 4. Simulation Failure (`simulation_failure`)

* **Stable Type Names**: `SorokitErrorCategory.CONTRACT`, `SorokitErrorCode.CONTRACT_SIMULATE_FAILED`, `SorokitErrorCode.SOROBAN_SIMULATION_FAILED`, `SorokitErrorCode.TX_SIMULATE_FAILED`, `SorokitErrorCode.CONTRACT_READ_FAILED`.
* **Causes**: Soroban smart contract host execution reverted during simulation (e.g., panics, failed assertions, unauthorized invoker, resource limit exceeded).
* **Safe Recovery Suggestion**: **Do NOT submit to ledger**. Submitting a transaction that fails simulation will waste transaction fees. Inspect the simulation diagnostic logs or return value in `result.error.cause`, fix contract parameters or preconditions, and re-simulate.

**Example**:
```ts
import { isSimulationFailureError } from "sorokit-core";

if (result.status === "error" && isSimulationFailureError(result.error)) {
  console.error("Contract simulation failed, aborting submission:", result.error.message);
  console.debug("Simulation diagnostic details:", result.error.cause);
}
```

---

### 5. Ledger Execution Failure (`ledger_execution_failure`)

* **Stable Type Names**: `SorokitErrorCategory.TRANSACTION`, `SorokitErrorCode.TX_SUBMIT_FAILED`, `SorokitErrorCode.TX_SEQUENCE_CONFLICT`, `SorokitErrorCode.INSUFFICIENT_FEE`.
* **Causes**: Transaction was simulated successfully but failed on-chain consensus (e.g. `txBAD_SEQ` sequence number out of order due to concurrent transaction, fee surged due to ledger congestion, or transaction expired).
* **Safe Recovery Suggestion**: **Conditional recovery**. For sequence number conflicts, refresh the source account's sequence number from Horizon, rebuild the transaction, re-simulate, re-sign, and submit. For fee errors, estimate a higher fee using `client.transaction.estimateFee`.

**Example**:
```ts
import { isLedgerExecutionError, SorokitErrorCode } from "sorokit-core";

if (result.status === "error" && isLedgerExecutionError(result.error)) {
  if (result.error.code === SorokitErrorCode.TX_SEQUENCE_CONFLICT) {
    console.log("Sequence number conflict detected; refreshing account sequence...");
    await refreshAccountSequence();
    return rebuildAndResubmit();
  }
}
```

---

## Unified Error Dispatching

The helper `classifyErrorDomain` classifies any `SorokitError` into one of the five failure domains:

```ts
import { classifyErrorDomain } from "sorokit-core";

const domain = classifyErrorDomain(result.error);
switch (domain) {
  case "invalid_input":
    showValidationError(result.error.message);
    break;
  case "wallet_rejection":
    showUserCancelledNotice();
    break;
  case "network_failure":
    scheduleRetryWithBackoff();
    break;
  case "simulation_failure":
    logContractRevert(result.error);
    break;
  case "ledger_execution_failure":
    handleSequenceOrFeeConflict(result.error);
    break;
  default:
    console.error("Unknown error:", result.error);
}
```
