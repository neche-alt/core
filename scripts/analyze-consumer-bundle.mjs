#!/usr/bin/env node
/**
 * Consumer bundle analyzer for the vite-minimal example.
 *
 * Builds examples/vite-minimal with Vite and verifies that wallet adapter
 * symbols are absent from the production output.  Importing only
 * sorokit-core/transaction and sorokit-core/network must not pull in
 * freighter, xbull, lobstr, WalletConnect, or any other wallet-adapter code.
 *
 * Usage:
 *   node scripts/analyze-consumer-bundle.mjs          # report only
 *   node scripts/analyze-consumer-bundle.mjs --ci     # exit 1 on violations
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const EXAMPLE_DIR = join(ROOT, "examples", "vite-minimal");
const DIST_ASSETS = join(EXAMPLE_DIR, "dist", "assets");
const CI = process.argv.includes("--ci");

/**
 * Wallet-adapter symbols that must NOT survive tree-shaking when only
 * sorokit-core/transaction and sorokit-core/network are imported.
 */
const FORBIDDEN = [
  "discoverAvailableWallets",
  "connectWallet",
  "disconnectWallet",
  "walletAdapters",
  "freighter",
  "xbull",
  "lobstr",
  "WalletConnect",
];

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

// ── 1. Build ──────────────────────────────────────────────────────────────────

console.log("\n📦  Installing dependencies in examples/vite-minimal…");
run("npm install --legacy-peer-deps --no-fund", EXAMPLE_DIR);

console.log("🔨  Building examples/vite-minimal…");
run("npm run build", EXAMPLE_DIR);
console.log("✅  Build complete.\n");

// ── 2. Read bundle files ──────────────────────────────────────────────────────

let files;
try {
  files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`❌  Build output not found at ${DIST_ASSETS}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error("❌  No JS files found in dist/assets — build may have failed.");
  process.exit(1);
}

// ── 3. Analyze ────────────────────────────────────────────────────────────────

console.log("🔍  Analyzing bundle for tree-shaking violations…\n");

const violations = [];
let totalBytes = 0;

for (const file of files) {
  const fullPath = join(DIST_ASSETS, file);
  const content = readFileSync(fullPath, "utf8");
  const size = statSync(fullPath).size;
  totalBytes += size;

  const fileViolations = FORBIDDEN.filter((sym) => content.includes(sym));
  const mark = fileViolations.length > 0 ? "❌" : "✅";
  console.log(`  ${mark} ${file}  (${fmt(size)})`);

  for (const sym of fileViolations) {
    console.log(`       forbidden symbol found: "${sym}"`);
    violations.push({ file, sym });
  }
}

console.log(`\n  Total bundle size: ${fmt(totalBytes)}\n`);

// ── 4. Report ─────────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log(
    "✅  Tree-shaking verified: no wallet adapter code found in the bundle.\n" +
    "    Importing only sorokit-core/transaction and sorokit-core/network\n" +
    "    produces a clean bundle with no wallet adapters.\n",
  );
  process.exit(0);
}

console.error(
  `❌  Tree-shaking violations (${violations.length}):\n`,
);
for (const { file, sym } of violations) {
  console.error(`    ${file}: "${sym}"`);
}
console.error(
  "\n    Wallet adapter code leaked into the consumer bundle.\n" +
  "    Trace the import in sorokit-core/transaction or sorokit-core/network\n" +
  "    that transitively re-exports wallet adapter symbols and remove it.\n",
);

if (CI) process.exit(1);
