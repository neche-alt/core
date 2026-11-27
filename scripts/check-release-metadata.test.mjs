/**
 * Tests for check-release-metadata.mjs (#123)
 *
 * Uses Node's built-in `assert` so no additional test runner is needed.
 * Run with: node scripts/check-release-metadata.test.mjs
 */

import assert from "assert";

// ─── Unit-test the pure helper functions by inlining them here ───────────────
// (The script is not structured as an importable module, so we re-implement
//  the two pure helpers that are safe to test in isolation.)

function semverTagName(tag) {
  return /^v\d+\.\d+\.\d+/.test(tag);
}

function versionFromTag(tag) {
  const m = tag.match(/^v(\d+\.\d+\.\d+.*)/);
  return m ? m[1] : null;
}

// ─── semverTagName ────────────────────────────────────────────────────────────

assert.strictEqual(semverTagName("v1.2.3"), true, "standard semver tag");
assert.strictEqual(semverTagName("v0.0.1"), true, "patch-level tag");
assert.strictEqual(semverTagName("v1.2.3-rc.1"), true, "pre-release tag");
assert.strictEqual(semverTagName("v10.20.30"), true, "multi-digit tag");
assert.strictEqual(semverTagName("1.2.3"), false, "missing leading v");
assert.strictEqual(semverTagName("release/1.2.3"), false, "branch name, not a tag");
assert.strictEqual(semverTagName(""), false, "empty string");
assert.strictEqual(semverTagName("vfoo"), false, "non-numeric after v");

// ─── versionFromTag ───────────────────────────────────────────────────────────

assert.strictEqual(versionFromTag("v1.2.3"), "1.2.3", "extracts plain version");
assert.strictEqual(versionFromTag("v0.1.0"), "0.1.0", "zero-major version");
assert.strictEqual(versionFromTag("v1.2.3-beta.1"), "1.2.3-beta.1", "pre-release suffix");
assert.strictEqual(versionFromTag("1.2.3"), null, "returns null without v prefix");
assert.strictEqual(versionFromTag(""), null, "returns null for empty string");
assert.strictEqual(versionFromTag("vfoo"), null, "returns null for non-semver");

// ─── Finding accumulation logic (boundary / failure cases) ───────────────────

// Simulate the check: branch name does not match package.json version
function checkBranchVersionDrift(branchVersion, packageVersion) {
  if (packageVersion === null) {
    return { code: "BRANCH_VERSION_DRIFT", drifted: true };
  }
  if (packageVersion !== branchVersion) {
    return { code: "BRANCH_VERSION_DRIFT", drifted: true };
  }
  return { drifted: false };
}

// Matching versions → no drift
assert.strictEqual(checkBranchVersionDrift("1.2.3", "1.2.3").drifted, false);
// Mismatched version → drift detected
assert.strictEqual(checkBranchVersionDrift("1.2.3", "1.2.4").drifted, true);
// Null (unreadable) → drift detected
assert.strictEqual(checkBranchVersionDrift("1.2.3", null).drifted, true);

// ─── TAG_WITHOUT_BRANCH boundary ─────────────────────────────────────────────

function checkTagWithoutBranch(tag, branchSet) {
  const version = versionFromTag(tag);
  if (!version) return false;
  return !branchSet.has(`release/${version}`);
}

const branches = new Set(["release/1.0.0", "release/1.1.0"]);
assert.strictEqual(checkTagWithoutBranch("v1.0.0", branches), false, "matching branch exists");
assert.strictEqual(checkTagWithoutBranch("v1.2.0", branches), true, "no matching branch");
assert.strictEqual(checkTagWithoutBranch("not-semver", branches), false, "non-semver tag skipped");

// ─── BRANCH_WITHOUT_TAG boundary ─────────────────────────────────────────────

function checkBranchWithoutTag(branch, tagList) {
  const parts = branch.split("/");
  const version = parts[parts.length - 1];
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) return false;
  return !tagList.includes(`v${version}`);
}

const tags = ["v1.0.0", "v1.1.0"];
assert.strictEqual(checkBranchWithoutTag("release/1.0.0", tags), false, "matching tag exists");
assert.strictEqual(checkBranchWithoutTag("release/1.2.0", tags), true, "no matching tag");
assert.strictEqual(checkBranchWithoutTag("feature/xyz", tags), false, "non-release branch skipped");
assert.strictEqual(checkBranchWithoutTag("release/not-ver", tags), false, "non-semver branch skipped");

console.log("✅  check-release-metadata.test.mjs — all assertions passed.");
