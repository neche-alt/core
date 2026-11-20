import { describe, it, expect } from "vitest";

/**
 * Unit tests for the npm dry-run pack validation logic (#110).
 *
 * Covers the pure validation functions — metadata checks and file coverage
 * assertions — without executing the actual `npm pack` command.
 */

// ─── Helpers mirroring scripts/validate-pack.js ──────────────────────────────

interface PackFile {
  path: string;
}

interface PackEntry {
  files: PackFile[];
}

function extractPackedFiles(packEntry: PackEntry): Set<string> {
  return new Set(
    (packEntry.files || []).map((f) => f.path.replace(/^package\//, "")),
  );
}

interface PkgMeta {
  name: string;
  version: string;
  main: string;
  types: string;
}

function validateMetadata(pkg: PkgMeta): string[] {
  const errors: string[] = [];
  if (pkg.name !== "sorokit-core") errors.push(`name should be "sorokit-core"`);
  if (!pkg.version || pkg.version.trim() === "") errors.push("version is missing or empty");
  if (pkg.main !== "./dist/index.js") errors.push(`main should be "./dist/index.js"`);
  if (pkg.types !== "./dist/index.d.ts") errors.push(`types should be "./dist/index.d.ts"`);
  return errors;
}

function validateRequiredFiles(packedFiles: Set<string>, required: string[]): string[] {
  return required.filter((f) => !packedFiles.has(f));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("validate-pack: metadata checks", () => {
  it("passes for correct package metadata", () => {
    const errors = validateMetadata({
      name: "sorokit-core",
      version: "0.1.0",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(errors).toHaveLength(0);
  });

  it("fails when name is wrong", () => {
    const errors = validateMetadata({
      name: "wrong-name",
      version: "0.1.0",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("fails when version is empty", () => {
    const errors = validateMetadata({
      name: "sorokit-core",
      version: "",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("fails when version is whitespace only", () => {
    const errors = validateMetadata({
      name: "sorokit-core",
      version: "   ",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("fails when main is wrong", () => {
    const errors = validateMetadata({
      name: "sorokit-core",
      version: "0.1.0",
      main: "./dist/other.js",
      types: "./dist/index.d.ts",
    });
    expect(errors.some((e) => e.includes("main"))).toBe(true);
  });

  it("fails when types is wrong", () => {
    const errors = validateMetadata({
      name: "sorokit-core",
      version: "0.1.0",
      main: "./dist/index.js",
      types: "./dist/other.d.ts",
    });
    expect(errors.some((e) => e.includes("types"))).toBe(true);
  });

  it("accumulates multiple metadata errors", () => {
    const errors = validateMetadata({
      name: "bad",
      version: "",
      main: "./bad.js",
      types: "./bad.d.ts",
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validate-pack: extractPackedFiles", () => {
  it("strips the package/ prefix from packed file paths", () => {
    const entry: PackEntry = {
      files: [
        { path: "package/dist/index.js" },
        { path: "package/README.md" },
      ],
    };
    const files = extractPackedFiles(entry);
    expect(files.has("dist/index.js")).toBe(true);
    expect(files.has("README.md")).toBe(true);
    expect(files.has("package/dist/index.js")).toBe(false);
  });

  it("handles entries that have no prefix", () => {
    const entry: PackEntry = { files: [{ path: "dist/index.js" }] };
    const files = extractPackedFiles(entry);
    expect(files.has("dist/index.js")).toBe(true);
  });

  it("returns an empty set for an empty files array", () => {
    expect(extractPackedFiles({ files: [] }).size).toBe(0);
  });
});

describe("validate-pack: required file coverage", () => {
  it("reports no missing files when all required files are present", () => {
    const packed = new Set(["dist/index.js", "dist/index.mjs", "dist/index.d.ts"]);
    const missing = validateRequiredFiles(packed, [
      "dist/index.js",
      "dist/index.mjs",
      "dist/index.d.ts",
    ]);
    expect(missing).toHaveLength(0);
  });

  it("reports a single missing file", () => {
    const packed = new Set(["dist/index.js"]);
    const missing = validateRequiredFiles(packed, ["dist/index.js", "dist/index.mjs"]);
    expect(missing).toEqual(["dist/index.mjs"]);
  });

  it("reports all missing files when pack is empty", () => {
    const packed = new Set<string>();
    const required = ["dist/index.js", "dist/index.mjs", "dist/index.d.ts"];
    const missing = validateRequiredFiles(packed, required);
    expect(missing).toEqual(required);
  });

  it("fails when a required entry-point declaration file is absent", () => {
    const packed = new Set(["dist/index.js", "dist/index.d.ts"]);
    const missing = validateRequiredFiles(packed, [
      "dist/index.js",
      "dist/index.mjs",
      "dist/index.d.ts",
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toBe("dist/index.mjs");
  });
});
