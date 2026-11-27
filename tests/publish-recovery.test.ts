/**
 * Tests for publish recovery documentation and preflight script (#125).
 *
 * These tests verify the structural correctness of the recovery artefacts
 * rather than executing live registry calls, so they run in every CI job
 * without credentials.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");

describe("Publish recovery documentation (#125)", () => {
  it("docs/publish-recovery.md exists", () => {
    expect(existsSync(join(root, "docs/publish-recovery.md"))).toBe(true);
  });

  it("recovery guide documents all five failure states", () => {
    const guide = readFileSync(join(root, "docs/publish-recovery.md"), "utf8");
    expect(guide).toContain("Tag created, publish did not start");
    expect(guide).toContain("Publish succeeded, GitHub release draft not created");
    expect(guide).toContain("Publish partially uploaded");
    expect(guide).toContain("Wrong version published");
    expect(guide).toContain("Tag and publish are out of sync");
  });

  it("recovery guide includes dry-run instructions", () => {
    const guide = readFileSync(join(root, "docs/publish-recovery.md"), "utf8");
    expect(guide).toContain("--dry-run");
    expect(guide).toContain("Dry-Run Validation");
  });

  it("recovery guide includes a pre-retry checklist", () => {
    const guide = readFileSync(join(root, "docs/publish-recovery.md"), "utf8");
    expect(guide).toContain("Checklist Before Retrying");
    expect(guide).toContain("already live");
  });

  it("recovery guide warns against retrying blindly", () => {
    const guide = readFileSync(join(root, "docs/publish-recovery.md"), "utf8");
    expect(guide).toMatch(/never retry.*blindly/i);
  });

  it("recovery guide references the preflight script", () => {
    const guide = readFileSync(join(root, "docs/publish-recovery.md"), "utf8");
    expect(guide).toContain("publish-preflight.sh");
  });
});

describe("Publish preflight script (#125)", () => {
  it("scripts/publish-preflight.sh exists", () => {
    expect(existsSync(join(root, "scripts/publish-preflight.sh"))).toBe(true);
  });

  it("preflight script checks registry authentication", () => {
    const script = readFileSync(
      join(root, "scripts/publish-preflight.sh"),
      "utf8",
    );
    expect(script).toContain("npm whoami");
  });

  it("preflight script guards against publishing an already-live version", () => {
    const script = readFileSync(
      join(root, "scripts/publish-preflight.sh"),
      "utf8",
    );
    expect(script).toContain("already published on the registry");
  });

  it("preflight script performs a dry-run publish", () => {
    const script = readFileSync(
      join(root, "scripts/publish-preflight.sh"),
      "utf8",
    );
    expect(script).toContain("--dry-run");
  });

  it("preflight script checks git tag alignment", () => {
    const script = readFileSync(
      join(root, "scripts/publish-preflight.sh"),
      "utf8",
    );
    expect(script).toContain("Git tag alignment");
  });

  it("preflight script verifies build output is present", () => {
    const script = readFileSync(
      join(root, "scripts/publish-preflight.sh"),
      "utf8",
    );
    expect(script).toContain("Build output");
    expect(script).toContain("dist/");
  });

  it("preflight script exits non-zero when a check fails", () => {
    const script = readFileSync(
      join(root, "scripts/publish-preflight.sh"),
      "utf8",
    );
    expect(script).toContain("EXIT_CODE=$FAIL");
    expect(script).toContain('exit "$EXIT_CODE"');
  });
});
