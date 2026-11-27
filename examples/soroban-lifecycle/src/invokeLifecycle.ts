/**
 * Soroban simulation-to-submission walkthrough (#37).
 *
 * This module walks through the full Soroban contract invocation lifecycle:
 *
 *   1. (Optional) Standalone fee estimation via simulateTransaction
 *   2. prepareContractCall  — build, simulate, and assemble the transaction XDR
 *   3. signFn               — caller-supplied signing function (wallet-agnostic)
 *   4. executeContract      — submit to the RPC node and poll until confirmed
 *
 * Key distinction
 * ───────────────
 * Simulation (steps 1–2) is a *pre-flight* operation. It consumes no gas,
 * makes no ledger changes, and can be retried freely. The result is an
 * assembled XDR with an attached fee and resource footprint.
 *
 * Submission (step 4) writes to the ledger. The returned transaction hash is
 * the proof of on-chain execution. Never treat a simulation result as
 * confirmation — always wait for the hash from executeContract.
 *
 * In your own app the SDK imports below become:
 *   import { prepareContractCall, executeContract, simulateTransaction } from "sorokit-core";
 */

import { prepareContractCall } from "../../../src/soroban/prepareCall";
import { executeContract } from "../../../src/soroban/executeContract";
import { simulateTransaction } from "../../../src/soroban/simulateTransaction";
import type {
  ContractInvokeParams,
  PreparedContractCall,
  SorobanPollConfig,
  SimulateTransactionResult,
} from "../../../src/soroban/types";
import type { ResolvedNetworkConfig } from "../../../src/shared/types";
import { ok, err, SorokitErrorCode } from "../../../src/shared/response";
import type { SorokitResult } from "../../../src/shared/response";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LifecycleInput {
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  params: ContractInvokeParams;
  /** Async function that receives assembled XDR and returns signed XDR. */
  signFn: (xdr: string) => Promise<string>;
  /** Optional overrides for the RPC polling loop. */
  pollConfig?: SorobanPollConfig;
}

export interface LifecycleResult {
  /** Confirmed on-chain transaction hash. */
  txHash: string;
  /** Details of the prepared call before signing. */
  prepared: PreparedContractCall;
}

// ── Step 1: Standalone fee estimation ────────────────────────────────────────

/**
 * Estimate the resource fee for an XDR before committing to signing.
 *
 * This calls the Soroban RPC simulate endpoint in isolation — no ledger
 * changes occur. Use it to show users an estimated fee before they approve
 * the transaction in their wallet.
 *
 * Returns the estimated fee in stroops, or an error result if simulation fails.
 *
 * ```ts
 * const feeResult = await estimateFeeBeforeInvoke(rpcUrl, passphrase, xdr);
 * if (feeResult.status === "ok") {
 *   console.log("Estimated fee:", feeResult.data.fee, "stroops");
 * }
 * ```
 */
export async function estimateFeeBeforeInvoke(
  rpcUrl: string,
  networkPassphrase: string,
  transactionXdr: string,
): Promise<SorokitResult<SimulateTransactionResult>> {
  const result = await simulateTransaction(rpcUrl, networkPassphrase, transactionXdr);

  if (result.status === "error") {
    return result;
  }

  // A simulation can succeed at the RPC level but report a contract-level
  // failure. Surface that as an SDK error so callers have a uniform interface.
  if (!result.data.success) {
    return err(
      SorokitErrorCode.TX_SIMULATE_FAILED,
      `Pre-flight simulation reported a contract error: ${result.data.error ?? "unknown"}`,
      result.data,
    );
  }

  return result;
}

// ── Steps 2–4: Full lifecycle ─────────────────────────────────────────────────

/**
 * Run the full Soroban invocation lifecycle: prepare → sign → execute.
 *
 * Recovery branches are handled per step:
 *
 * - **Prepare failure** (`CONTRACT_PREPARE_FAILED`): the contract ID, method,
 *   or arguments were invalid, or the RPC simulation returned an error.
 *   Fix the input and retry — no ledger state has changed.
 *
 * - **Sign failure** (`WALLET_SIGN_FAILED`): the sign function threw or
 *   returned an empty string. No transaction was submitted.
 *
 * - **Execute failure** (`CONTRACT_INVOKE_FAILED`): the transaction was
 *   submitted but failed on-chain, the RPC node was unreachable, or polling
 *   timed out. Check the error code:
 *     - `SERVICE_UNAVAILABLE` / network error → retry after back-off.
 *     - `OPERATION_TIMEOUT` → check whether the tx was already included
 *       before retrying (use the horizon endpoint to query by hash).
 *     - Any other code → the transaction itself was rejected; fix the
 *       contract inputs before retrying.
 *
 * Returns `ok({ txHash, prepared })` on success. The `txHash` is the
 * on-chain confirmed identifier — it proves ledger inclusion.
 */
export async function runLifecycle(
  input: LifecycleInput,
): Promise<SorokitResult<LifecycleResult>> {
  const networkConfig: ResolvedNetworkConfig = {
    network: input.params.publicKey ? "testnet" : "testnet", // resolved externally
    networkPassphrase: input.networkPassphrase,
    horizonUrl: input.horizonUrl,
    rpcUrl: input.rpcUrl,
  };

  // ── Step 2: Prepare ────────────────────────────────────────────────────────
  //
  // prepareContractCall builds the transaction, runs a simulation against the
  // RPC node to calculate resource limits and fees, then assembles the final
  // XDR with auth entries and the resource footprint attached.
  //
  // This is *simulation only* — no ledger change happens here.

  const prepared = await prepareContractCall(
    input.rpcUrl,
    networkConfig,
    input.horizonUrl,
    input.params,
  );

  if (prepared.status === "error") {
    // Surface the prepare error directly — it carries the error code and a
    // human-readable message describing whether the problem was a bad contract
    // ID, a failed simulation, or a network issue.
    return prepared;
  }

  // At this point `prepared.data` contains:
  //   - transactionXdr: the fully assembled XDR string, ready for signing
  //   - fee: estimated fee in stroops (string)
  //
  // You can inspect these before proceeding to signing, e.g. to show the user
  // an approval dialog with the estimated fee.

  // ── Step 3: Sign ──────────────────────────────────────────────────────────
  //
  // The sign function is caller-supplied and wallet-agnostic. It receives the
  // assembled XDR and returns a signed XDR string. This keeps the lifecycle
  // helper framework-agnostic — pass a Freighter callback, a hardware wallet
  // adapter, or signTransactionOffline for server-side signing.

  let signedXdr: string;
  try {
    signedXdr = await input.signFn(prepared.data.transactionXdr);
  } catch (cause) {
    return err(
      SorokitErrorCode.WALLET_SIGN_FAILED,
      `Signing failed during contract invocation: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  if (typeof signedXdr !== "string" || signedXdr.trim().length === 0) {
    return err(
      SorokitErrorCode.WALLET_SIGN_FAILED,
      "signFn returned an empty or invalid XDR string.",
    );
  }

  // ── Step 4: Execute ────────────────────────────────────────────────────────
  //
  // executeContract submits the signed XDR to the RPC node and polls until the
  // transaction reaches a terminal state (SUCCESS or FAILED) or the poll
  // budget is exhausted.
  //
  // The returned hash is the on-chain transaction identifier — it proves the
  // transaction was included in a ledger. This is what distinguishes confirmed
  // execution from simulation.

  const executed = await executeContract(
    input.rpcUrl,
    networkConfig,
    signedXdr,
    input.pollConfig,
  );

  if (executed.status === "error") {
    return executed;
  }

  return ok({
    txHash: executed.data,
    prepared: prepared.data,
  });
}

// ── Example entry point ───────────────────────────────────────────────────────

/* istanbul ignore next */
async function main() {
  const rpcUrl = process.env["RPC_URL"] ?? "https://soroban-testnet.stellar.org";
  const horizonUrl =
    process.env["HORIZON_URL"] ?? "https://horizon-testnet.stellar.org";
  const networkPassphrase =
    process.env["NETWORK_PASSPHRASE"] ?? "Test SDF Network ; September 2015";
  const contractId = process.env["CONTRACT_ID"] ?? "";
  const publicKey = process.env["SOURCE_PUBLIC_KEY"] ?? "";

  if (!contractId || !publicKey) {
    console.error("Set CONTRACT_ID and SOURCE_PUBLIC_KEY environment variables.");
    process.exit(1);
  }

  // 1. Estimate fee for a known XDR before asking the user to sign (optional).
  //    Here we skip this step because we don't have a pre-built XDR yet.

  // 2–4. Full lifecycle with a placeholder sign function.
  //      Replace the sign function with your wallet adapter.
  const result = await runLifecycle({
    rpcUrl,
    networkPassphrase,
    horizonUrl,
    params: {
      contractId,
      method: "hello",
      args: [],
      publicKey,
    },
    signFn: async (xdr) => {
      // Replace with: return freighter.signTransaction(xdr, { networkPassphrase });
      // or:           return signTransactionOffline(xdr, secretKey, networkPassphrase).data;
      console.log("Would sign XDR:", xdr.slice(0, 40), "…");
      return xdr; // placeholder — unsigned XDR will fail on-chain
    },
  });

  if (result.status === "error") {
    console.error(`[${result.error.code}] ${result.error.message}`);
    process.exit(1);
  }

  console.log("Confirmed tx hash:", result.data.txHash);
  console.log("Estimated fee used:", result.data.prepared.fee, "stroops");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
