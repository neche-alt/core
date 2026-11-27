/**
 * Tests for issue #113 — dependency update automation.
 *
 * Verifies that .github/dependabot.yml is present and contains the minimum
 * required configuration for controlled peer-dependency update proposals.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "../../..");
const DEPENDABOT_PATH = join(REPO_ROOT, ".github/dependabot.yml");
const COMPAT_WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/compatibility.yml");

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Dependabot configuration (#113)", () => {
  it("dependabot.yml exists", () => {
    expect(existsSync(DEPENDABOT_PATH)).toBe(true);
  });

  it("targets the npm ecosystem", () => {
    const cfg = readFile(DEPENDABOT_PATH);
    expect(cfg).toContain("package-ecosystem: npm");
  });

  it("groups Stellar runtime peer dependencies together", () => {
    const cfg = readFile(DEPENDABOT_PATH);
    expect(cfg).toContain("stellar-runtime");
    expect(cfg).toContain("@stellar/*");
    expect(cfg).toContain("@creit.tech/*");
  });

  it("groups tooling dependencies separately from runtime", () => {
    const cfg = readFile(DEPENDABOT_PATH);
    expect(cfg).toContain("tooling");
    expect(cfg).toContain("typescript");
    expect(cfg).toContain("vitest");
  });

  it("uses conventional commit prefixes for dep update PRs", () => {
    const cfg = readFile(DEPENDABOT_PATH);
    expect(cfg).toContain('prefix: "chore(deps)"');
  });

  it("also tracks GitHub Actions versions", () => {
    const cfg = readFile(DEPENDABOT_PATH);
    expect(cfg).toContain("package-ecosystem: github-actions");
  });
});

describe("Compatibility workflow (#113)", () => {
  it("compatibility.yml exists", () => {
    expect(existsSync(COMPAT_WORKFLOW_PATH)).toBe(true);
  });

  it("triggers on package.json and lockfile changes", () => {
    const wf = readFile(COMPAT_WORKFLOW_PATH);
    expect(wf).toContain("package.json");
    expect(wf).toContain("package-lock.json");
  });

  it("runs typecheck, test, and build steps", () => {
    const wf = readFile(COMPAT_WORKFLOW_PATH);
    expect(wf).toContain("npm run typecheck");
    expect(wf).toContain("npm run test");
    expect(wf).toContain("npm run build");
  });

  it("gates on the dependencies label so it covers non-bot dep PRs too", () => {
    const wf = readFile(COMPAT_WORKFLOW_PATH);
    expect(wf).toContain("dependencies");
  });
});
