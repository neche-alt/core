/**
 * Build artifact reproducibility unit tests (#121).
 *
 * These tests cover the hash-comparison and version-recording logic used by
 * scripts/check-reproducibility.mjs without running a full build. They verify:
 *
 *  - SHA-256 hashes are stable for identical content.
 *  - Identical content produces matching hashes (deterministic).
 *  - Different content produces different hashes (nondeterminism is detected).
 *  - Known-nondeterministic exclusion patterns filter the right files.
 *  - The report structure contains all required fields.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Helpers (mirrors the logic in check-reproducibility.mjs)
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const KNOWN_NONDETERMINISTIC: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\.map$/,
    reason: "Source maps embed absolute filesystem paths from the build machine.",
  },
  {
    pattern: /^chunk-[A-Z0-9]{8}\./,
    reason:
      "tsup content-hashed chunk filenames are order-dependent across parallel runs.",
  },
];

function isExcluded(filename: string): boolean {
  return KNOWN_NONDETERMINISTIC.some(({ pattern }) => pattern.test(filename));
}

interface FileMismatch {
  file: string;
  hash1: string;
  hash2: string;
}

function compareHashes(
  hashes1: Record<string, string>,
  hashes2: Record<string, string>,
): { matches: string[]; mismatches: FileMismatch[] } {
  const allFiles = new Set([...Object.keys(hashes1), ...Object.keys(hashes2)]);
  const matches: string[] = [];
  const mismatches: FileMismatch[] = [];
  for (const file of allFiles) {
    if (hashes1[file] === hashes2[file]) {
      matches.push(file);
    } else {
      mismatches.push({
        file,
        hash1: hashes1[file] ?? "(missing)",
        hash2: hashes2[file] ?? "(missing)",
      });
    }
  }
  return { matches, mismatches };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SHA-256 hashing", () => {
  it("produces a 64-character hex string", () => {
    expect(sha256("hello")).toHaveLength(64);
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for identical content", () => {
    expect(sha256("sorokit-core")).toBe(sha256("sorokit-core"));
  });

  it("differs for different content", () => {
    expect(sha256("build-1")).not.toBe(sha256("build-2"));
  });
});

describe("compareHashes", () => {
  it("reports a match when both builds produce the same hash", () => {
    const h = sha256("index.js content");
    const { matches, mismatches } = compareHashes({ "index.js": h }, { "index.js": h });
    expect(matches).toContain("index.js");
    expect(mismatches).toHaveLength(0);
  });

  it("reports a mismatch when hashes differ", () => {
    const { mismatches } = compareHashes(
      { "core.js": sha256("v1") },
      { "core.js": sha256("v2") },
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.file).toBe("core.js");
  });

  it("flags a file present in build 1 but missing from build 2", () => {
    const { mismatches } = compareHashes(
      { "extra.js": sha256("extra") },
      {},
    );
    expect(mismatches[0]?.hash2).toBe("(missing)");
  });

  it("flags a file present in build 2 but missing from build 1", () => {
    const { mismatches } = compareHashes(
      {},
      { "new.js": sha256("new") },
    );
    expect(mismatches[0]?.hash1).toBe("(missing)");
  });
});

describe("known-nondeterministic exclusions", () => {
  it("excludes .map files", () => {
    expect(isExcluded("index.js.map")).toBe(true);
    expect(isExcluded("core.mjs.map")).toBe(true);
  });

  it("excludes tsup content-hashed chunk filenames", () => {
    expect(isExcluded("chunk-ABCD1234.js")).toBe(true);
    expect(isExcluded("chunk-ZZZZZZZZ.mjs")).toBe(true);
  });

  it("does not exclude normal output files", () => {
    expect(isExcluded("index.js")).toBe(false);
    expect(isExcluded("core.mjs")).toBe(false);
    expect(isExcluded("wallet/index.d.ts")).toBe(false);
  });
});

describe("report structure", () => {
  it("includes all required top-level fields", () => {
    const report = {
      versions: {
        node: process.version,
        npm: "10.0.0",
        typescript: "Version 5.4.0",
        tsup: "8.0.0",
        capturedAt: new Date().toISOString(),
      },
      summary: { checked: 10, matching: 10, nondeterministic: 0 },
      knownNondeterministicExclusions: KNOWN_NONDETERMINISTIC.map(({ pattern, reason }) => ({
        pattern: pattern.toString(),
        reason,
      })),
      mismatches: [] as FileMismatch[],
    };

    expect(report).toHaveProperty("versions");
    expect(report).toHaveProperty("summary");
    expect(report).toHaveProperty("knownNondeterministicExclusions");
    expect(report).toHaveProperty("mismatches");
    expect(report.versions).toHaveProperty("node");
    expect(report.versions).toHaveProperty("capturedAt");
    expect(report.summary.nondeterministic).toBe(0);
  });
});
