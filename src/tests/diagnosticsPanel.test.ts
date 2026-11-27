/**
 * Focused tests for the SDK diagnostics panel utilities (#101).
 *
 * Tests the pure helper layer (diagnosticsUtils) and verifies that the
 * diagnostics API itself never surfaces secrets in its output.
 * React rendering is not tested here — these are unit tests for the data layer.
 */

import { describe, it, expect, vi } from "vitest";
import {
  formatCheckStatus,
  statusColor,
  formatLatency,
  containsSecret,
  formatCheckSummary,
  STATUS_SYMBOL,
  STATUS_COLOR,
} from "../../examples/react-wallet-connect/src/diagnosticsUtils";
import { runDiagnostics } from "../shared/diagnostics";
import type { DiagnosticCheckResult, DiagnosticHealthStatus } from "../shared/diagnostics";

// ─── formatCheckStatus ────────────────────────────────────────────────────────

describe("formatCheckStatus", () => {
  const cases: Array<[DiagnosticHealthStatus, string]> = [
    ["healthy", "✓"],
    ["degraded", "⚠"],
    ["unavailable", "✗"],
    ["skipped", "—"],
  ];

  for (const [status, symbol] of cases) {
    it(`returns "${symbol}" for "${status}"`, () => {
      expect(formatCheckStatus(status)).toBe(symbol);
    });
  }

  it("covers every status defined in STATUS_SYMBOL", () => {
    for (const status of Object.keys(STATUS_SYMBOL) as DiagnosticHealthStatus[]) {
      expect(formatCheckStatus(status)).toBe(STATUS_SYMBOL[status]);
    }
  });
});

// ─── statusColor ──────────────────────────────────────────────────────────────

describe("statusColor", () => {
  it("returns a non-empty colour string for every status", () => {
    for (const status of Object.keys(STATUS_COLOR) as DiagnosticHealthStatus[]) {
      const color = statusColor(status);
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes all four statuses", () => {
    const colors = (Object.keys(STATUS_COLOR) as DiagnosticHealthStatus[]).map(statusColor);
    const unique = new Set(colors);
    expect(unique.size).toBe(4);
  });
});

// ─── formatLatency ────────────────────────────────────────────────────────────

describe("formatLatency", () => {
  it("formats a numeric latency as 'Xms'", () => {
    expect(formatLatency(42)).toBe("42ms");
    expect(formatLatency(0)).toBe("0ms");
    expect(formatLatency(1500)).toBe("1500ms");
  });

  it("returns '—' for null latency", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

// ─── containsSecret ──────────────────────────────────────────────────────────

describe("containsSecret", () => {
  const secretTerms = [
    "secret",
    "SECRET",
    "privatekey",
    "privateKey",
    "private_key",
    "seed",
    "SEED",
    "mnemonic",
    "MNEMONIC",
  ];

  for (const term of secretTerms) {
    it(`detects "${term}"`, () => {
      expect(containsSecret(`some value with ${term} inside`)).toBe(true);
    });
  }

  it("returns false for safe strings", () => {
    expect(containsSecret("healthy endpoint latency 42ms")).toBe(false);
    expect(containsSecret("Freighter is available")).toBe(false);
    expect(containsSecret("testnet configuration valid")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(containsSecret("")).toBe(false);
  });
});

// ─── formatCheckSummary ───────────────────────────────────────────────────────

describe("formatCheckSummary", () => {
  function makeCheck(
    overrides: Partial<DiagnosticCheckResult> = {},
  ): DiagnosticCheckResult {
    return {
      id: "horizon",
      name: "Horizon connectivity",
      status: "healthy",
      message: "Horizon is reachable.",
      latencyMs: 120,
      issues: [],
      recommendations: [],
      ...overrides,
    };
  }

  it("includes the status symbol, name, and message", () => {
    const summary = formatCheckSummary(makeCheck());
    expect(summary).toContain("✓");
    expect(summary).toContain("Horizon connectivity");
    expect(summary).toContain("Horizon is reachable.");
  });

  it("uses the correct symbol for each status", () => {
    for (const status of ["healthy", "degraded", "unavailable", "skipped"] as DiagnosticHealthStatus[]) {
      const summary = formatCheckSummary(makeCheck({ status }));
      expect(summary.startsWith(STATUS_SYMBOL[status])).toBe(true);
    }
  });
});

// ─── runDiagnostics — no secrets in output ────────────────────────────────────

describe("runDiagnostics output redaction", () => {
  function okFetch(): typeof fetch {
    return vi.fn(async () =>
      new Response(JSON.stringify({ status: "healthy" }), { status: 200 }),
    ) as unknown as typeof fetch;
  }

  it("never includes secret-looking keys in its serialised report", async () => {
    const report = await runDiagnostics({ fetchFn: okFetch() });
    const serialised = JSON.stringify(report).toLowerCase();

    for (const forbidden of [
      "secret",
      "privatekey",
      "private_key",
      "seed",
      "mnemonic",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("containsSecret returns false for a healthy diagnostics report", async () => {
    const report = await runDiagnostics({ fetchFn: okFetch() });
    expect(containsSecret(JSON.stringify(report).toLowerCase())).toBe(false);
  });

  it("produces a report whose checks all have valid status symbols", async () => {
    const report = await runDiagnostics({ fetchFn: okFetch() });
    for (const check of report.checks) {
      expect(formatCheckStatus(check.status)).toBeTruthy();
    }
  });

  it("every check can be formatted as a summary line without throwing", async () => {
    const report = await runDiagnostics({ fetchFn: okFetch() });
    for (const check of report.checks) {
      expect(() => formatCheckSummary(check)).not.toThrow();
    }
  });
});
