#!/usr/bin/env node
/**
 * scripts/extract-i18n.mjs — i18n message key extractor (#139)
 *
 * Scans example component files for i18n.t() / i18n.translate() calls,
 * collects every message key, and emits a messages.en.json catalog next to
 * this script's output directory.
 *
 * Usage:
 *   node scripts/extract-i18n.mjs
 *
 * Exit codes:
 *   0  all keys found, catalog written
 *   1  one or more keys missing from EN_TRANSLATIONS (build fails)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");

// ── 1. Collect source files to scan ─────────────────────────────────────────

const SCAN_DIRS = [
  join(ROOT, "examples/react-wallet-connect/src"),
  join(ROOT, "examples/transaction-dashboard"),
];

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walk(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const files = SCAN_DIRS.flatMap((d) => {
  try {
    return walk(d);
  } catch {
    return [];
  }
});

// ── 2. Extract i18n.t("key") / i18n.translate("key") calls ──────────────────

const KEY_RE = /i18n\.(?:t|translate)\(\s*["']([^"']+)["']/g;
const extractedKeys = new Set();

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const [, key] of src.matchAll(KEY_RE)) {
    extractedKeys.add(key);
  }
}

if (extractedKeys.size === 0) {
  console.error("extract-i18n: no keys found — check that SCAN_DIRS point to the right paths.");
  process.exit(1);
}

// ── 3. Load EN_TRANSLATIONS from src/shared/i18n.ts via compiled output ─────
//    We read the TypeScript source directly with a simple regex rather than
//    requiring a build step, keeping the script self-contained.

const I18N_SRC = readFileSync(join(ROOT, "src/shared/i18n.ts"), "utf8");

// Extract every "key": "value" pair from EN_TRANSLATIONS.
const EN_RE = /^\s+"([^"]+)":\s+"([^"]+)"/gm;
const enCatalog = {};
for (const [, k, v] of I18N_SRC.matchAll(EN_RE)) {
  enCatalog[k] = v;
}

// ── 4. Check for missing keys ────────────────────────────────────────────────

const missingKeys = [...extractedKeys].filter((k) => !(k in enCatalog));

if (missingKeys.length > 0) {
  console.error("extract-i18n: the following keys are used in components but missing from EN_TRANSLATIONS:");
  for (const k of missingKeys) {
    console.error(`  missing: ${k}`);
  }
  console.error("\nAdd these keys to src/shared/i18n.ts before building.");
  process.exit(1);
}

// ── 5. Emit catalog ──────────────────────────────────────────────────────────

const catalog = {};
for (const key of [...extractedKeys].sort()) {
  catalog[key] = enCatalog[key];
}

const OUT_PATH = join(ROOT, "scripts/messages.en.json");
writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2) + "\n");

console.log(`extract-i18n: wrote ${Object.keys(catalog).length} keys to ${OUT_PATH}`);
console.log("Keys extracted:");
for (const key of Object.keys(catalog)) {
  console.log(`  ${key}`);
}
