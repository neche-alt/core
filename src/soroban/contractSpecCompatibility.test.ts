import { describe, it, expect } from "vitest";
import {
  compareContractSpecs,
  validateContractSpec,
} from "./contractSpecCompatibility";
import type { ContractSpec } from "./contractSpecCompatibility";

const base: ContractSpec = {
  functions: [
    { name: "transfer", params: ["address", "u128"], returns: "void" },
    { name: "balance", params: ["address"], returns: "u128" },
  ],
};

describe("compareContractSpecs", () => {
  it("returns identical for two equal specs", () => {
    const report = compareContractSpecs(base, {
      functions: [
        { name: "transfer", params: ["address", "u128"], returns: "void" },
        { name: "balance", params: ["address"], returns: "u128" },
      ],
    });
    expect(report.status).toBe("identical");
    expect(report.compatible).toBe(true);
    expect(report.changes).toHaveLength(0);
    expect(report.errors).toHaveLength(0);
  });

  it("returns compatible when a function is added", () => {
    const candidate: ContractSpec = {
      functions: [
        ...base.functions,
        { name: "approve", params: ["address", "u128"], returns: "void" },
      ],
    };
    const report = compareContractSpecs(base, candidate);
    expect(report.status).toBe("compatible");
    expect(report.compatible).toBe(true);
    expect(report.changes.some((c) => c.kind === "ADDED_FUNCTION")).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("returns incompatible when a function is removed", () => {
    const candidate: ContractSpec = {
      functions: [base.functions[0]!],
    };
    const report = compareContractSpecs(base, candidate);
    expect(report.status).toBe("incompatible");
    expect(report.compatible).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.changes.some((c) => c.kind === "REMOVED_FUNCTION")).toBe(true);
  });

  it("returns incompatible when params change", () => {
    const candidate: ContractSpec = {
      functions: [
        { name: "transfer", params: ["address", "i128"], returns: "void" },
        base.functions[1]!,
      ],
    };
    const report = compareContractSpecs(base, candidate);
    expect(report.status).toBe("incompatible");
    expect(report.changes.some((c) => c.kind === "CHANGED_PARAMS")).toBe(true);
  });

  it("returns incompatible when return type changes", () => {
    const candidate: ContractSpec = {
      functions: [
        { name: "transfer", params: ["address", "u128"], returns: "bool" },
        base.functions[1]!,
      ],
    };
    const report = compareContractSpecs(base, candidate);
    expect(report.status).toBe("incompatible");
    expect(report.changes.some((c) => c.kind === "CHANGED_RETURN")).toBe(true);
  });

  it("returns incompatible with both param and return changes", () => {
    const candidate: ContractSpec = {
      functions: [
        { name: "transfer", params: ["address"], returns: "bool" },
        base.functions[1]!,
      ],
    };
    const report = compareContractSpecs(base, candidate);
    expect(report.status).toBe("incompatible");
    expect(report.changes.some((c) => c.kind === "CHANGED_PARAMS")).toBe(true);
    expect(report.changes.some((c) => c.kind === "CHANGED_RETURN")).toBe(true);
  });

  it("returns unknown status when baseline is null", () => {
    const report = compareContractSpecs(null as never, base);
    expect(report.status).toBe("unknown");
    expect(report.compatible).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("returns unknown status when candidate is null", () => {
    const report = compareContractSpecs(base, null as never);
    expect(report.status).toBe("unknown");
    expect(report.compatible).toBe(false);
  });

  it("returns unknown when candidate has no functions array", () => {
    const report = compareContractSpecs(base, { functions: null } as never);
    expect(report.status).toBe("unknown");
  });

  it("returns unknown when baseline has no functions array", () => {
    const report = compareContractSpecs({ functions: undefined } as never, base);
    expect(report.status).toBe("unknown");
  });

  it("handles empty specs as identical", () => {
    const report = compareContractSpecs({ functions: [] }, { functions: [] });
    expect(report.status).toBe("identical");
  });

  it("includes change messages in errors for incompatible result", () => {
    const candidate: ContractSpec = { functions: [] };
    const report = compareContractSpecs(base, candidate);
    expect(report.errors.length).toBe(base.functions.length);
    for (const fn of base.functions) {
      expect(report.errors.some((e) => e.includes(fn.name))).toBe(true);
    }
  });

  it("includes change messages in warnings for compatible result", () => {
    const candidate: ContractSpec = {
      functions: [
        ...base.functions,
        { name: "new_fn", params: [], returns: "void" },
      ],
    };
    const report = compareContractSpecs(base, candidate);
    expect(report.warnings.some((w) => w.includes("new_fn"))).toBe(true);
  });
});

describe("validateContractSpec", () => {
  it("accepts a valid spec", () => {
    const result = validateContractSpec({
      functions: [{ name: "foo", params: ["u32"], returns: "bool" }],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.functions[0]!.name).toBe("foo");
    }
  });

  it("accepts a spec with no functions (empty array)", () => {
    const result = validateContractSpec({ functions: [] });
    expect(result.status).toBe("ok");
  });

  it("accepts optional contractId and version fields", () => {
    const result = validateContractSpec({
      contractId: "CABC...",
      version: "1.0.0",
      functions: [{ name: "fn", params: [], returns: "void" }],
    });
    expect(result.status).toBe("ok");
  });

  it("rejects null", () => {
    const result = validateContractSpec(null);
    expect(result.status).toBe("error");
  });

  it("rejects a string", () => {
    const result = validateContractSpec("not-an-object");
    expect(result.status).toBe("error");
  });

  it("rejects spec missing functions array", () => {
    const result = validateContractSpec({ name: "contract" });
    expect(result.status).toBe("error");
  });

  it("rejects spec with duplicate function names", () => {
    const result = validateContractSpec({
      functions: [
        { name: "foo", params: [], returns: "void" },
        { name: "foo", params: ["u32"], returns: "bool" },
      ],
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("foo");
    }
  });

  it("rejects function with missing params", () => {
    const result = validateContractSpec({
      functions: [{ name: "foo", returns: "void" }],
    });
    expect(result.status).toBe("error");
  });

  it("rejects function with missing returns", () => {
    const result = validateContractSpec({
      functions: [{ name: "foo", params: [] }],
    });
    expect(result.status).toBe("error");
  });

  it("rejects function with numeric name", () => {
    const result = validateContractSpec({
      functions: [{ name: 123, params: [], returns: "void" }],
    });
    expect(result.status).toBe("error");
  });

  it("rejects function with empty string name", () => {
    const result = validateContractSpec({
      functions: [{ name: "", params: [], returns: "void" }],
    });
    expect(result.status).toBe("error");
  });

  it("rejects non-object function entries", () => {
    const result = validateContractSpec({
      functions: ["not-a-function"],
    });
    expect(result.status).toBe("error");
  });
});
