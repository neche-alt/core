import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Public Package Export Stability (#56)", () => {
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  const expectedSubpaths = [
    ".",
    "./testing",
    "./core",
    "./wallet",
    "./account",
    "./transaction",
    "./soroban",
    "./network",
    "./shared",
    "./integration",
    "./lazy",
    "./compliance",
    "./utility",
  ];

  it("declares all expected public subpaths in package.json exports", () => {
    expect(pkg.exports).toBeDefined();
    for (const subpath of expectedSubpaths) {
      expect(pkg.exports[subpath], `Subpath ${subpath} missing in package.json#exports`).toBeDefined();
    }
  });

  it("ensures every exported subpath defines types, import (ESM), and require (CJS)", () => {
    for (const [subpath, targets] of Object.entries<any>(pkg.exports)) {
      expect(targets.types, `${subpath} missing types`).toBeDefined();
      expect(targets.import, `${subpath} missing import`).toBeDefined();
      expect(targets.require, `${subpath} missing require`).toBeDefined();
      expect(targets.types).toMatch(/\.d\.ts$/);
      expect(targets.import).toMatch(/\.mjs$/);
      expect(targets.require).toMatch(/\.js$/);
    }
  });

  it("maps every public subpath to an existing source module or barrel", () => {
    const sourceMapping: Record<string, string> = {
      ".": "src/index.ts",
      "./testing": "src/testing/index.ts",
      "./core": "src/core.ts",
      "./wallet": "src/wallet/index.ts",
      "./account": "src/account/index.ts",
      "./transaction": "src/transaction/index.ts",
      "./soroban": "src/soroban/index.ts",
      "./network": "src/network/index.ts",
      "./shared": "src/shared/public.ts",
      "./integration": "src/integration/index.ts",
      "./lazy": "src/lazy/index.ts",
      "./compliance": "src/compliance/index.ts",
      "./utility": "src/utility/index.ts",
    };

    for (const [subpath, sourceFile] of Object.entries(sourceMapping)) {
      const fullPath = path.resolve(__dirname, "../../", sourceFile);
      expect(
        fs.existsSync(fullPath),
        `Source entry for ${subpath} does not exist at ${sourceFile}`,
      ).toBe(true);
    }
  });

  it("boundary test: does not expose unvetted internal paths or modules", () => {
    const unexportedPaths = [
      "./internal",
      "./src",
      "./dist",
      "./private",
      "./tests",
      "./scripts",
    ];

    for (const unexported of unexportedPaths) {
      expect(
        pkg.exports[unexported],
        `Internal path ${unexported} should not be exposed in package.json#exports`,
      ).toBeUndefined();
    }
  });

  it("tsup.config.ts builds all documented entrypoints", () => {
    const tsupConfigPath = path.resolve(__dirname, "../../tsup.config.ts");
    const tsupContent = fs.readFileSync(tsupConfigPath, "utf8");

    const requiredEntries = [
      "src/index.ts",
      "src/core.ts",
      "src/testing/index.ts",
      "src/wallet/index.ts",
      "src/account/index.ts",
      "src/transaction/index.ts",
      "src/soroban/index.ts",
      "src/network/index.ts",
      "src/shared/public.ts",
      "src/integration/index.ts",
      "src/lazy/index.ts",
      "src/compliance/index.ts",
      "src/utility/index.ts",
    ];

    for (const entry of requiredEntries) {
      expect(
        tsupContent.includes(entry),
        `tsup.config.ts missing entry: ${entry}`,
      ).toBe(true);
    }
  });
});
