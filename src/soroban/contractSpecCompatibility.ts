/**
 * Contract spec compatibility helpers (#40).
 *
 * Provides utilities for comparing and validating contract specs across
 * deployed versions, defining failure behavior for incompatible inputs,
 * and surfacing spec drift before it causes runtime errors in generated
 * contract clients.
 *
 * Design notes
 * ------------
 * - A "contract spec" is the set of function signatures a deployed contract
 *   exposes, independent of on-chain XDR format. This module works with a
 *   normalised in-memory representation so it can be used without a live RPC
 *   connection and remains framework-agnostic.
 * - `compareContractSpecs` never throws; malformed inputs produce status
 *   "unknown" rather than an exception.
 * - `validateContractSpec` returns a `SorokitResult` so callers stay in the
 *   no-throw result model used throughout the SDK.
 */

import { err, ok, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single function entry in a parsed contract spec. */
export interface ContractSpecFunction {
  /** Function name as it appears in the contract. */
  name: string;
  /** Stringified parameter types in declaration order, e.g. `["address", "u128"]`. */
  params: string[];
  /** Stringified return type, or `"void"` for functions that return nothing. */
  returns: string;
}

/** A minimal in-memory representation of a contract spec. */
export interface ContractSpec {
  /** Stellar contract address (C-strkey), if known. */
  contractId?: string;
  /** All publicly callable functions the contract exposes. */
  functions: ContractSpecFunction[];
  /** Optional opaque version tag from the contract's metadata. */
  version?: string;
}

/** Compatibility verdict between two contract specs. */
export type SpecCompatibilityStatus =
  | "identical"    // no functional difference between baseline and candidate
  | "compatible"   // only additive changes (new functions)
  | "incompatible" // at least one breaking change
  | "unknown";     // could not determine — malformed or missing input

/** A single detected difference between two contract specs. */
export interface SpecCompatibilityChange {
  kind:
    | "ADDED_FUNCTION"
    | "REMOVED_FUNCTION"
    | "CHANGED_PARAMS"
    | "CHANGED_RETURN";
  /** The function the change affects. */
  functionName: string;
  /** Human-readable description of the change. */
  message: string;
  /** Whether this change breaks existing callers. */
  breaking: boolean;
}

/**
 * Structured report from a spec compatibility comparison.
 * Mirrors the shape of {@link ContractMetadataCompatibilityReport} so callers
 * can handle both with uniform logic.
 */
export interface SpecCompatibilityReport {
  /** Overall compatibility classification. */
  status: SpecCompatibilityStatus;
  /** Convenience boolean: `true` for identical/compatible. */
  compatible: boolean;
  /** Every detected difference (empty when identical or unknown). */
  changes: SpecCompatibilityChange[];
  /** Non-fatal advisories (e.g. additive changes). */
  warnings: string[];
  /** Fatal explanations when status is `incompatible` or `unknown`. */
  errors: string[];
}

// ─── Comparison ───────────────────────────────────────────────────────────────

/**
 * Compare two contract specs and report compatibility.
 *
 * Uses `baseline` as the reference — what existing callers depend on — and
 * `candidate` as the newly discovered/deployed version. The rules are:
 *
 * | Change                        | Status        |
 * |-------------------------------|---------------|
 * | No change                     | `identical`   |
 * | Function added only           | `compatible`  |
 * | Function removed              | `incompatible`|
 * | Parameter types changed       | `incompatible`|
 * | Return type changed           | `incompatible`|
 * | Malformed input               | `unknown`     |
 *
 * Never throws — malformed inputs return `status: "unknown"`.
 *
 * ```ts
 * const report = compareContractSpecs(baseline, candidate);
 * if (report.status === "incompatible") {
 *   console.error("Breaking changes:", report.errors);
 * }
 * ```
 *
 * @param baseline  - The spec the application currently relies on.
 * @param candidate - The freshly discovered/deployed spec.
 * @returns A {@link SpecCompatibilityReport}.
 */
export function compareContractSpecs(
  baseline: ContractSpec,
  candidate: ContractSpec,
): SpecCompatibilityReport {
  // Input validation — return unknown for malformed inputs without throwing.
  if (
    !baseline ||
    typeof baseline !== "object" ||
    !Array.isArray(baseline.functions)
  ) {
    return {
      status: "unknown",
      compatible: false,
      changes: [],
      warnings: [],
      errors: ["baseline spec is malformed or missing a functions array."],
    };
  }

  if (
    !candidate ||
    typeof candidate !== "object" ||
    !Array.isArray(candidate.functions)
  ) {
    return {
      status: "unknown",
      compatible: false,
      changes: [],
      warnings: [],
      errors: ["candidate spec is malformed or missing a functions array."],
    };
  }

  const changes: SpecCompatibilityChange[] = [];
  const baselineByName = new Map(baseline.functions.map((f) => [f.name, f]));
  const candidateByName = new Map(candidate.functions.map((f) => [f.name, f]));

  // Check baseline functions against candidate.
  for (const fn of baseline.functions) {
    const next = candidateByName.get(fn.name);
    if (!next) {
      changes.push({
        kind: "REMOVED_FUNCTION",
        functionName: fn.name,
        message: `Function '${fn.name}' was removed from the contract spec.`,
        breaking: true,
      });
      continue;
    }
    if (JSON.stringify(fn.params) !== JSON.stringify(next.params)) {
      changes.push({
        kind: "CHANGED_PARAMS",
        functionName: fn.name,
        message:
          `Function '${fn.name}' parameter types changed ` +
          `from [${fn.params.join(", ")}] to [${next.params.join(", ")}].`,
        breaking: true,
      });
    }
    if (fn.returns !== next.returns) {
      changes.push({
        kind: "CHANGED_RETURN",
        functionName: fn.name,
        message:
          `Function '${fn.name}' return type changed ` +
          `from '${fn.returns}' to '${next.returns}'.`,
        breaking: true,
      });
    }
  }

  // Find newly added functions (non-breaking).
  for (const fn of candidate.functions) {
    if (!baselineByName.has(fn.name)) {
      changes.push({
        kind: "ADDED_FUNCTION",
        functionName: fn.name,
        message: `Function '${fn.name}' was added to the contract spec (non-breaking).`,
        breaking: false,
      });
    }
  }

  const breaking = changes.filter((c) => c.breaking);

  if (breaking.length > 0) {
    return {
      status: "incompatible",
      compatible: false,
      changes,
      warnings: [],
      errors: breaking.map((c) => c.message),
    };
  }

  if (changes.length > 0) {
    return {
      status: "compatible",
      compatible: true,
      changes,
      warnings: changes.map((c) => c.message),
      errors: [],
    };
  }

  return {
    status: "identical",
    compatible: true,
    changes: [],
    warnings: [],
    errors: [],
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that an arbitrary value is a structurally sound {@link ContractSpec}.
 *
 * Returns an `error` result for:
 * - `null` or non-object inputs
 * - Missing `functions` array
 * - Duplicate function names
 * - Functions missing `name`, `params`, or `returns` fields
 * - Non-string or empty function names
 *
 * Returns `ok` with the typed spec when validation passes.
 *
 * ```ts
 * const result = validateContractSpec(rawSpec);
 * if (result.status === "error") {
 *   console.error("Invalid spec:", result.error.message);
 * } else {
 *   const spec = result.data; // ContractSpec
 * }
 * ```
 *
 * @param spec - Value to validate.
 * @returns A `SorokitResult<ContractSpec>`.
 */
export function validateContractSpec(
  spec: unknown,
): SorokitResult<ContractSpec> {
  if (spec === null || typeof spec !== "object") {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      "Contract spec must be a non-null object.",
    );
  }

  const s = spec as Record<string, unknown>;

  if (!Array.isArray(s["functions"])) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      "Contract spec must have a 'functions' array.",
    );
  }

  const names = new Set<string>();
  for (const fn of s["functions"] as unknown[]) {
    if (typeof fn !== "object" || fn === null) {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        "Each spec function must be a non-null object.",
      );
    }
    const f = fn as Record<string, unknown>;

    if (typeof f["name"] !== "string" || (f["name"] as string).length === 0) {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        "Each spec function must have a non-empty string 'name' field.",
      );
    }
    const name = f["name"] as string;

    if (names.has(name)) {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        `Duplicate function name '${name}' in spec.`,
      );
    }
    names.add(name);

    if (!Array.isArray(f["params"])) {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        `Function '${name}' must have a 'params' array.`,
      );
    }

    if (typeof f["returns"] !== "string") {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        `Function '${name}' must have a string 'returns' field.`,
      );
    }
  }

  return ok(spec as ContractSpec);
}
