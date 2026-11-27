#!/usr/bin/env node
/**
 * check-release-metadata.mjs  (#123)
 *
 * Non-destructive validation that flags inconsistent release metadata across
 * the repository's release branches and tags compared with the published
 * package version.
 *
 * Checks performed
 * ────────────────
 * 1. BRANCH_VERSION_DRIFT  — release/* branches whose tip commit does not
 *    carry the same package version as the branch name implies.
 * 2. TAG_VERSION_MISMATCH  — vX.Y.Z tags whose target commit has a
 *    package.json version that differs from the tag name.
 * 3. TAG_WITHOUT_BRANCH    — semver tags (vX.Y.Z) where no matching
 *    release/X.Y.Z branch exists.
 * 4. BRANCH_WITHOUT_TAG    — release/* branches for which no matching
 *    vX.Y.Z tag exists.
 * 5. TAG_NOT_ANNOTATED     — lightweight tags (should be annotated for releases).
 *
 * Exit codes
 * ──────────
 * 0  All checks passed.
 * 1  One or more inconsistencies detected (details printed to stdout).
 *
 * Maintainer actions
 * ──────────────────
 * BRANCH_VERSION_DRIFT  → Update package.json on the branch to match the
 *                          expected version, or rename/delete the branch.
 * TAG_VERSION_MISMATCH  → Delete and recreate the tag pointing at the correct
 *                          commit: `git tag -d vX.Y.Z && git tag -a vX.Y.Z <sha>`
 * TAG_WITHOUT_BRANCH    → Create the missing branch:
 *                          `git checkout -b release/X.Y.Z vX.Y.Z`
 *                          or delete the orphan tag if it was created in error.
 * BRANCH_WITHOUT_TAG    → Create the missing tag once the release is confirmed:
 *                          `git tag -a vX.Y.Z -m "Release X.Y.Z" <sha>`
 *                          or delete the branch if the release was abandoned.
 * TAG_NOT_ANNOTATED     → Recreate as an annotated tag:
 *                          `git tag -d vX.Y.Z && git tag -a vX.Y.Z <sha> -m "Release X.Y.Z"`
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function git(cmd) {
  try {
    return execSync(`git -C ${ROOT} ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function semverTagName(tag) {
  return /^v\d+\.\d+\.\d+/.test(tag);
}

function versionFromTag(tag) {
  const m = tag.match(/^v(\d+\.\d+\.\d+.*)/);
  return m ? m[1] : null;
}

/**
 * Read package.json version from the git object tree at a given ref.
 * Falls back to null if the file cannot be read (e.g. the ref predates it).
 */
function packageVersionAt(ref) {
  try {
    const content = execSync(
      `git -C ${ROOT} show ${ref}:package.json`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const { version } = JSON.parse(content);
    return version ?? null;
  } catch {
    return null;
  }
}

/** Returns true when a tag is annotated (tag object), false when lightweight. */
function isAnnotatedTag(tag) {
  const type = git(`cat-file -t refs/tags/${tag}`);
  return type === "tag";
}

// ─── Collect refs ────────────────────────────────────────────────────────────

const rawBranches = git("branch -r --list 'origin/release/*'");
const remoteBranches = rawBranches
  ? rawBranches.split("\n").map((b) => b.trim()).filter(Boolean)
  : [];

// Also consider local release branches (useful in CI where remotes may not be fetched).
const rawLocalBranches = git("branch --list 'release/*'");
const localBranches = rawLocalBranches
  ? rawLocalBranches.split("\n").map((b) => b.trim().replace(/^\*\s+/, "")).filter(Boolean)
  : [];

// Merge remote and local, normalising to the short branch name.
const branchNames = new Set([
  ...remoteBranches.map((b) => b.replace(/^origin\//, "")),
  ...localBranches,
]);

const rawTags = git("tag --list");
const allTags = rawTags ? rawTags.split("\n").filter(Boolean) : [];
const releaseTags = allTags.filter(semverTagName);

// ─── Findings ────────────────────────────────────────────────────────────────

const findings = [];

function finding(code, message, action) {
  findings.push({ code, message, action });
}

// 1. BRANCH_VERSION_DRIFT
for (const branch of branchNames) {
  // Expected version: last path segment of "release/X.Y.Z"
  const parts = branch.split("/");
  const expectedVersion = parts[parts.length - 1];
  if (!expectedVersion || !/^\d+\.\d+\.\d+/.test(expectedVersion)) continue;

  // Try remote first, fall back to local
  const ref = remoteBranches.some((r) => r.includes(branch))
    ? `origin/${branch}`
    : branch;

  const actual = packageVersionAt(ref);
  if (actual === null) {
    finding(
      "BRANCH_VERSION_DRIFT",
      `Branch "${branch}": could not read package.json at tip.`,
      `Ensure the branch tip contains a valid package.json. ` +
        `Expected version: ${expectedVersion}.`,
    );
  } else if (actual !== expectedVersion) {
    finding(
      "BRANCH_VERSION_DRIFT",
      `Branch "${branch}": package.json version is "${actual}", expected "${expectedVersion}".`,
      `Update package.json on the branch to "${expectedVersion}", or rename/delete the branch.`,
    );
  }
}

// 2. TAG_VERSION_MISMATCH
for (const tag of releaseTags) {
  const expectedVersion = versionFromTag(tag);
  if (!expectedVersion) continue;

  const actual = packageVersionAt(tag);
  if (actual === null) {
    finding(
      "TAG_VERSION_MISMATCH",
      `Tag "${tag}": could not read package.json at tagged commit.`,
      `Verify the tag points at the correct commit and that commit has a valid package.json.`,
    );
  } else if (actual !== expectedVersion) {
    finding(
      "TAG_VERSION_MISMATCH",
      `Tag "${tag}": package.json version is "${actual}", expected "${expectedVersion}".`,
      `Delete and recreate the tag: git tag -d ${tag} && git tag -a ${tag} <correct-sha> -m "Release ${expectedVersion}"`,
    );
  }
}

// 3. TAG_WITHOUT_BRANCH
for (const tag of releaseTags) {
  const version = versionFromTag(tag);
  if (!version) continue;
  const expectedBranch = `release/${version}`;
  if (!branchNames.has(expectedBranch)) {
    finding(
      "TAG_WITHOUT_BRANCH",
      `Tag "${tag}" exists but branch "${expectedBranch}" does not.`,
      `Create the branch: git checkout -b ${expectedBranch} ${tag}\n` +
        `Or delete the orphan tag if it was created in error: git tag -d ${tag}`,
    );
  }
}

// 4. BRANCH_WITHOUT_TAG
for (const branch of branchNames) {
  const parts = branch.split("/");
  const version = parts[parts.length - 1];
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) continue;
  const expectedTag = `v${version}`;
  if (!releaseTags.includes(expectedTag)) {
    finding(
      "BRANCH_WITHOUT_TAG",
      `Branch "${branch}" exists but tag "${expectedTag}" does not.`,
      `Create the tag once the release is confirmed:\n` +
        `  git tag -a ${expectedTag} -m "Release ${version}" <sha>\n` +
        `Or delete the branch if this release was abandoned.`,
    );
  }
}

// 5. TAG_NOT_ANNOTATED
for (const tag of releaseTags) {
  if (!isAnnotatedTag(tag)) {
    finding(
      "TAG_NOT_ANNOTATED",
      `Tag "${tag}" is a lightweight tag. Release tags should be annotated.`,
      `Recreate as annotated: git tag -d ${tag} && git tag -a ${tag} <sha> -m "Release ${versionFromTag(tag)}"`,
    );
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

if (findings.length === 0) {
  console.log("✅  Release metadata check passed — no inconsistencies found.");
  process.exit(0);
}

console.log(`\n⚠️  Release metadata check found ${findings.length} issue(s):\n`);

for (const { code, message, action } of findings) {
  console.log(`[${code}]`);
  console.log(`  Problem : ${message}`);
  console.log(`  Action  : ${action}`);
  console.log();
}

process.exit(1);
