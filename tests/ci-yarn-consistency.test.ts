/**
 * CI / Yarn package-manager consistency tests (#109).
 *
 * Verifies that the project configuration consistently declares Yarn
 * and that the CI workflow is aligned to use it, so local development
 * and CI always resolve the same dependency graph.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");

describe("Yarn package manager consistency (#109)", () => {
  it("package.json declares yarn as the packageManager", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.packageManager).toMatch(/^yarn@/);
  });

  it(".yarnrc.yml exists", () => {
    expect(existsSync(join(root, ".yarnrc.yml"))).toBe(true);
  });

  it(".yarnrc.yml enables immutable installs", () => {
    const content = readFileSync(join(root, ".yarnrc.yml"), "utf8");
    expect(content).toContain("enableImmutableInstalls: true");
  });

  it(".yarnrc.yml sets nodeLinker to node-modules", () => {
    const content = readFileSync(join(root, ".yarnrc.yml"), "utf8");
    expect(content).toContain("nodeLinker: node-modules");
  });

  it("CI workflow uses yarn cache, not npm cache", () => {
    const ci = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).not.toMatch(/cache:\s*npm/);
    expect(ci).toMatch(/cache:\s*yarn/);
  });

  it("CI workflow installs with yarn --immutable, not npm install", () => {
    const ci = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).not.toContain("npm install");
    expect(ci).toContain("yarn install --immutable");
  });

  it("CI workflow runs scripts via yarn, not npm run", () => {
    const ci = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).not.toContain("npm run");
  });

  it("CI workflow enables corepack before each yarn install", () => {
    const ci = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    // corepack enable must appear in the workflow
    expect(ci).toContain("corepack enable");
  });

  it("CI security job uses yarn audit, not npm audit", () => {
    const ci = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).not.toContain("npm audit");
    expect(ci).toContain("yarn npm audit");
  });
});
