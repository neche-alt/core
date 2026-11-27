import { describe, expect, it } from "vitest";
import { formatDisplayAmount, formatDisplayAsset } from "./formatAmount";

// A Stellar issuer (G-key) is 56 chars; used to exercise abbreviation.
const ISSUER_56 = "G" + "A".repeat(55);
const SHORT_ISSUER = "GABCDEF"; // shorter than prefix*2 → shown in full

describe("formatDisplayAmount", () => {
  it("formats a plain decimal string without grouping by default", () => {
    expect(formatDisplayAmount("1234.5")).toBe("1234.5");
  });

  it("groups the integer part with thousands separators", () => {
    expect(formatDisplayAmount("1000000", { group: true })).toBe("1,000,000");
    expect(formatDisplayAmount("1234.5", { group: true })).toBe("1,234.5");
    expect(formatDisplayAmount("100", { group: true })).toBe("100");
  });

  it("preserves exact precision for values beyond Number.MAX_SAFE_INTEGER (no lossy conversion)", () => {
    // 20 integer digits — far beyond MAX_SAFE_INTEGER. Number() would round to 1e20.
    const large = "99999999999999999999.999999";
    const formatted = formatDisplayAmount(large, { decimals: 6 });
    expect(formatted).toBe("99999999999999999999.999999");
    expect(formatted).not.toBe(String(Number(large)));
  });

  it("truncates (not rounds) excess fractional digits", () => {
    expect(formatDisplayAmount("1.123456789", { decimals: 3 })).toBe("1.123");
    expect(formatDisplayAmount("1.9999", { decimals: 2 })).toBe("1.99");
  });

  it("trims trailing fractional zeros when requested", () => {
    expect(formatDisplayAmount("1.5000", { trim: true })).toBe("1.5");
    expect(formatDisplayAmount("1.0000", { trim: true })).toBe("1");
    expect(formatDisplayAmount("0.0000000", { trim: true })).toBe("0");
  });

  it("handles negative and zero values", () => {
    expect(formatDisplayAmount("0")).toBe("0");
    expect(formatDisplayAmount("-1234.5", { group: true })).toBe("-1,234.5");
    expect(formatDisplayAmount("-0.0001", { decimals: 7 })).toBe("-0.0001");
  });

  it("accepts bigint without lossy conversion", () => {
    expect(formatDisplayAmount(1234567890123456789n)).toBe("1234567890123456789");
  });

  it("accepts finite numbers", () => {
    expect(formatDisplayAmount(1234.5)).toBe("1234.5");
  });

  it("returns empty string for missing/empty/null input (never throws)", () => {
    expect(formatDisplayAmount(null)).toBe("");
    expect(formatDisplayAmount(undefined)).toBe("");
    expect(formatDisplayAmount("")).toBe("");
    expect(formatDisplayAmount("   ")).toBe("");
  });

  it("returns empty string for non-finite numbers and non-numeric input (never throws)", () => {
    expect(formatDisplayAmount(Number.NaN)).toBe("");
    expect(formatDisplayAmount(Number.POSITIVE_INFINITY)).toBe("");
    // Non-numeric strings are returned unchanged as a safe fallback.
    expect(formatDisplayAmount("abc")).toBe("abc");
    expect(formatDisplayAmount("1e9")).toBe("1e9");
    // Unsupported value types fall back to "".
    expect(formatDisplayAmount(true as unknown as string)).toBe("");
  });
});

describe("formatDisplayAsset", () => {
  it("labels the native asset", () => {
    const a = formatDisplayAsset({ assetType: "native", assetCode: "XLM", assetIssuer: null });
    expect(a).toEqual({ code: "XLM", known: true, label: "XLM (native)", issuer: null, type: "native" });
  });

  it("labels an issued asset with abbreviated issuer context", () => {
    const a = formatDisplayAsset({ assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: ISSUER_56 });
    expect(a.code).toBe("USDC");
    expect(a.known).toBe(true);
    expect(a.issuer).toBe(ISSUER_56);
    expect(a.label).toBe(`USDC · ${ISSUER_56.slice(0, 4)}…${ISSUER_56.slice(-4)}`);
  });

  it("shows the full issuer when fullIssuer is requested", () => {
    const a = formatDisplayAsset(
      { assetType: "credit_alphanum12", assetCode: "USDC", assetIssuer: ISSUER_56 },
      { fullIssuer: true },
    );
    expect(a.label).toBe(`USDC · ${ISSUER_56}`);
  });

  it("does not abbreviate short issuers", () => {
    const a = formatDisplayAsset(
      { assetType: "credit_alphanum4", assetCode: "TST", assetIssuer: SHORT_ISSUER },
      { issuerPrefix: 4 },
    );
    expect(a.label).toBe(`TST · ${SHORT_ISSUER}`);
  });

  it("omits issuer context when the issuer is null", () => {
    const a = formatDisplayAsset({ assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: null });
    expect(a.label).toBe("USDC");
  });

  it("labels liquidity-pool shares", () => {
    const a = formatDisplayAsset({ assetType: "liquidity_pool_shares", assetCode: "", assetIssuer: null });
    expect(a).toEqual({ code: "LP shares", known: true, label: "Liquidity pool shares", issuer: null, type: "liquidity_pool_shares" });
  });

  it("falls back for an issued asset missing its code", () => {
    const a = formatDisplayAsset({ assetType: "credit_alphanum4", assetCode: "", assetIssuer: ISSUER_56 });
    expect(a.code).toBe("Unknown asset");
    expect(a.known).toBe(false);
    expect(a.label).toBe(`Unknown asset · ${ISSUER_56.slice(0, 4)}…${ISSUER_56.slice(-4)}`);
  });

  it("falls back for an unknown asset type", () => {
    const a = formatDisplayAsset({ assetType: "weird", assetCode: "", assetIssuer: null });
    expect(a.code).toBe("Unknown asset");
    expect(a.known).toBe(false);
    expect(a.label).toBe("Unknown asset");
  });

  it("falls back for missing/absent input (never throws)", () => {
    const fallback = { code: "Unknown asset", known: false, label: "Unknown asset", issuer: null, type: "unknown" };
    expect(formatDisplayAsset(null)).toEqual(fallback);
    expect(formatDisplayAsset(undefined)).toEqual(fallback);
    expect(formatDisplayAsset({})).toEqual(fallback);
  });
});
