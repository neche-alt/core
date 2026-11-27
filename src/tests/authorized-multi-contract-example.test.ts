/**
 * Authorized multi-contract invocation example (#43).
 *
 * Verifies the example under examples/authorized-multi-contract the way a
 * consumer would use it: it surfaces the authorization each step requires
 * before any network call, gates each step on signer approval, verifies the
 * final result by collecting confirmed hashes, and fails fast for missing and
 * rejected authorization. The real `invokeContract` is replaced by an injected
 * double, so the workflow logic is tested without a network.
 */
import { describe, expect, it, vi } from "vitest";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import type { ContractInvokeParams, ContractMethod } from "../soroban/types";
import {
  describeRequiredAuth,
  runAuthorizedWorkflow,
  type AuthorizedStep,
  type InvokeStep,
  type RequiredAuth,
  type SignerApproval,
} from "../../examples/authorized-multi-contract/src/authorizedMultiContract";

const SIGNER_A = "GBUILTIN_SIGNER_A";
const SIGNER_B = "GBUILTIN_SIGNER_B";
const OUTSIDER = "GBUILTIN_OUTSIDER";

function step(
  name: string,
  contractId: string,
  method: string,
  publicKey: string,
  requiredSigners: string[] | undefined,
): AuthorizedStep {
  const metadata: ContractMethod = {
    name: method,
    inputs: [],
    returnType: null,
    ...(requiredSigners !== undefined
      ? { authorizationRequirements: { requiredSigners } }
      : {}),
  };
  const params: ContractInvokeParams = { contractId, method, publicKey };
  return { name, params, metadata };
}

describe("describeRequiredAuth (#43)", () => {
  it("surfaces required signers and whether the invoking account is authorized", () => {
    const auth = describeRequiredAuth([
      step("lock", "C1", "lock", SIGNER_A, [SIGNER_A, SIGNER_B]),
      step("mint", "C2", "mint", OUTSIDER, [SIGNER_A]),
      step("read", "C3", "read", SIGNER_A, undefined),
    ]);

    expect(auth).toEqual<RequiredAuth[]>([
      {
        step: "lock",
        contractId: "C1",
        method: "lock",
        invokingAccount: SIGNER_A,
        requiredSigners: [SIGNER_A, SIGNER_B],
        authorized: true,
      },
      {
        step: "mint",
        contractId: "C2",
        method: "mint",
        invokingAccount: OUTSIDER,
        requiredSigners: [SIGNER_A],
        authorized: false,
      },
      {
        step: "read",
        contractId: "C3",
        method: "read",
        invokingAccount: SIGNER_A,
        requiredSigners: [],
        authorized: true,
      },
    ]);
  });
});

function approveAll(): SignerApproval {
  return async () => ok(undefined);
}

function invokeOk(): InvokeStep {
  return vi.fn(async (params: ContractInvokeParams) =>
    ok(`${params.contractId}-${params.method}-hash`),
  );
}

describe("runAuthorizedWorkflow (#43)", () => {
  it("runs every step when authorized and approved, collecting confirmed hashes", async () => {
    const invoke = invokeOk();
    const progress: string[] = [];
    const result = await runAuthorizedWorkflow(
      [
        step("lock", "C1", "lock", SIGNER_A, [SIGNER_A]),
        step("mint", "C2", "mint", SIGNER_A, [SIGNER_A]),
      ],
      {
        approval: approveAll(),
        invoke,
        onProgress: (e) => progress.push(`${e.step}:${e.status}`),
      },
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.txHashes).toEqual(["C1-lock-hash", "C2-mint-hash"]);
    }
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([
      "lock:auth-required",
      "lock:approved",
      "lock:invoking",
      "lock:confirmed",
      "mint:auth-required",
      "mint:approved",
      "mint:invoking",
      "mint:confirmed",
    ]);
  });

  it("fails with INVALID_AUTH when an invoking account is not a required signer, before invoking", async () => {
    const invoke = invokeOk();
    const result = await runAuthorizedWorkflow(
      [step("mint", "C2", "mint", OUTSIDER, [SIGNER_A])],
      { approval: approveAll(), invoke },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.INVALID_AUTH);
      expect(result.error.message).toContain("requires authorization");
      expect(result.error.message).toContain(OUTSIDER);
    }
    // Missing authorization must short-circuit before any network call.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails with WALLET_SIGN_REJECTED when the signer declines approval, before invoking", async () => {
    const invoke = invokeOk();
    const reject: SignerApproval = async () =>
      err(SorokitErrorCode.WALLET_SIGN_REJECTED, "user declined");

    const result = await runAuthorizedWorkflow(
      [step("lock", "C1", "lock", SIGNER_A, [SIGNER_A])],
      { approval: reject, invoke },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
    }
    // Rejected authorization must short-circuit before any network call.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the invoke error when a step fails to confirm (final result verification)", async () => {
    const invoke: InvokeStep = vi.fn(async () =>
      err(SorokitErrorCode.CONTRACT_INVOKE_FAILED, "on-chain failure"),
    );

    const result = await runAuthorizedWorkflow(
      [step("lock", "C1", "lock", SIGNER_A, [SIGNER_A])],
      { approval: approveAll(), invoke },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.CONTRACT_INVOKE_FAILED);
    }
  });

  it("stops at the first failing step in a multi-step workflow", async () => {
    let calls = 0;
    const invoke: InvokeStep = vi.fn(async (params: ContractInvokeParams) => {
      calls += 1;
      if (calls === 1) return ok(`${params.contractId}-${params.method}-hash`);
      return err(SorokitErrorCode.WALLET_SIGN_REJECTED, "second step rejected");
    });
    // Reject approval only for the second step.
    const approval: SignerApproval = async (auth) =>
      auth.step === "mint"
        ? err(SorokitErrorCode.WALLET_SIGN_REJECTED, "declined")
        : ok(undefined);

    const result = await runAuthorizedWorkflow(
      [
        step("lock", "C1", "lock", SIGNER_A, [SIGNER_A]),
        step("mint", "C2", "mint", SIGNER_A, [SIGNER_A]),
      ],
      { approval, invoke },
    );

    // First step confirmed, second rejected before it is invoked.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.WALLET_SIGN_REJECTED);
    }
  });
});
