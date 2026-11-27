/**
 * Authorized multi-contract invocations (#43).
 *
 * Multi-step contract workflows cross authorization boundaries: one step may
 * require signer A to authorize a call that nests into another contract, and
 * the next step may require signer B. This module is the part of the example a
 * consumer keeps: it surfaces the authorization each step requires before any
 * network call, gates each step on explicit signer approval, invokes the
 * steps in order, and verifies the final result by collecting each confirmed
 * transaction hash.
 *
 * The module is framework-agnostic and has no I/O of its own. The actual
 * contract invocation is delegated to an injected `InvokeStep` so the workflow
 * logic (auth surfacing, approval gating, result collection) is unit-testable
 * without a network, while the README shows how to wire the real
 * `invokeContract` + a wallet signing callback.
 *
 * The example lives inside the sorokit-core repository, so it imports the SDK
 * from source. In your own app the imports below become:
 *
 *   import { invokeContract, signTransaction } from "sorokit-core";
 *   import type { ContractInvokeParams, ContractMethod, SorokitResult } from "sorokit-core";
 */

import { err, ok, SorokitErrorCode } from "../../../src/shared/response";
import type { SorokitResult } from "../../../src/shared/response";
import { invokeContract } from "../../../src/soroban/invokeContract";
import type { ContractInvokeParams, ContractMethod } from "../../../src/soroban/types";
import { signTransaction } from "../../../src/wallet/signTransaction";
import type { WalletAdapter } from "../../../src/wallet/types";
import type { ResolvedNetworkConfig } from "../../../src/shared/types";

/**
 * One step of an authorized workflow: the invocation to make plus the contract
 * method metadata that declares who may call it.
 */
export interface AuthorizedStep {
  /** Human-readable label for progress and errors, e.g. "lock tokens". */
  name: string;
  /** Prepared invocation parameters (contractId, method, args, publicKey). */
  params: ContractInvokeParams;
  /** Method metadata carrying `authorizationRequirements.requiredSigners`. */
  metadata: ContractMethod;
}

/**
 * The authorization a single step requires, surfaced *before* invocation so the
 * UI/wallet can present it and the consumer can fail fast on a missing signer.
 */
export interface RequiredAuth {
  step: string;
  contractId: string;
  method: string;
  invokingAccount: string;
  /** Public keys that may authorize this step. Empty when the step is unrestricted. */
  requiredSigners: string[];
  /** `true` when the step is unrestricted or the invoking account is a required signer. */
  authorized: boolean;
}

/**
 * Surface the authorization each step requires, in step order, without any I/O.
 *
 * Use this to render an approval screen ("step 2 of 3 requires signer GXYZ…")
 * before committing the workflow, and to detect a misconfigured signer before
 * the first network call.
 */
export function describeRequiredAuth(
  steps: readonly AuthorizedStep[],
): RequiredAuth[] {
  return steps.map((step) => {
    const requiredSigners =
      step.metadata.authorizationRequirements?.requiredSigners ?? [];
    const authorized =
      requiredSigners.length === 0 ||
      requiredSigners.includes(step.params.publicKey);
    return {
      step: step.name,
      contractId: step.params.contractId,
      method: step.params.method,
      invokingAccount: step.params.publicKey,
      requiredSigners,
      authorized,
    };
  });
}

/**
 * A signer-approval callback. Resolves `ok` to approve the step's authorization
 * (the wallet/user consents to sign), or `err` to reject it. Wire this to a
 * wallet sign-request prompt, a confirm() dialog, or a policy engine.
 */
export type SignerApproval = (auth: RequiredAuth) => Promise<SorokitResult<void>>;

/**
 * Invoke a single step and return its confirmed transaction hash. Inject the
 * real implementation (see {@link createInvoke}) or a test double.
 */
export type InvokeStep = (
  params: ContractInvokeParams,
) => Promise<SorokitResult<string>>;

export type WorkflowStepStatus =
  | "auth-required"
  | "approved"
  | "rejected"
  | "unauthorized"
  | "invoking"
  | "confirmed";

export interface WorkflowProgress {
  step: string;
  status: WorkflowStepStatus;
}

export interface RunAuthorizedWorkflowOptions {
  /** Ask the wallet/user to approve each step's authorization. */
  approval: SignerApproval;
  /** Invoke each approved step (prepare → sign → execute). */
  invoke: InvokeStep;
  /** Optional observer for UI progress. */
  onProgress?: (event: WorkflowProgress) => void;
}

export interface WorkflowResult {
  /** Confirmed transaction hash for each completed step, in order. */
  txHashes: string[];
  /** The authorization surfaced for each step. */
  auth: RequiredAuth[];
}

/**
 * Run an authorized multi-contract workflow.
 *
 * For each step, in order:
 * 1. surface the required authorization (no I/O);
 * 2. fail with `INVALID_AUTH` if the invoking account is not a required signer
 *    (missing authorization — detected before any network call);
 * 3. ask the signer to approve; fail with `WALLET_SIGN_REJECTED` if declined
 *    (rejected authorization — no invocation is made);
 * 4. invoke the step; on success record the confirmed transaction hash, on
 *    failure return the invoke's error (the final result is verified by
 *    `invokeContract`, which polls until the transaction is confirmed).
 *
 * @returns `ok` with the confirmed hashes and surfaced auth, or the first error.
 */
export async function runAuthorizedWorkflow(
  steps: readonly AuthorizedStep[],
  options: RunAuthorizedWorkflowOptions,
): Promise<SorokitResult<WorkflowResult>> {
  const auth = describeRequiredAuth(steps);
  const txHashes: string[] = [];

  for (const [i, step] of steps.entries()) {
    const stepAuth = auth[i];
    if (stepAuth === undefined) {
      // Unreachable for well-formed input; guard for the type checker.
      return err(
        SorokitErrorCode.INTERNAL,
        `Authorized workflow step "${step.name}" is missing surfaced auth metadata.`,
      );
    }
    options.onProgress?.({ step: step.name, status: "auth-required" });

    // Missing authorization: the invoking account is not among the required signers.
    if (!stepAuth.authorized) {
      options.onProgress?.({ step: step.name, status: "unauthorized" });
      return err(
        SorokitErrorCode.INVALID_AUTH,
        `Step "${step.name}" (${step.params.contractId}.${step.params.method}) requires authorization from one of [${stepAuth.requiredSigners.join(
          ", ",
        )}], but the invoking account is ${step.params.publicKey}.`,
        { step: step.name, requiredSigners: stepAuth.requiredSigners },
      );
    }

    // Signer approval: the wallet/user consents to sign this step's authorization.
    const approvalResult = await options.approval(stepAuth);
    if (approvalResult.status === "error") {
      options.onProgress?.({ step: step.name, status: "rejected" });
      return err(
        SorokitErrorCode.WALLET_SIGN_REJECTED,
        `Signer rejected authorization for step "${step.name}".`,
        { step: step.name },
      );
    }
    options.onProgress?.({ step: step.name, status: "approved" });

    // Invoke: prepare → sign → execute. invokeContract polls until the
    // transaction is confirmed, so a returned hash is a verified final result.
    options.onProgress?.({ step: step.name, status: "invoking" });
    const result = await options.invoke(step.params);
    if (result.status === "error") {
      return result;
    }
    txHashes.push(result.data);
    options.onProgress?.({ step: step.name, status: "confirmed" });
  }

  return ok({ txHashes, auth });
}

/**
 * Build the real `InvokeStep` used by {@link runAuthorizedWorkflow}: it routes
 * each step through `invokeContract` and signs the prepared XDR with the
 * connected wallet. A wallet rejection (the user declines the sign prompt)
 * surfaces from `invokeContract` as `WALLET_SIGN_REJECTED`.
 *
 * @example
 * const invoke = createInvoke({ networkConfig, rpcUrl, horizonUrl, adapter });
 * const result = await runAuthorizedWorkflow(steps, { approval, invoke });
 */
export function createInvoke(opts: {
  networkConfig: ResolvedNetworkConfig;
  rpcUrl: string;
  horizonUrl: string;
  adapter: WalletAdapter;
}): InvokeStep {
  return async (params) => {
    return invokeContract(
      opts.rpcUrl,
      opts.networkConfig,
      opts.horizonUrl,
      params,
      async (xdr) => {
        const signed = await signTransaction(opts.adapter, {
          transactionXdr: xdr,
          networkPassphrase: opts.networkConfig.networkPassphrase,
        });
        if (signed.status === "error") {
          throw new Error(signed.error.message);
        }
        return signed.data;
      },
    );
  };
}
