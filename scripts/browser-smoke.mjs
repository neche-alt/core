#!/usr/bin/env node
/**
 * Browser bundle smoke check script (#116).
 *
 * Usage: node scripts/browser-smoke.mjs
 *
 * Reads the compiled CJS bundle at dist/index.js and scans it for accidental
 * Node.js-only module requires. Exits 1 and prints each violation when any
 * are found, exits 0 when the bundle is clean.
 *
 * Run after `npm run build`.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, "..", "dist", "index.js");

/** Node.js-only patterns that must not appear in a browser bundle. */
const SERVER_ONLY_PATTERNS = [
  { pattern: /require\(['"]fs['"]\)/, label: "require('fs')" },
  { pattern: /require\(['"]path['"]\)/, label: "require('path')" },
  { pattern: /require\(['"]crypto['"]\)/, label: "require('crypto')" },
  { pattern: /require\(['"]os['"]\)/, label: "require('os')" },
  { pattern: /require\(['"]http['"]\)/, label: "require('http')" },
  { pattern: /require\(['"]https['"]\)/, label: "require('https')" },
  { pattern: /require\(['"]stream['"]\)/, label: "require('stream')" },
  { pattern: /require\(['"]buffer['"]\)/, label: "require('buffer') — use globalThis.Buffer" },
  { pattern: /require\(['"]child_process['"]\)/, label: "require('child_process')" },
  { pattern: /require\(['"]net['"]\)/, label: "require('net')" },
];

if (!existsSync(bundlePath)) {
  console.error(`[browser-smoke] Bundle not found at ${bundlePath}`);
  console.error("[browser-smoke] Run 'npm run build' first.");
  process.exit(1);
}

const bundleText = readFileSync(bundlePath, "utf8");
const violations = [];

for (const { pattern, label } of SERVER_ONLY_PATTERNS) {
  if (pattern.test(bundleText)) {
    violations.push(label);
  }
}

if (violations.length > 0) {
  console.error("[browser-smoke] FAIL — server-only imports found in browser bundle:");
  for (const v of violations) {
    console.error(`  ✗ ${v}`);
  }
  process.exit(1);
}

console.log("[browser-smoke] OK — no server-only imports detected in dist/index.js");
process.exit(0);
