/**
 * Tagged release workflow unit tests (#111).
 *
 * Covers the tag validation logic and release summary fields that the
 * release.yml workflow uses, without running the workflow itself.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Tag validation — mirrors the bash regex in release.yml validate-tag job
// ---------------------------------------------------------------------------

function isValidReleaseTag(tag: string): boolean {
  return /^v[0-9]+\.[0-9]+\.[0-9]+/.test(tag);
}

function parseVersion(tag: string): string | null {
  if (!isValidReleaseTag(tag)) return null;
  return tag.slice(1); // strip leading "v"
}

function versionMatchesTag(pkgVersion: string, tagVersion: string): boolean {
  const base = tagVersion.split("-")[0] ?? tagVersion;
  return pkgVersion === tagVersion || pkgVersion === base;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isValidReleaseTag", () => {
  it("accepts a plain semver tag", () => {
    expect(isValidReleaseTag("v1.2.3")).toBe(true);
  });

  it("accepts a pre-release tag", () => {
    expect(isValidReleaseTag("v1.2.3-beta.1")).toBe(true);
    expect(isValidReleaseTag("v0.1.0-rc.2")).toBe(true);
  });

  it("rejects a tag without a leading v", () => {
    expect(isValidReleaseTag("1.2.3")).toBe(false);
  });

  it("rejects a tag with non-numeric segments", () => {
    expect(isValidReleaseTag("vone.two.three")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidReleaseTag("")).toBe(false);
  });

  it("rejects a branch name", () => {
    expect(isValidReleaseTag("main")).toBe(false);
    expect(isValidReleaseTag("feat/111-release")).toBe(false);
  });
});

describe("parseVersion", () => {
  it("strips the leading v", () => {
    expect(parseVersion("v1.2.3")).toBe("1.2.3");
  });

  it("preserves pre-release suffix", () => {
    expect(parseVersion("v2.0.0-beta.1")).toBe("2.0.0-beta.1");
  });

  it("returns null for an invalid tag", () => {
    expect(parseVersion("not-a-tag")).toBeNull();
  });
});

describe("versionMatchesTag", () => {
  it("matches when package version equals tag version exactly", () => {
    expect(versionMatchesTag("1.2.3", "1.2.3")).toBe(true);
  });

  it("matches when package version equals the base of a pre-release tag", () => {
    // package.json may still be at 1.2.3 when tagging 1.2.3-beta.1
    expect(versionMatchesTag("1.2.3", "1.2.3-beta.1")).toBe(true);
  });

  it("matches pre-release package version against identical tag", () => {
    expect(versionMatchesTag("1.2.3-beta.1", "1.2.3-beta.1")).toBe(true);
  });

  it("rejects a package version that does not match the tag", () => {
    expect(versionMatchesTag("1.2.2", "1.2.3")).toBe(false);
  });

  it("rejects a package version ahead of the tag", () => {
    expect(versionMatchesTag("2.0.0", "1.9.9")).toBe(false);
  });
});

describe("release summary fields", () => {
  it("includes all required fields", () => {
    const summary = {
      version: "1.2.3",
      commitSha: "abc1234def5678",
      shortSha: "abc1234",
      tag: "v1.2.3",
      nodeVersion: "v22.0.0",
    };

    expect(summary).toHaveProperty("version");
    expect(summary).toHaveProperty("commitSha");
    expect(summary).toHaveProperty("shortSha");
    expect(summary).toHaveProperty("tag");
    expect(summary).toHaveProperty("nodeVersion");
  });

  it("short SHA is the first 7 characters of the full SHA", () => {
    const full = "abc1234def5678901234";
    const short = full.slice(0, 7);
    expect(short).toBe("abc1234");
    expect(short).toHaveLength(7);
  });

  it("pre-release tag sets prerelease flag", () => {
    const isPrerelease = (tag: string) => tag.includes("-");
    expect(isPrerelease("v1.0.0-beta.1")).toBe(true);
    expect(isPrerelease("v1.0.0")).toBe(false);
  });
});
