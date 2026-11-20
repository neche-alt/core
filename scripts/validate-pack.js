#!/usr/bin/env node
/**
 * npm package dry-run validation (#110).
 *
 * Runs `npm pack --dry-run --json` and asserts that all declared subpath
 * exports, entry points, and package metadata are present before publishing.
 *
 * Usage:  node scripts/validate-pack.js
 */
"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

// ── 1. Metadata checks ───────────────────────────────────────────────────────
const metaErrors = [];
if (pkg.name !== "sorokit-core") metaErrors.push(`name should be "sorokit-core", got "${pkg.name}"`);
if (!pkg.version || pkg.version.trim() === "") metaErrors.push("version is missing or empty");
if (pkg.main !== "./dist/index.js") metaErrors.push(`main should be "./dist/index.js", got "${pkg.main}"`);
if (pkg.types !== "./dist/index.d.ts") metaErrors.push(`types should be "./dist/index.d.ts", got "${pkg.types}"`);

if (metaErrors.length) {
  console.error("❌ Package metadata errors:");
  for (const e of metaErrors) console.error("   •", e);
  process.exit(1);
}
console.log("✅ Package metadata looks correct.");

// ── 2. Run dry-run pack ───────────────────────────────────────────────────────
let packOutput;
try {
  const raw = execSync("npm pack --dry-run --json 2>/dev/null", {
    cwd: root,
    encoding: "utf8",
  });
  packOutput = JSON.parse(raw);
} catch (e) {
  console.error("❌ npm pack --dry-run failed:", e.message);
  process.exit(1);
}

// npm pack --json returns an array; take the first entry.
const packEntry = Array.isArray(packOutput) ? packOutput[0] : packOutput;
const packedFiles = new Set(
  (packEntry.files || []).map((f) => (typeof f === "string" ? f : f.path).replace(/^package\//, ""))
);

// ── 3. Required entry-point files ────────────────────────────────────────────
const requiredFiles = [
  "dist/index.js",
  "dist/index.mjs",
  "dist/index.d.ts",
  "dist/testing/index.js",
  "dist/testing/index.mjs",
  "dist/core.js",
  "dist/core.mjs",
  "dist/wallet/index.js",
  "dist/wallet/index.mjs",
  "dist/transaction/index.js",
  "dist/transaction/index.mjs",
  "package.json",
  "README.md",
];

let failed = false;

console.log("\nValidating required files in pack output…");
for (const file of requiredFiles) {
  if (packedFiles.has(file)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.error(`  ❌ Missing from pack: ${file}`);
    failed = true;
  }
}

// ── 4. Subpath export coverage ───────────────────────────────────────────────
console.log("\nValidating subpath export coverage…");
const exports = pkg.exports || {};
for (const [subpath, conditions] of Object.entries(exports)) {
  const label = subpath === "." ? "main" : subpath;
  for (const [condition, filePath] of Object.entries(conditions)) {
    if (condition === "types" || condition === "import" || condition === "require") {
      // Strip leading "./"
      const rel = filePath.replace(/^\.\//, "");
      if (packedFiles.has(rel)) {
        console.log(`  ✅ ${label} [${condition}] → ${rel}`);
      } else {
        console.error(`  ❌ ${label} [${condition}] → ${rel} not in pack`);
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error("\n❌ Pack validation failed — fix missing files before publishing.");
  process.exit(1);
} else {
  console.log("\n✨ Pack validation passed — tarball is ready to publish.");
  process.exit(0);
}
