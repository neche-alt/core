#!/usr/bin/env node
/**
 * pre-release-check.mjs  (#118)
 *
 * Validates that the repository is in a consistent, release-ready state before
 * cutting a release. All checks are non-destructive (read-only).
 *
 * Checks performed
 * ────────────────
 * 1. VERSION_TAG_CONSISTENCY  — the version in package.json matches the most
 *    recent git tag of the form vX.Y.Z (or the tag passed via --expected-tag).
 * 2. CHANGELOG_PRESENCE       — CHANGELOG.md exists and contains an entry for
 *    the current version (a heading that includes the version string).
 * 3. CLEAN_GENERATED_OUTPUTS  — dist/ exists and is not empty; no uncommitted
 *    changes are present in dist/ (generated declarations must be committed).
 * 4. EXPECTED_EXPORTS_PRESENT — the exports map in package.json lists at least
 *    the required public entry points (".","./testing","./transaction",
 *    "./wallet","./account","./network","./soroban","./shared").
 *
 * Usage
 * ─────
 * node scripts/pre-release-check.mjs
 * node scripts/pre-release-check.mjs --expected-tag v1.2.0
 *
 * Exit codes
 * ──────────
 * 0  All checks passed.
 * 1  One or more checks failed (details printed to stdout).
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let expectedTagOverride = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--expected-tag" && args[i + 1]) {
    expectedTagOverride = args[i + 1];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function git(cmd) {
  try {
    return execSync(`git -C ${ROOT} ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function readJson(relPath) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8"));
  } catch {
    return null;
  }
}

function readText(relPath) {
  try {
    return readFileSync(resolve(ROOT, relPath), "utf8");
  } catch {
    return null;
  }
}

// ─── Findings ─────────────────────────────────────────────────────────────────

const passed = [];
const failed = [];

function pass(check, detail) {
  passed.push({ check, detail });
}

function fail(check, detail, action) {
  failed.push({ check, detail, action });
}

// ─── 1. VERSION_TAG_CONSISTENCY ───────────────────────────────────────────────

const pkg = readJson("package.json");
if (!pkg) {
  fail(
    "VERSION_TAG_CONSISTENCY",
    "Could not read package.json.",
    "Ensure package.json exists at the repository root.",
  );
} else {
  const pkgVersion = pkg.version;

  let referenceTag = expectedTagOverride;
  if (!referenceTag) {
    // Most recent semver tag reachable from HEAD
    referenceTag = git('describe --tags --match "v*" --abbrev=0 2>/dev/null');
  }

  if (!referenceTag) {
    fail(
      "VERSION_TAG_CONSISTENCY",
      `No semver git tag found. package.json version is "${pkgVersion}".`,
      `Create an annotated tag: git tag -a v${pkgVersion} -m "Release ${pkgVersion}" HEAD`,
    );
  } else {
    const tagVersion = referenceTag.replace(/^v/, "");
    if (pkgVersion !== tagVersion) {
      fail(
        "VERSION_TAG_CONSISTENCY",
        `package.json version "${pkgVersion}" does not match tag "${referenceTag}" (${tagVersion}).`,
        `Either update package.json to "${tagVersion}", or create a new tag for the current version: ` +
          `git tag -a v${pkgVersion} -m "Release ${pkgVersion}" HEAD`,
      );
    } else {
      pass("VERSION_TAG_CONSISTENCY", `package.json "${pkgVersion}" matches tag "${referenceTag}".`);
    }
  }
}

// ─── 2. CHANGELOG_PRESENCE ───────────────────────────────────────────────────

const changelog = readText("CHANGELOG.md");
const pkgVersion = pkg?.version;

if (!changelog) {
  fail(
    "CHANGELOG_PRESENCE",
    "CHANGELOG.md does not exist.",
    "Create CHANGELOG.md and add an entry for the current version.",
  );
} else if (!pkgVersion) {
  fail(
    "CHANGELOG_PRESENCE",
    "Cannot verify changelog — package.json version is unavailable.",
    "Ensure package.json has a valid 'version' field.",
  );
} else {
  // Look for the version string in a Markdown heading (## [X.Y.Z] or ## X.Y.Z)
  // The version is followed by ] or end-of-line to prevent "1.2.3" matching "1.2.30".
  const versionPattern = new RegExp(
    `##\\s+\\[?${pkgVersion.replace(/\./g, "\\.")}(?:[\\]\\s]|$)`,
    "m",
  );
  // Also accept "Unreleased" section which is common before tagging
  const hasUnreleased = /##\s+\[?unreleased/i.test(changelog);
  const hasVersionEntry = versionPattern.test(changelog);

  if (!hasVersionEntry && !hasUnreleased) {
    fail(
      "CHANGELOG_PRESENCE",
      `CHANGELOG.md has no entry for version "${pkgVersion}" and no [Unreleased] section.`,
      `Add a section to CHANGELOG.md:\n  ## [${pkgVersion}] - ${new Date().toISOString().slice(0, 10)}\n  ### Added\n  - ...`,
    );
  } else {
    const note = hasVersionEntry
      ? `entry for "${pkgVersion}" found`
      : `[Unreleased] section present (version "${pkgVersion}" not yet logged)`;
    pass("CHANGELOG_PRESENCE", `CHANGELOG.md ok — ${note}.`);
  }
}

// ─── 3. CLEAN_GENERATED_OUTPUTS ──────────────────────────────────────────────

const distPath = resolve(ROOT, "dist");
if (!existsSync(distPath)) {
  fail(
    "CLEAN_GENERATED_OUTPUTS",
    "dist/ directory does not exist.",
    "Run the build: npm run build",
  );
} else {
  const distEntries = readdirSync(distPath);
  if (distEntries.length === 0) {
    fail(
      "CLEAN_GENERATED_OUTPUTS",
      "dist/ directory is empty.",
      "Run the build: npm run build",
    );
  } else {
    // Check for uncommitted changes inside dist/
    const dirtyDist = git("status --porcelain dist/");
    if (dirtyDist) {
      fail(
        "CLEAN_GENERATED_OUTPUTS",
        `dist/ contains uncommitted changes:\n${dirtyDist}`,
        "Commit or stash the changes in dist/ before releasing, or rebuild and commit:\n  npm run build && git add dist/ && git commit -m 'chore: regenerate dist'",
      );
    } else {
      pass("CLEAN_GENERATED_OUTPUTS", `dist/ is present (${distEntries.length} entries) and clean.`);
    }
  }
}

// ─── 4. EXPECTED_EXPORTS_PRESENT ─────────────────────────────────────────────

const REQUIRED_EXPORTS = [
  ".",
  "./testing",
  "./transaction",
  "./wallet",
  "./account",
  "./network",
  "./soroban",
  "./shared",
];

if (!pkg) {
  fail(
    "EXPECTED_EXPORTS_PRESENT",
    "Cannot verify exports — package.json is unavailable.",
    "Ensure package.json exists at the repository root.",
  );
} else if (!pkg.exports || typeof pkg.exports !== "object") {
  fail(
    "EXPECTED_EXPORTS_PRESENT",
    "package.json has no 'exports' map.",
    `Add an 'exports' map covering at least: ${REQUIRED_EXPORTS.join(", ")}`,
  );
} else {
  const missing = REQUIRED_EXPORTS.filter((e) => !(e in pkg.exports));
  if (missing.length > 0) {
    fail(
      "EXPECTED_EXPORTS_PRESENT",
      `Missing required exports: ${missing.join(", ")}`,
      `Add the missing entries to the 'exports' map in package.json.`,
    );
  } else {
    pass("EXPECTED_EXPORTS_PRESENT", `All required exports present (${REQUIRED_EXPORTS.length} checked).`);
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

for (const { check, detail } of passed) {
  console.log(`✅  ${check}: ${detail}`);
}

if (failed.length === 0) {
  console.log("\n🚀  Pre-release check passed — the repository is release-ready.");
  process.exit(0);
}

console.log(`\n❌  Pre-release check found ${failed.length} issue(s):\n`);
for (const { check, detail, action } of failed) {
  console.log(`[${check}]`);
  console.log(`  Problem : ${detail}`);
  console.log(`  Action  : ${action}`);
  console.log();
}

process.exit(1);
