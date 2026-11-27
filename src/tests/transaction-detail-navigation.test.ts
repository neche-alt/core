/**
 * Tests for transaction detail view navigation and accessibility (#103).
 *
 * Verifies:
 * - Sections are ordered correctly (summary first, verbose data last)
 * - Errors section appears only for failed transactions
 * - Raw XDR section appears only when XDR fields are present
 * - sectionLabel returns human-readable strings for every known section
 * - Boundary: unknown section key falls back gracefully
 */
import { describe, it, expect } from "vitest";
import {
  detailSections,
  sectionLabel,
} from "../../examples/transaction-dashboard/transaction-detail.example";
import type { DashboardTransactionEntry } from "../../src/transaction/transactionDashboard";

function makeEntry(
  overrides: Partial<DashboardTransactionEntry["tx"]> = {},
): DashboardTransactionEntry {
  return {
    tx: {
      hash: "TESTHASH001",
      status: "success",
      ...overrides,
    },
    category: "payment",
    ingestedAt: Date.now(),
  };
}

describe("detailSections (#103)", () => {
  it("summary and operations are always first", () => {
    const sections = detailSections(makeEntry());
    expect(sections[0]).toBe("summary");
    expect(sections[1]).toBe("operations");
  });

  it("logs section is always last", () => {
    const sections = detailSections(makeEntry());
    expect(sections[sections.length - 1]).toBe("logs");
  });

  it("errors section is included only for failed transactions", () => {
    const failSections = detailSections(makeEntry({ status: "failed" }));
    expect(failSections).toContain("errors");

    const successSections = detailSections(makeEntry({ status: "success" }));
    expect(successSections).not.toContain("errors");
  });

  it("raw section appears when envelopeXdr is present", () => {
    const sections = detailSections(makeEntry({ envelopeXdr: "AAAA..." }));
    expect(sections).toContain("raw");
  });

  it("raw section appears when resultXdr is present", () => {
    const sections = detailSections(makeEntry({ resultXdr: "AAAA..." }));
    expect(sections).toContain("raw");
  });

  it("raw section is absent when no XDR fields are set", () => {
    const sections = detailSections(makeEntry());
    expect(sections).not.toContain("raw");
  });

  it("errors section comes before logs for a failed tx with XDR", () => {
    const sections = detailSections(
      makeEntry({ status: "failed", resultXdr: "AAAA..." }),
    );
    const errorIdx = sections.indexOf("errors");
    const logsIdx = sections.indexOf("logs");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeLessThan(logsIdx);
  });
});

describe("sectionLabel (#103)", () => {
  it("returns human-readable labels for all known sections", () => {
    expect(sectionLabel("summary")).toBe("Summary");
    expect(sectionLabel("operations")).toBe("Operations");
    expect(sectionLabel("raw")).toBe("Raw XDR");
    expect(sectionLabel("errors")).toBe("Errors");
    expect(sectionLabel("logs")).toBe("Logs");
  });

  it("falls back to the raw key for unknown sections", () => {
    expect(sectionLabel("unknown_section")).toBe("unknown_section");
  });
});
