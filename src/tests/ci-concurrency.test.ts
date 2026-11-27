/**
 * Tests for CI workflow concurrency configuration (#124).
 *
 * Verifies the concurrency group expression targets pull_request events
 * and that push-to-main runs are never marked cancel-in-progress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const workflowPath = resolve(__dirname, "../../.github/workflows/ci.yml");
const content = (): string => readFileSync(workflowPath, "utf8");

describe("CI concurrency controls (#124)", () => {
  it("workflow file contains a concurrency block", () => {
    expect(content()).toContain("concurrency:");
  });

  it("concurrency group keys on workflow name and PR number falling back to ref", () => {
    const yaml = content();
    expect(yaml).toContain("github.workflow");
    expect(yaml).toContain("github.event.pull_request.number");
    expect(yaml).toContain("github.ref");
  });

  it("cancel-in-progress is conditional on pull_request event only", () => {
    const yaml = content();
    expect(yaml).toContain("cancel-in-progress:");
    // Must reference the event name so push-to-main runs are never cancelled.
    expect(yaml).toContain("github.event_name == 'pull_request'");
  });

  it("both main and develop push branches are configured", () => {
    expect(content()).toContain("branches: [main, develop]");
  });
});
