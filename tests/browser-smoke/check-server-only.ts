/**
 * Server-only dependency checker (#116).
 *
 * Scans a compiled bundle's text for Node.js-only module requires that must
 * not appear in a browser-safe bundle. Used by scripts/browser-smoke.mjs and
 * the focused Vitest test.
 */

/** Patterns that indicate a Node.js-only dependency in a browser bundle. */
const SERVER_ONLY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
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
  { pattern: /require\(['"]tls['"]\)/, label: "require('tls')" },
  { pattern: /require\(['"]dns['"]\)/, label: "require('dns')" },
];

/**
 * Scan `bundleText` for Node.js-only module imports.
 * Returns an array of human-readable violation strings (empty = clean).
 */
export function checkForServerOnlyImports(bundleText: string): string[] {
  const violations: string[] = [];
  for (const { pattern, label } of SERVER_ONLY_PATTERNS) {
    if (pattern.test(bundleText)) {
      violations.push(label);
    }
  }
  return violations;
}
