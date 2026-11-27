/**
 * Workflow permissions hardening tests (#120)
 *
 * Validates that the CI workflow YAML enforces least-privilege token
 * permissions and that publishing credentials are separated from test jobs.
 *
 * These tests parse the workflow files at the source level so any future
 * edit that re-introduces broad permissions is caught by CI before merging.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../");

function readWorkflow(name: string): string {
  return readFileSync(resolve(ROOT, `.github/workflows/${name}`), "utf-8");
}

describe("CI workflow permissions (#120)", () => {
  const ci = readWorkflow("ci.yml");

  it("sets a top-level read-only permissions block", () => {
    expect(ci).toMatch(/^permissions:\s*\n\s+contents:\s*read/m);
  });

  it("every job declares its own permissions block", () => {
    const jobNames = ["typecheck", "lint", "test", "build", "security"];
    for (const job of jobNames) {
      // Each job section should contain a permissions: key
      const jobStart = ci.indexOf(`${job}:`);
      expect(jobStart).toBeGreaterThan(-1);
      const jobSection = ci.slice(jobStart, jobStart + 600);
      expect(jobSection).toMatch(/permissions:/);
    }
  });

  it("test job does not have write permissions", () => {
    const testJobStart = ci.indexOf("  test:");
    const testSection = ci.slice(testJobStart, testJobStart + 600);
    expect(testSection).not.toMatch(/contents:\s*write/);
    expect(testSection).not.toMatch(/id-token:\s*write/);
  });

  it("does not reference NPM_TOKEN or publish secrets", () => {
    expect(ci).not.toMatch(/NPM_TOKEN/);
    expect(ci).not.toMatch(/NODE_AUTH_TOKEN/);
  });
});

describe("Release workflow permissions (#120)", () => {
  const release = readWorkflow("release.yml");

  it("sets a top-level read-only permissions block", () => {
    expect(release).toMatch(/^permissions:\s*\n\s+contents:\s*read/m);
  });

  it("publish job requests write permissions explicitly", () => {
    const publishStart = release.indexOf("publish:");
    const publishSection = release.slice(publishStart, publishStart + 800);
    expect(publishSection).toMatch(/contents:\s*write/);
    expect(publishSection).toMatch(/id-token:\s*write/);
  });

  it("NPM_TOKEN is scoped to the publish job only", () => {
    // The secret reference must appear after the publish job header
    const publishStart = release.indexOf("    publish:");
    expect(publishStart).toBeGreaterThan(-1);
    const beforePublish = release.slice(0, publishStart);
    expect(beforePublish).not.toMatch(/NPM_TOKEN/);
  });

  it("triggers only on version tags, not pull_request events", () => {
    expect(release).toMatch(/on:\s*\n\s+push:\s*\n\s+tags:/m);
    expect(release).not.toMatch(/pull_request/);
  });
});
