/**
 * Tests for issue #112 – Security audit severity policy.
 *
 * These tests verify that the CI audit configuration correctly enforces the
 * documented two-tier severity policy: high/critical are blocking, while
 * moderate/low generate a non-blocking advisory report.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const workspaceRoot = join(__dirname, "../../");

describe("Security audit policy (#112)", () => {
  it("CI workflow contains a blocking high/critical audit step", () => {
    const ciYml = readFileSync(
      join(workspaceRoot, ".github/workflows/ci.yml"),
      "utf-8",
    );
    // The blocking step must use --audit-level=high (not suppressed with || true)
    expect(ciYml).toMatch(/npm audit --audit-level=high(?!\s*\|\|)/m);
  });

  it("CI workflow contains a non-blocking advisory report step", () => {
    const ciYml = readFileSync(
      join(workspaceRoot, ".github/workflows/ci.yml"),
      "utf-8",
    );
    // The advisory step writes JSON output and always succeeds
    expect(ciYml).toMatch(/npm audit --json.*\|\|\s*true/m);
  });

  it("CI workflow uploads the advisory report as an artifact", () => {
    const ciYml = readFileSync(
      join(workspaceRoot, ".github/workflows/ci.yml"),
      "utf-8",
    );
    expect(ciYml).toContain("upload-artifact");
    expect(ciYml).toContain("audit-advisory-report");
  });

  it("security audit policy doc exists and documents the threshold table", () => {
    const policyDoc = readFileSync(
      join(workspaceRoot, "docs/security-audit-policy.md"),
      "utf-8",
    );
    // Must describe blocking severities
    expect(policyDoc).toContain("critical");
    expect(policyDoc).toContain("high");
    // Must describe non-blocking severities
    expect(policyDoc).toContain("moderate");
    expect(policyDoc).toContain("low");
    // Must document the advisory artifact
    expect(policyDoc).toContain("audit-advisory-report");
  });

  it("security audit policy doc includes local audit commands", () => {
    const policyDoc = readFileSync(
      join(workspaceRoot, "docs/security-audit-policy.md"),
      "utf-8",
    );
    expect(policyDoc).toContain("npm audit --audit-level=high");
    expect(policyDoc).toContain("npm audit --json");
  });
});
