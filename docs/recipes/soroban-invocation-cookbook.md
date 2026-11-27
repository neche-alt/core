# Soroban Smart Contract Invocation Cookbook

A comprehensive, production-ready recipe for reading, simulating, authorizing, and submitting Soroban contract invocations using `sorokit-core`.

---

## Overview

Soroban smart contracts on Stellar have two primary interaction paradigms:

1. **Read-Only Invocations (`client.soroban.read`)**:
   - Query contract state or execute read-only view methods.
   - Do **not** require transaction signing, wallet approvals, or network transaction fees.
   - Run purely through Soroban RPC simulation.

2. **State-Changing Write Invocations (`client.soroban.invoke` or `prepare` â†’ `sign` â†’ `execute`)**:
   - Modify on-chain state, transfer tokens, or trigger side effects.
   - Require fee estimation, simulation preflight, cryptographic signatures from connected wallets or signers, and on-chain submission with ledger polling.

Every method returns a typed `SorokitResult<T>` with structured error handling â€” avoiding thrown exceptions.

---

## 1. Typed Argument Handling (`ScVal`)

Soroban methods require parameters encoded as Soroban `xdr.ScVal` values. Convert TypeScript primitives safely using `@stellar/stellar-sdk` and `sorokit-core`:

```ts
import { xdr, Address, nativeToScVal } from "@stellar/stellar-sdk";

// 1. Numbers (u32, i32, u64, i64, u128, i128)
const u32Val = nativeToScVal(42, { type: "u32" });
const i128Amount = nativeToScVal(BigInt("10000000"), { type: "i128" });

// 2. Boolean
const boolVal = nativeToScVal(true, { type: "bool" });

// 3. String & Symbol
const stringVal = nativeToScVal("my-string-data", { type: "string" });
const symbolVal = xdr.ScVal.scvSymbol("transfer");

// 4. Stellar Addresses (Account G... or Contract C...)
const accountAddress = new xdr.ScVal.scvAddress(
  Address.fromString("GABCD123456789012345678901234567890123456789012345678901234").toScAddress()
);
const contractAddress = new xdr.ScVal.scvAddress(
  Address.fromString("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").toScAddress()
);

// 5. Vectors / Arrays
const vecVal = nativeToScVal(["tokenA", "tokenB"], { type: "vec" });

// 6. Maps / Key-Value Structs
const mapVal = nativeToScVal(
  {
    owner: Address.fromString("GABCD..."),
    nonce: 1n,
  },
  { type: "map" }
);
```

---

## 2. Recipe: Read-Only Contract Invocation

Read contract state without prompting user wallets or paying gas fees:

```ts
import { createSorokitClient } from "sorokit-core";
import { Address, xdr } from "@stellar/stellar-sdk";

async function queryTokenBalance(contractId: string, accountPublicKey: string) {
  // 1. Initialize SDK client
  const clientRes = createSorokitClient({ network: "testnet" });
  if (clientRes.status === "error") {
    throw new Error(`Client init failed: ${clientRes.error.message}`);
  }
  const client = clientRes.data;

  // 2. Convert arguments to ScVal
  const addressScVal = new xdr.ScVal.scvAddress(
    Address.fromString(accountPublicKey).toScAddress()
  );

  // 3. Call read method
  const readRes = await client.soroban.read({
    contractId,
    method: "balance",
    args: [addressScVal],
  });

  if (readRes.status === "error") {
    console.error("Read invocation failed:", readRes.error.code, readRes.error.message);
    return null;
  }

  // 4. Access the parsed or raw result
  console.log("Contract returned:", readRes.data.result);
  return readRes.data.result;
}
```

---

## 3. Recipe: Write Invocation (One-Step Pipeline)

For standard application flows, `client.soroban.invoke` handles building, simulating, sign-callback triggering, and ledger settlement:

```ts
import { createSorokitClient, FreighterAdapter } from "sorokit-core";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

async function transferTokens(
  contractId: string,
  swkInstance: any,
  destinationPublicKey: string,
  amount: bigint
) {
  const clientRes = createSorokitClient({ network: "testnet" });
  if (clientRes.status === "error") throw new Error(clientRes.error.message);
  const client = clientRes.data;

  // 1. Connect wallet adapter
  const adapter = new FreighterAdapter(swkInstance);
  const connRes = await client.wallet.connect(adapter);
  if (connRes.status === "error") throw new Error(connRes.error.message);
  const senderPublicKey = connRes.data.publicKey;

  // 2. Invoke contract method
  const invokeRes = await client.soroban.invoke(
    {
      contractId,
      method: "transfer",
      sourcePublicKey: senderPublicKey,
      args: [
        new xdr.ScVal.scvAddress(Address.fromString(senderPublicKey).toScAddress()),
        new xdr.ScVal.scvAddress(Address.fromString(destinationPublicKey).toScAddress()),
        nativeToScVal(amount, { type: "i128" }),
      ],
    },
    // Wallet sign callback
    async (unsignedXdr) => {
      const signRes = await client.wallet.signTransaction(adapter, {
        transactionXdr: unsignedXdr,
        networkPassphrase: client.networkConfig.networkPassphrase,
      });
      if (signRes.status === "error") {
        throw new Error(signRes.error.message);
      }
      return signRes.data;
    }
  );

  if (invokeRes.status === "error") {
    handleInvocationError(invokeRes.error);
    return null;
  }

  console.log("Transaction confirmed on ledger! Hash:", invokeRes.data);
  return invokeRes.data;
}
```

---

## 4. Recipe: Write Invocation (Three-Step Pipeline with Auth & Simulation Inspection)

When full control over simulation preflight, authorization entries, and intermediate fees is required:

```ts
import { createSorokitClient, FreighterAdapter } from "sorokit-core";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

async function advancedContractCall(
  contractId: string,
  swkInstance: any,
  method: string,
  args: xdr.ScVal[]
) {
  const clientRes = createSorokitClient({ network: "testnet" });
  if (clientRes.status === "error") throw new Error(clientRes.error.message);
  const client = clientRes.data;

  const adapter = new FreighterAdapter(swkInstance);
  const conn = await client.wallet.connect(adapter);
  if (conn.status === "error") throw new Error(conn.error.message);
  const publicKey = conn.data.publicKey;

  // STEP 1: Prepare transaction XDR
  const prepRes = await client.soroban.prepare({
    contractId,
    method,
    publicKey,
    args,
  });

  if (prepRes.status === "error") {
    console.error("Preparation failed:", prepRes.error.code, prepRes.error.message);
    return;
  }

  const { transactionXdr, fee } = prepRes.data;
  console.log("Estimated Fee (stroops):", fee);

  // STEP 2: Simulate and inspect authorization entries
  const simRes = await client.soroban.simulate(transactionXdr);
  if (simRes.status === "error") {
    console.error("Simulation failed:", simRes.error.message);
    return;
  }

  // Inspect auth entries required by the contract
  const authEntries = simRes.data.auth ?? [];
  console.log(`Simulation verified. Requires ${authEntries.length} auth entries.`);

  // STEP 3: Sign transaction via wallet
  const signRes = await client.wallet.signTransaction(adapter, {
    transactionXdr,
    networkPassphrase: client.networkConfig.networkPassphrase,
  });

  if (signRes.status === "error") {
    console.error("Signing rejected:", signRes.error.message);
    return;
  }

  // STEP 4: Execute on ledger
  const execRes = await client.soroban.execute(signRes.data);
  if (execRes.status === "error") {
    console.error("Execution failed:", execRes.error.code, execRes.error.message);
    return;
  }

  console.log("Confirmed Transaction Hash:", execRes.data);
}
```

---

## 5. Failure Interpretation and Error Recovery

Soroban contract failures fall into specific failure domains. Use this mapping to guide user feedback:

| Error Code / Symptom | Root Cause | Recovery Action |
|----------------------|------------|-----------------|
| `CONTRACT_NOT_FOUND` | Contract address does not exist or instance has expired/archived. | Verify contract address and network; check contract TTL or restore footprint. |
| `SIMULATION_FAILED` | Contract logic aborted (e.g. `panic`, `require`, or custom contract error enum). | Inspect `error.message` / `error.cause`. Fix method arguments or prerequisites. |
| `SIGNATURE_REJECTED` | User dismissed wallet popup or declined approval. | Provide clear retry UI without resetting form inputs. |
| `TX_SUBMIT_FAILED` with `tx_bad_seq` | Account sequence number changed since simulation. | Rebuild and resimulate transaction with current account sequence. |
| `TX_SUBMIT_FAILED` with `op_underfunded` | Source account does not have sufficient XLM balance for base and resource fees. | Prompt user to fund account. |
| `TIMEOUT` | RPC status poll exceeded timeout limit. | Transaction may still settle. Query transaction hash before resubmitting to prevent duplicates. |

### Failure Handler Helper

```ts
import type { SorokitError } from "sorokit-core";

export function interpretContractFailure(error: SorokitError): string {
  switch (error.code) {
    case "CONTRACT_NOT_FOUND":
      return "The target contract does not exist on this network or instance storage has expired.";
    case "SIMULATION_FAILED":
    case "CONTRACT_INVOKE_FAILED":
      return `Contract simulation failed: ${error.message}. Please check your balance, allowances, or input parameters.`;
    case "TX_SUBMIT_FAILED":
      if (error.message.includes("tx_bad_seq")) {
        return "Transaction sequence conflict. Please resubmit to use the latest sequence number.";
      }
      return `Transaction submission rejected: ${error.message}`;
    case "WALLET_SIGN_FAILED":
      return "Wallet rejected the signature request or connection timed out.";
    case "NETWORK_ERROR":
    case "TIMEOUT":
      return "Network latency or timeout. Check transaction status before retrying to prevent double submission.";
    default:
      return `Unexpected error (${error.code}): ${error.message}`;
  }
}
```

---

## Summary

- Use **`client.soroban.read`** for zero-cost state inspection.
- Use **`client.soroban.invoke`** for end-to-end write transactions with wallet signing.
- Use **`prepare` â†’ `simulate` â†’ `sign` â†’ `execute`** when inspecting auth entries or fees prior to signing.
- Always encode typed arguments with `@stellar/stellar-sdk`'s `nativeToScVal` and `Address`.
- Handle failure domains gracefully using structured `SorokitError` codes.
