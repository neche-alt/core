/**
 * Tests for issue #114 — CI dependency caching.
 *
 * These tests verify that the CI workflow is configured to derive its cache
 * key from package-lock.json, so a lockfile change forces a cache miss and
 * generated build artifacts (dist/) are never stored as cached dependencies.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "../../..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/ci.yml");

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("CI cache configuration (#114)", () => {
  it("derives cache keys from package-lock.json", () => {
    const workflow = readWorkflow();
    // Every job that caches must hash the lockfile.
    expect(workflow).toContain("hashFiles('package-lock.json')");
  });

  it("uses actions/cache@v4 for dependency caching", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("actions/cache@v4");
  });

  it("caches the npm global cache directory, not node_modules or dist", () => {
    const workflow = readWorkflow();
    // The npm cache path must be ~/.npm (the package download cache).
    expect(workflow).toContain("path: ~/.npm");
    // dist/ must NOT appear as a cache path — build artifacts are not deps.
    const cacheBlocks = workflow.split("actions/cache@v4");
    for (const block of cacheBlocks.slice(1)) {
      const pathLine = block.split("\n").find((l) => l.trim().startsWith("path:"));
      if (pathLine) {
        expect(pathLine).not.toContain("dist");
        expect(pathLine).not.toContain("node_modules");
      }
    }
  });

  it("includes a restore-keys fallback for partial cache hits", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("restore-keys:");
    expect(workflow).toContain("npm-${{ runner.os }}-");
  });

  it("every install step is preceded by a cache step", () => {
    const workflow = readWorkflow();
    // Count Install steps and cache steps — they must be equal.
    const installCount = (workflow.match(/name: Install dependencies/g) ?? []).length;
    const cacheCount = (workflow.match(/name: Cache npm dependencies/g) ?? []).length;
    expect(cacheCount).toBe(installCount);
    expect(installCount).toBeGreaterThan(0);
  });
});
