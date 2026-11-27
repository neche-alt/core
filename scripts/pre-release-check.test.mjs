/**
 * Tests for pre-release-check.mjs (#118)
 *
 * Uses Node's built-in `assert` — no test runner needed.
 * Run with: node scripts/pre-release-check.test.mjs
 */

import assert from "assert";

// ─── Helpers mirrored from the script (pure functions only) ──────────────────

function changelogHasVersionEntry(changelog, version) {
  const versionPattern = new RegExp(
    `##\\s+\\[?${version.replace(/\./g, "\\.")}(?:[\\]\\s]|$)`,
    "m",
  );
  const hasUnreleased = /##\s+\[?unreleased/i.test(changelog);
  const hasVersionEntry = versionPattern.test(changelog);
  return hasVersionEntry || hasUnreleased;
}

function checkVersionTagConsistency(pkgVersion, tagVersion) {
  if (!tagVersion) return { ok: false, reason: "no_tag" };
  if (pkgVersion !== tagVersion) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

function checkRequiredExports(exportsMap, required) {
  if (!exportsMap || typeof exportsMap !== "object") return required;
  return required.filter((e) => !(e in exportsMap));
}

// ─── VERSION_TAG_CONSISTENCY ─────────────────────────────────────────────────

assert.deepStrictEqual(
  checkVersionTagConsistency("1.2.3", "1.2.3"),
  { ok: true },
  "matching version and tag",
);
assert.deepStrictEqual(
  checkVersionTagConsistency("1.2.3", "1.2.4"),
  { ok: false, reason: "mismatch" },
  "version/tag mismatch",
);
assert.deepStrictEqual(
  checkVersionTagConsistency("1.2.3", null),
  { ok: false, reason: "no_tag" },
  "no tag present",
);
assert.deepStrictEqual(
  checkVersionTagConsistency("1.2.3", ""),
  { ok: false, reason: "no_tag" },
  "empty tag treated as absent",
);

// ─── CHANGELOG_PRESENCE ───────────────────────────────────────────────────────

// Exact version heading
assert.strictEqual(
  changelogHasVersionEntry("## [1.2.3]\n### Added\n- thing", "1.2.3"),
  true,
  "exact version heading in brackets",
);
// Without brackets
assert.strictEqual(
  changelogHasVersionEntry("## 1.2.3\n### Added\n- thing", "1.2.3"),
  true,
  "version heading without brackets",
);
// Unreleased section
assert.strictEqual(
  changelogHasVersionEntry("## [Unreleased]\n### Added\n- new feature", "1.2.3"),
  true,
  "[Unreleased] section accepted",
);
// No matching entry
assert.strictEqual(
  changelogHasVersionEntry("## [1.1.0]\n### Fixed\n- bug", "1.2.3"),
  false,
  "different version, no match",
);
// Empty changelog
assert.strictEqual(
  changelogHasVersionEntry("", "1.2.3"),
  false,
  "empty changelog fails",
);
// Partial match should NOT trigger (1.2.3 should not match 1.2.30)
assert.strictEqual(
  changelogHasVersionEntry("## [1.2.30]\n- something", "1.2.3"),
  false,
  "partial version match is rejected",
);

// ─── EXPECTED_EXPORTS_PRESENT ────────────────────────────────────────────────

const REQUIRED = [".", "./testing", "./transaction", "./wallet"];

// All present
assert.deepStrictEqual(
  checkRequiredExports({ ".": {}, "./testing": {}, "./transaction": {}, "./wallet": {} }, REQUIRED),
  [],
  "all exports present",
);
// One missing
assert.deepStrictEqual(
  checkRequiredExports({ ".": {}, "./testing": {}, "./transaction": {} }, REQUIRED),
  ["./wallet"],
  "detects missing export",
);
// Multiple missing
assert.deepStrictEqual(
  checkRequiredExports({ ".": {} }, REQUIRED),
  ["./testing", "./transaction", "./wallet"],
  "detects multiple missing exports",
);
// No exports map
assert.deepStrictEqual(
  checkRequiredExports(null, REQUIRED),
  REQUIRED,
  "null exports map — all are missing",
);
// Extra exports beyond required are fine
assert.deepStrictEqual(
  checkRequiredExports(
    { ".": {}, "./testing": {}, "./transaction": {}, "./wallet": {}, "./extra": {} },
    REQUIRED,
  ),
  [],
  "extra exports beyond required are ignored",
);

console.log("✅  pre-release-check.test.mjs — all assertions passed.");
