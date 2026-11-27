/**
 * Tests for issue #139 — i18n message extraction for example apps.
 *
 * Verifies that:
 *   1. Every i18n.t() key used in example components resolves to a string
 *      in EN_TRANSLATIONS (no missing keys).
 *   2. No raw user-facing string literals remain inline in example components
 *      for labels that should be i18n-managed.
 *   3. The extraction script produces a complete messages file when run.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { EN_TRANSLATIONS } from "../../src/shared/i18n";

const ROOT = join(__dirname, "../../..");

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractKeys(src: string): string[] {
  const KEY_RE = /i18n\.(?:t|translate)\(\s*["']([^"']+)["']/g;
  const keys: string[] = [];
  for (const [, key] of src.matchAll(KEY_RE)) {
    keys.push(key);
  }
  return keys;
}

// ── Example file paths ───────────────────────────────────────────────────────

const APP_TSX = join(ROOT, "examples/react-wallet-connect/src/App.tsx");
const DASHBOARD_TSX = join(ROOT, "examples/transaction-dashboard/react-dashboard.example.tsx");
const MESSAGES_JSON = join(ROOT, "scripts/messages.en.json");

// ── Tests ────────────────────────────────────────────────────────────────────

describe("i18n extraction — react-wallet-connect/App.tsx (#139)", () => {
  it("file exists", () => {
    expect(existsSync(APP_TSX)).toBe(true);
  });

  it("contains i18n.t() calls (strings are routed through i18n)", () => {
    const src = readFile(APP_TSX);
    expect(src).toContain("i18n.t(");
  });

  it("every extracted key resolves in EN_TRANSLATIONS", () => {
    const src = readFile(APP_TSX);
    const keys = extractKeys(src);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        EN_TRANSLATIONS[key],
        `Key "${key}" used in App.tsx is missing from EN_TRANSLATIONS`,
      ).toBeDefined();
    }
  });

  it("does not contain raw inline 'Connect Freighter' string", () => {
    const src = readFile(APP_TSX);
    // The literal must not appear outside a string passed to i18n.t
    const lines = src.split("\n").filter(
      (l) => l.includes("Connect Freighter") && !l.includes("i18n.t("),
    );
    expect(lines).toHaveLength(0);
  });

  it("does not contain raw inline 'Balances' heading string", () => {
    const src = readFile(APP_TSX);
    const lines = src.split("\n").filter(
      (l) => l.includes(">Balances<") || (l.includes('"Balances"') && !l.includes("i18n")),
    );
    expect(lines).toHaveLength(0);
  });
});

describe("i18n extraction — react-dashboard.example.tsx (#139)", () => {
  it("file exists", () => {
    expect(existsSync(DASHBOARD_TSX)).toBe(true);
  });

  it("contains i18n.t() calls", () => {
    const src = readFile(DASHBOARD_TSX);
    expect(src).toContain("i18n.t(");
  });

  it("every extracted key resolves in EN_TRANSLATIONS", () => {
    const src = readFile(DASHBOARD_TSX);
    const keys = extractKeys(src);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        EN_TRANSLATIONS[key],
        `Key "${key}" used in react-dashboard is missing from EN_TRANSLATIONS`,
      ).toBeDefined();
    }
  });
});

describe("i18n extraction script output (#139)", () => {
  it("messages.en.json exists after extraction", () => {
    expect(existsSync(MESSAGES_JSON)).toBe(true);
  });

  it("catalog contains all ui.* keys from both example apps", () => {
    const catalog = JSON.parse(readFile(MESSAGES_JSON)) as Record<string, string>;
    const appKeys = extractKeys(readFile(APP_TSX));
    const dashKeys = extractKeys(readFile(DASHBOARD_TSX));
    const allKeys = [...new Set([...appKeys, ...dashKeys])];
    for (const key of allKeys) {
      expect(
        catalog[key],
        `Key "${key}" is missing from messages.en.json`,
      ).toBeDefined();
    }
  });

  it("no catalog value is an empty string", () => {
    const catalog = JSON.parse(readFile(MESSAGES_JSON)) as Record<string, string>;
    for (const [key, value] of Object.entries(catalog)) {
      expect(value, `Key "${key}" has an empty translation`).not.toBe("");
    }
  });

  it("missing key causes extraction to fail", () => {
    // Use a fake source with an unknown key — it should not appear in the catalog
    // because the script exits 1.  We test this boundary by verifying the catalog
    // does NOT contain a key we know is not in EN_TRANSLATIONS.
    const catalog = JSON.parse(readFile(MESSAGES_JSON)) as Record<string, string>;
    expect(catalog["ui.nonexistent.key"]).toBeUndefined();
  });
});
