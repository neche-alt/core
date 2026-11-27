import { describe, it, expect } from "vitest";
import {
  inspectAuthEntry,
  diagnoseAuthorizationFailure,
} from "./authEntryInspector";

describe("inspectAuthEntry", () => {
  it("returns empty arrays for null input", () => {
    const result = inspectAuthEntry(null);
    expect(result.credentials).toEqual([]);
    expect(result.nestedInvocations).toEqual([]);
    expect(result.missingCredentials).toEqual([]);
    expect(result.raw).toBeNull();
  });

  it("returns empty arrays for undefined input", () => {
    const result = inspectAuthEntry(undefined);
    expect(result.credentials).toEqual([]);
    expect(result.nestedInvocations).toEqual([]);
  });

  it("returns empty arrays for a plain empty object", () => {
    const result = inspectAuthEntry({});
    expect(result.credentials).toEqual([]);
    expect(result.nestedInvocations).toEqual([]);
  });

  it("returns empty arrays for a non-object input", () => {
    const result = inspectAuthEntry("not-an-entry");
    expect(result.credentials).toEqual([]);
    expect(result.nestedInvocations).toEqual([]);
  });

  it("preserves the raw input in the result", () => {
    const raw = { some: "object" };
    const result = inspectAuthEntry(raw);
    expect(result.raw).toBe(raw);
  });

  it("extracts credential from a duck-typed auth entry", () => {
    const contractIdBytes = Buffer.from("aaaabbbbccccdddd", "hex");
    const entry = {
      credentials: {
        type: () => ({ name: "scCredentialsSoroban" }),
        sorobanCredentials: () => ({
          nonce: () => "42",
          signatureExpirationLedger: () => 1000,
        }),
      },
      rootInvocation: {
        contractAddress: {
          contractId: () => contractIdBytes,
        },
        functionName: "transfer",
        args: () => ["GABC", 100],
        subInvocations: () => [],
      },
    };

    const result = inspectAuthEntry(entry);
    expect(result.credentials).toHaveLength(1);
    const cred = result.credentials[0]!;
    expect(cred.functionName).toBe("transfer");
    expect(cred.contractId).toBe(contractIdBytes.toString("hex"));
    expect(cred.nonce).toBe(42n);
    expect(cred.expirationLedger).toBe(1000);
    expect(cred.credentialType).toBe("scCredentialsSoroban");
    expect(result.nestedInvocations).toHaveLength(0);
  });

  it("collects nested sub-invocations", () => {
    const contractIdBytes = Buffer.from("aaaabbbbccccdddd", "hex");
    const entry = {
      credentials: {
        type: () => ({ name: "scCredentialsSourceAccount" }),
      },
      rootInvocation: {
        contractAddress: { contractId: () => contractIdBytes },
        functionName: "outer",
        args: () => [],
        subInvocations: () => [
          {
            contractAddress: { contractId: () => contractIdBytes },
            functionName: "inner",
            args: () => [],
            subInvocations: () => [],
          },
          {
            contractAddress: { contractId: () => contractIdBytes },
            functionName: "inner2",
            args: () => [],
            subInvocations: () => [],
          },
        ],
      },
    };

    const result = inspectAuthEntry(entry);
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0]!.functionName).toBe("outer");
    expect(result.nestedInvocations).toHaveLength(2);
    expect(result.nestedInvocations[0]!.functionName).toBe("inner");
    expect(result.nestedInvocations[1]!.functionName).toBe("inner2");
  });

  it("handles deeply nested sub-invocations", () => {
    const contractIdBytes = Buffer.from("aaaabbbbccccdddd", "hex");
    const entry = {
      credentials: {
        type: () => ({ name: "scCredentialsSourceAccount" }),
      },
      rootInvocation: {
        contractAddress: { contractId: () => contractIdBytes },
        functionName: "level0",
        args: () => [],
        subInvocations: () => [
          {
            contractAddress: { contractId: () => contractIdBytes },
            functionName: "level1",
            args: () => [],
            subInvocations: () => [
              {
                contractAddress: { contractId: () => contractIdBytes },
                functionName: "level2",
                args: () => [],
                subInvocations: () => [],
              },
            ],
          },
        ],
      },
    };

    const result = inspectAuthEntry(entry);
    expect(result.credentials[0]!.functionName).toBe("level0");
    const nestedNames = result.nestedInvocations.map(n => n.functionName);
    expect(nestedNames).toContain("level1");
    expect(nestedNames).toContain("level2");
  });

  it("does not throw when subInvocations accessor throws", () => {
    const entry = {
      credentials: { type: () => ({ name: "unknown" }) },
      rootInvocation: {
        contractAddress: { contractId: () => Buffer.from("aabb", "hex") },
        functionName: "fn",
        args: () => [],
        subInvocations: () => { throw new Error("XDR error"); },
      },
    };
    expect(() => inspectAuthEntry(entry)).not.toThrow();
  });

  it("does not throw when credentials accessor throws", () => {
    const entry = {
      credentials: {
        get type(): never { throw new Error("bad"); },
      },
      rootInvocation: {
        contractAddress: { contractId: () => Buffer.from("aabb", "hex") },
        functionName: "fn",
        args: () => [],
        subInvocations: () => [],
      },
    };
    expect(() => inspectAuthEntry(entry)).not.toThrow();
  });

  it("handles source-account credential type (nonce is null)", () => {
    const entry = {
      credentials: {
        type: () => ({ name: "scCredentialsSourceAccount" }),
      },
      rootInvocation: {
        contractAddress: { contractId: () => Buffer.from("aabb", "hex") },
        functionName: "approve",
        args: () => [],
        subInvocations: () => [],
      },
    };
    const result = inspectAuthEntry(entry);
    expect(result.credentials[0]!.nonce).toBeNull();
    expect(result.credentials[0]!.expirationLedger).toBeNull();
  });
});

describe("diagnoseAuthorizationFailure", () => {
  it("returns an authorization message for an Error with 'unauthorized'", () => {
    const diag = diagnoseAuthorizationFailure(new Error("unauthorized"));
    expect(diag.message).toMatch(/authorization/i);
    expect(typeof diag.hint).toBe("string");
    expect(diag.hint.length).toBeGreaterThan(0);
  });

  it("returns an authorization message for an Error with 'auth required'", () => {
    const diag = diagnoseAuthorizationFailure(new Error("auth required"));
    expect(diag.message).toMatch(/authorization/i);
  });

  it("returns empty missingCredentials when no auth entries provided", () => {
    const diag = diagnoseAuthorizationFailure(new Error("unauthorized"));
    expect(diag.missingCredentials).toEqual([]);
  });

  it("returns empty missingCredentials when auth entries array is empty", () => {
    const diag = diagnoseAuthorizationFailure(new Error("auth required"), []);
    expect(diag.missingCredentials).toEqual([]);
  });

  it("extracts missing credential names from auth entries", () => {
    const entry = {
      credentials: { type: () => ({ name: "scCredentialsSoroban" }) },
      rootInvocation: {
        contractAddress: { contractId: () => Buffer.from("aabb", "hex") },
        functionName: "transfer",
        args: () => [],
        subInvocations: () => [],
      },
    };
    const diag = diagnoseAuthorizationFailure(new Error("auth required"), [entry]);
    expect(diag.missingCredentials).toContain("transfer");
    expect(diag.message).toContain("transfer");
  });

  it("includes nested invocation function names in missingCredentials", () => {
    const entry = {
      credentials: { type: () => ({ name: "scCredentialsSoroban" }) },
      rootInvocation: {
        contractAddress: { contractId: () => Buffer.from("aabb", "hex") },
        functionName: "outer",
        args: () => [],
        subInvocations: () => [
          {
            contractAddress: { contractId: () => Buffer.from("aabb", "hex") },
            functionName: "inner",
            args: () => [],
            subInvocations: () => [],
          },
        ],
      },
    };
    const diag = diagnoseAuthorizationFailure(new Error("auth required"), [entry]);
    expect(diag.missingCredentials).toContain("outer");
    expect(diag.missingCredentials).toContain("inner");
  });

  it("handles non-auth errors without mentioning authorization", () => {
    const diag = diagnoseAuthorizationFailure(new Error("network timeout"));
    expect(diag.message).toContain("network timeout");
  });

  it("handles string errors", () => {
    const diag = diagnoseAuthorizationFailure("auth failure");
    expect(diag.message).toMatch(/authorization/i);
  });

  it("handles null error without throwing", () => {
    expect(() => diagnoseAuthorizationFailure(null)).not.toThrow();
  });

  it("handles undefined error without throwing", () => {
    expect(() => diagnoseAuthorizationFailure(undefined)).not.toThrow();
  });

  it("handles SorokitResult-style error envelope", () => {
    const envelope = { status: "error", error: { message: "auth check failed" } };
    const diag = diagnoseAuthorizationFailure(envelope);
    expect(diag.message).toMatch(/authorization/i);
  });
});
