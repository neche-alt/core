#!/usr/bin/env node
/**
 * Guard script: fail when "use client" files import server-only SDK modules.
 *
 * Usage:
 *   node scripts/check-client-boundary.mjs [example-dir]
 *
 * Default target: examples/next-app-router/src
 *
 * Exits 1 if any "use client" file imports:
 *   - signTransactionOffline
 *   - keyManagement
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");

const targetDir = process.argv[2]
  ? join(root, process.argv[2])
  : join(root, "examples", "next-app-router", "src");

const SERVER_ONLY_PATTERNS = [
  /signTransactionOffline/,
  /security\/keyManagement/,
  /keyManagement/,
];

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && entry !== "node_modules" && entry !== ".next") {
      files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(targetDir);
const violations = [];

for (const file of files) {
  const src = readFileSync(file, "utf-8");
  const lines = src.split("\n");

  // Only check files with "use client" directive (first non-empty line or within first 3 lines)
  const firstLines = lines.slice(0, 5).join("\n");
  if (!firstLines.includes('"use client"') && !firstLines.includes("'use client'")) {
    continue;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines
    if (/^\s*(\/\/|\/\*)/.test(line)) continue;
    for (const pattern of SERVER_ONLY_PATTERNS) {
      if (pattern.test(line) && /import/.test(line)) {
        violations.push({
          file: relative(root, file),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "\n❌  Server-only module(s) imported in \"use client\" file(s):\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}\n`);
  }
  console.error(
    "These modules use Node.js APIs (crypto, BIP39) and must never reach the browser bundle.",
  );
  console.error(
    "Move signing/key logic into a Route Handler (app/api/*/route.ts) or a Server Action.\n",
  );
  process.exit(1);
} else {
  console.log("✅  Client bundle boundary check passed — no server-only imports in client components.");
  process.exit(0);
}
