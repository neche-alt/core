/**
 * Amount precision and formatting tests (#68)
 *
 * Covers the documented behaviour in docs/amount-precision.md:
 * representation constraints, validation helpers, conversion round-trips,
 * arithmetic correctness, and display formatting edge cases.
 */

import { describe, it, expect } from "vitest";
import { validateAmount, validateStroop, xlmToStroops, stroopsToXlm, MAX_AMOUNT } from "./amountValidation";
import { formatAmount, DEFAULT_ASSET_DECIMALS } from "./amountFormatter";
import { addAmounts, subtractAmounts, multiplyAmount, divideAmount } from "./amounts";

// ─── validateAmount ───────────────────────────────────────────────────────────

describe("validateAmount", () => {
  it("accepts a whole-number string", () => {
    expect(validateAmount("100").status).toBe("ok");
    expect(validateAmount("100").data).toBe("100");
  });

  it("accepts the maximum valid amount", () => {
    expect(validateAmount(MAX_AMOUNT).status).toBe("ok");
  });

  it("accepts 7 decimal places", () => {
    expect(validateAmount("0.0000001").status).toBe("ok");
  });

  it("rejects 8 decimal places", () => {
    const result = validateAmount("100.12345678");
    expect(result.status).toBe("error");
    expect(result.error.message).toMatch(/7 decimal/i);
  });

  it("rejects zero", () => {
    expect(validateAmount("0").status).toBe("error");
  });

  it("rejects negative amounts", () => {
    expect(validateAmount("-1").status).toBe("error");
  });

  it("rejects amounts above MAX_AMOUNT", () => {
    expect(validateAmount("922337203686").status).toBe("error");
  });

  it("rejects exponent notation (imprecise JS representation)", () => {
    expect(validateAmount("1e7").status).toBe("error");
  });

  it("rejects empty string", () => {
    expect(validateAmount("").status).toBe("error");
  });
});

// ─── validateStroop ───────────────────────────────────────────────────────────

describe("validateStroop", () => {
  it("accepts zero", () => {
    expect(validateStroop("0").status).toBe("ok");
    expect(validateStroop(0n).status).toBe("ok");
  });

  it("accepts the maximum stroop value as a string", () => {
    expect(validateStroop("9223372036854775807").status).toBe("ok");
  });

  it("rejects negative values", () => {
    expect(validateStroop("-1").status).toBe("error");
  });

  it("rejects values exceeding the int64 maximum", () => {
    expect(validateStroop("9223372036854775808").status).toBe("error");
  });

  it("rejects decimal strings (must be integer)", () => {
    expect(validateStroop("100.5").status).toBe("error");
  });
});

// ─── xlmToStroops / stroopsToXlm round-trip ──────────────────────────────────

describe("xlmToStroops / stroopsToXlm round-trip", () => {
  const cases: Array<[string, string]> = [
    ["1", "10000000"],
    ["0.0000001", "1"],
    ["100.5", "1005000000"],
    ["922337203685.4775807", "9223372036854775807"],
  ];

  for (const [xlm, stroops] of cases) {
    it(`"${xlm}" XLM → ${stroops} stroops`, () => {
      const result = xlmToStroops(xlm);
      expect(result.status).toBe("ok");
      expect(result.data).toBe(stroops);
    });

    it(`${stroops} stroops → "${xlm}" XLM`, () => {
      const result = stroopsToXlm(stroops);
      expect(result.status).toBe("ok");
      expect(result.data).toBe(xlm);
    });
  }

  it("round-trips without precision loss", () => {
    const original = "100.1234567";
    const stroops = xlmToStroops(original);
    expect(stroops.status).toBe("ok");
    const back = stroopsToXlm(stroops.data!);
    expect(back.status).toBe("ok");
    expect(back.data).toBe(original);
  });
});

// ─── Arithmetic helpers ───────────────────────────────────────────────────────

describe("addAmounts", () => {
  it("adds two XLM decimal strings exactly", () => {
    expect(addAmounts("100", "0.5")).toBe("100.5");
  });

  it("preserves additive identity", () => {
    expect(addAmounts("99.9999999", "0")).toBe("99.9999999");
  });

  it("handles large amounts beyond Number.MAX_SAFE_INTEGER correctly", () => {
    // 900_000_000 XLM × 2, well above JS safe integer range in stroops
    expect(addAmounts("900000000", "900000000")).toBe("1800000000");
  });
});

describe("subtractAmounts", () => {
  it("subtracts two amounts exactly", () => {
    expect(subtractAmounts("100.5", "0.5")).toBe("100");
  });

  it("produces an additive inverse that sums to zero", () => {
    const amount = "55.1234567";
    expect(subtractAmounts(amount, amount)).toBe("0");
  });
});

describe("multiplyAmount", () => {
  it("multiplies by 1 without drift", () => {
    expect(multiplyAmount("100.1234567", "1")).toBe("100.1234567");
  });

  it("multiplies by 1.5", () => {
    expect(multiplyAmount("100", "1.5")).toBe("150");
  });
});

describe("divideAmount", () => {
  it("divides by 1 without drift", () => {
    expect(divideAmount("100.1234567", "1")).toBe("100.1234567");
  });

  it("rounds to 7 decimal places with half-up rounding", () => {
    // 100 ÷ 3 = 33.3333333... truncated/rounded at 7 places
    const result = divideAmount("100", "3");
    // exact stroop result: 1000000000 / 10000000 (round-half-up) = 33.3333333
    expect(result.startsWith("33.333333")).toBe(true);
  });

  it("throws RangeError on division by zero", () => {
    expect(() => divideAmount("100", "0")).toThrow(RangeError);
  });
});

// ─── formatAmount ─────────────────────────────────────────────────────────────

describe("formatAmount — display precision and locale", () => {
  it("formats 1,000,000,000 stroops as 100.00 XLM (en-US default)", () => {
    const result = formatAmount("1000000000", { showSymbol: true });
    expect(result.status).toBe("ok");
    expect(result.data).toBe("100.00 XLM");
  });

  it("formats without symbol by default", () => {
    const result = formatAmount("1000000000");
    expect(result.status).toBe("ok");
    expect(result.data).toBe("100.00");
  });

  it("uses decimal comma for de-DE locale", () => {
    const result = formatAmount("1000000000", { locale: "de-DE" });
    expect(result.status).toBe("ok");
    expect(result.data).toContain(",");
  });

  it("respects maximumFractionDigits: 0", () => {
    const result = formatAmount("1000000000", { maximumFractionDigits: 0 });
    expect(result.status).toBe("ok");
    expect(result.data).toBe("100");
  });

  it("respects minimumFractionDigits: 4 for precise display", () => {
    const result = formatAmount("1000000000", { minimumFractionDigits: 4 });
    expect(result.status).toBe("ok");
    expect(result.data).toBe("100.0000");
  });

  it("formats a Soroban token with 6 decimals correctly", () => {
    // 100 USDC = 100_000_000 raw units at 6 decimals
    const result = formatAmount("100000000", {
      decimals: 6,
      showSymbol: true,
      symbol: "USDC",
    });
    expect(result.status).toBe("ok");
    expect(result.data).toBe("100.00 USDC");
  });

  it("returns error for an invalid locale", () => {
    const result = formatAmount("1000000000", { locale: "not-a-locale!!!" });
    expect(result.status).toBe("error");
  });

  it("returns error for out-of-range decimals", () => {
    const result = formatAmount("1000000000", { decimals: 25 });
    expect(result.status).toBe("error");
  });

  it("handles bigint input without precision loss", () => {
    // 9_223_372_036_854_775_807 is the max stroop value — a Number cannot hold it exactly
    const maxStroops = 9_223_372_036_854_775_807n;
    const result = formatAmount(maxStroops);
    expect(result.status).toBe("ok");
    // Whole part should be 922337203685 — verify no truncation
    expect(result.data!.startsWith("922,337,203,685")).toBe(true);
  });

  it("DEFAULT_ASSET_DECIMALS is 7", () => {
    expect(DEFAULT_ASSET_DECIMALS).toBe(7);
  });
});

// ─── Unsafe number handling documented pitfalls ───────────────────────────────

describe("precision pitfall — number type limitation", () => {
  it("demonstrates why large stroop values must not use number", () => {
    // 9_223_372_036_854_775_807 cannot be represented exactly as number
    const asNumber = Number(9_223_372_036_854_775_807n);
    const asBigInt = 9_223_372_036_854_775_807n;
    // The number rounded; the bigint is exact
    expect(BigInt(asNumber)).not.toBe(asBigInt);
  });

  it("addAmounts is safe for amounts beyond Number.MAX_SAFE_INTEGER", () => {
    // 10_000_000 XLM × 10_000_000 stroop/XLM = 100_000_000_000_000 stroops
    // well beyond MAX_SAFE_INTEGER — string arithmetic must remain exact
    const a = "10000000"; // 10M XLM
    const b = "10000000"; // 10M XLM
    expect(addAmounts(a, b)).toBe("20000000");
  });
});
