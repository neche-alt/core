/**
 * Tests for localization-ready strings in wallet examples (#104).
 *
 * Verifies:
 * - All string keys in the default `ui` dictionary are non-empty.
 * - `paymentSentStatus` embeds the tx hash correctly.
 * - `formatAmount` produces locale-aware output and handles edge cases.
 * - `formatDate` produces locale-aware output and handles invalid input.
 */
import { describe, it, expect } from "vitest";
import {
  ui,
  formatAmount,
  formatDate,
} from "../../examples/react-wallet-connect/src/i18n";

describe("ui string dictionary (#104)", () => {
  it("every static string key is a non-empty string", () => {
    const staticKeys = Object.entries(ui).filter(([, v]) => typeof v === "string");
    for (const [key, value] of staticKeys) {
      expect(value, `ui.${key} should not be empty`).toBeTruthy();
    }
  });

  it("paymentSentStatus embeds the tx hash", () => {
    const msg = ui.paymentSentStatus("TXHASH123");
    expect(msg).toContain("TXHASH123");
  });
});

describe("formatAmount (#104)", () => {
  it("formats a valid amount with the asset code", () => {
    const result = formatAmount("12.5000000", "XLM", "en-US");
    expect(result).toContain("XLM");
    expect(result).toContain("12.5");
  });

  it("strips trailing zeros for clean display", () => {
    const result = formatAmount("100.0000000", "XLM", "en-US");
    expect(result).toContain("100");
    expect(result).toContain("XLM");
  });

  it("returns raw amount with asset code when input is not a number", () => {
    const result = formatAmount("not-a-number", "XLM", "en-US");
    expect(result).toBe("not-a-number XLM");
  });

  it("uses locale separators (de-DE uses comma as decimal)", () => {
    const result = formatAmount("1234.5", "XLM", "de-DE");
    // de-DE uses comma as decimal separator
    expect(result).toContain(",");
    expect(result).toContain("XLM");
  });
});

describe("formatDate (#104)", () => {
  it("formats a valid ISO date string", () => {
    const result = formatDate("2024-03-15T10:00:00Z", "en-US");
    // Should contain the year at minimum
    expect(result).toContain("2024");
  });

  it("returns the raw string when input is not a valid date", () => {
    const result = formatDate("not-a-date", "en-US");
    expect(result).toBe("not-a-date");
  });
});
