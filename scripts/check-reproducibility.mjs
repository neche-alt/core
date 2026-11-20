#!/usr/bin/env node
/**
 * Build artifact reproducibility check (#121).
 *
 * Records build-tool and runtime versions, runs the build twice, and compares
 * the SHA-256 hashes of key generated outputs. Any file that differs between
 * runs is flagged as nondeterministic.
 *
 * Usage:
 *   node scripts/check-reproducibility.mjs
 *
 * Exit code 0 = all checked artifacts match.
 * Exit code 1 = at least one artifact differs between runs.
 */

import { execSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const REPORT_PATH = join(ROOT, "build-reproducibility-report.json");

/**
 * File extensions compared between builds.
 * Source maps and declaration maps are excluded — they embed absolute paths
 * and are known nondeterministic (see KNOWN_NONDETERMINISTIC below).
 */
const CHECKED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".d.ts"]);

/**
 * Patterns that are known nondeterministic and intentionally excluded from
 * the comparison. Document any new entry with a reason.
 */
const KNOWN_NONDETERMINISTIC = [
  // Source maps embed absolute build-machine paths in the `sources` array.
  { pattern: /\.map$/, reason: "Source maps embed absolute filesystem paths from the build machine." },
  // tsup chunk names include a content hash that can differ across runs when
  // module evaluation order changes with parallel bundling.
  { pattern: /^chunk-[A-Z0-9]{8}\./, reason: "tsup content-hashed chunk filenames are order-dependent across parallel runs." },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function hashDir(dir) {
  const hashes = {};
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const rel = entry.parentPath
      ? join(entry.parentPath, entry.name).slice(dir.length + 1)
      : entry.name;
    if (!CHECKED_EXTENSIONS.has("." + rel.split(".").pop())) continue;
    if (KNOWN_NONDETERMINISTIC.some(({ pattern }) => pattern.test(rel))) continue;
    const content = readFileSync(join(dir, rel));
    hashes[rel] = createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

function versions() {
  function capture(cmd) {
    try { return execSync(cmd, { cwd: ROOT }).toString().trim(); } catch { return "unavailable"; }
  }
  return {
    node: process.version,
    npm: capture("npm --version"),
    typescript: capture("npx tsc --version"),
    tsup: capture("npx tsup --version"),
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== Build reproducibility check ===\n");

const env = versions();
console.log("Tool versions:");
for (const [k, v] of Object.entries(env)) console.log(`  ${k}: ${v}`);
console.log();

// First build
console.log("Build 1 of 2…");
run("npm run build --if-present");
const hashes1 = hashDir(DIST);

// Second build (clean first so artifacts don't carry over)
console.log("\nBuild 2 of 2 (clean rebuild)…");
rmSync(DIST, { recursive: true, force: true });
run("npm run build --if-present");
const hashes2 = hashDir(DIST);

// Compare
const allFiles = new Set([...Object.keys(hashes1), ...Object.keys(hashes2)]);
const mismatches = [];
const matches = [];

for (const file of allFiles) {
  if (hashes1[file] === hashes2[file]) {
    matches.push(file);
  } else {
    mismatches.push({ file, hash1: hashes1[file] ?? "(missing)", hash2: hashes2[file] ?? "(missing)" });
  }
}

// Report
const report = {
  versions: env,
  summary: {
    checked: allFiles.size,
    matching: matches.length,
    nondeterministic: mismatches.length,
  },
  knownNondeterministicExclusions: KNOWN_NONDETERMINISTIC.map(({ pattern, reason }) => ({
    pattern: pattern.toString(),
    reason,
  })),
  mismatches,
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\nReport written to build-reproducibility-report.json`);

if (mismatches.length > 0) {
  console.error(`\n✗ ${mismatches.length} artifact(s) differ between builds:`);
  for (const { file, hash1, hash2 } of mismatches) {
    console.error(`  ${file}`);
    console.error(`    build 1: ${hash1}`);
    console.error(`    build 2: ${hash2}`);
  }
  process.exit(1);
} else {
  console.log(`\n✓ All ${matches.length} checked artifacts match across both builds.`);
  process.exit(0);
}
