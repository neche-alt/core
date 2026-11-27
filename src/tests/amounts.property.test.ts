import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  addAmounts,
  divideAmount,
  multiplyAmount,
  stroopsToXlm,
  subtractAmounts,
  xlmToStroops,
} from "../shared/amounts";
import {
  validateAmount,
  STELLAR_MAX_AMOUNT,
  STELLAR_MAX_DECIMAL_PLACES,
} from "../shared/validation";
import {
  validateAmount as validateAmountExplicit,
  validateStroop,
  MAX_STROOPS,
  MAX_AMOUNT,
  STROOPS_PER_XLM,
} from "../shared/amountValidation";
import { formatAmount } from "../shared/amountFormatter";
import { SorokitErrorCode } from "../shared/response";

describe("amount property tests", () => {
  it("round-trips every representable stroop amount", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000_000_000n, max: 10_000_000_000_000n }),
        (stroops) => {
          expect(xlmToStroops(stroopsToXlm(stroops))).toBe(stroops);
        },
      ),
    );
  });

  it("round-trips maximum boundary stroop amounts", () => {
    expect(xlmToStroops(stroopsToXlm(MAX_STROOPS))).toBe(MAX_STROOPS);
    expect(xlmToStroops(stroopsToXlm(-MAX_STROOPS))).toBe(-MAX_STROOPS);
    expect(xlmToStroops(stroopsToXlm(0n))).toBe(0n);
    expect(xlmToStroops(stroopsToXlm(1n))).toBe(1n);
  });

  it("preserves additive identity and inverse", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }),
        (stroops) => {
          const amount = stroopsToXlm(stroops);
          expect(addAmounts(amount, "0")).toBe(amount);
          expect(subtractAmounts(amount, amount)).toBe("0");
        },
      ),
    );
  });

  it("multiplies and divides by one without floating point drift", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        (stroops) => {
          const amount = stroopsToXlm(stroops);
          expect(multiplyAmount(amount, "1")).toBe(amount);
          expect(divideAmount(amount, "1")).toBe(amount);
        },
      ),
    );
  });

  describe("validation invariants: valid boundaries", () => {
    it("accepts valid positive amounts within representable range and scale", () => {
      // Arbitrary non-zero positive amounts up to MAX_STROOPS
      const validStroopsArb = fc.bigInt({ min: 1n, max: MAX_STROOPS });

      fc.assert(
        fc.property(validStroopsArb, (stroops) => {
          const xlm = stroopsToXlm(stroops);
          const result = validateAmount(xlm);
          expect(result.status).toBe("ok");
          if (result.status === "ok") {
            expect(result.data).toBe(xlm);
          }

          const explicitResult = validateAmountExplicit(xlm);
          expect(explicitResult.status).toBe("ok");

          // Conversion invariant: string amount parses back to expected stroops
          expect(xlmToStroops(xlm)).toBe(stroops);
        }),
      );
    });

    it("verifies exact boundary amounts (1 stroop and MAX_AMOUNT)", () => {
      const minValid = "0.0000001";
      const maxValid = MAX_AMOUNT;

      const minRes = validateAmount(minValid);
      expect(minRes.status).toBe("ok");
      if (minRes.status === "ok") expect(minRes.data).toBe(minValid);

      const maxRes = validateAmount(maxValid);
      expect(maxRes.status).toBe("ok");
      if (maxRes.status === "ok") expect(maxRes.data).toBe(maxValid);

      // Surrounding whitespace is trimmed and accepted
      expect(validateAmount(`  ${minValid}  `).status).toBe("ok");
      expect(validateAmount(`  ${maxValid}  `).status).toBe("ok");
    });
  });

  describe("validation invariants: invalid boundaries", () => {
    it("rejects zero and negative amounts with VALIDATION error", () => {
      const zeroRepresentations = ["0", "0.0", "0.00", "0.0000000", "  0  "];
      for (const z of zeroRepresentations) {
        const res = validateAmount(z);
        expect(res.status).toBe("error");
        if (res.status === "error") {
          expect(res.error.code).toBe(SorokitErrorCode.VALIDATION);
        }
      }

      fc.assert(
        fc.property(
          fc.bigInt({ min: 1n, max: 10_000_000_000_000n }),
          (positiveStroops) => {
            const negativeXlm = `-${stroopsToXlm(positiveStroops)}`;
            const res = validateAmount(negativeXlm);
            expect(res.status).toBe("error");
            if (res.status === "error") {
              expect(res.error.code).toBe(SorokitErrorCode.VALIDATION);
            }
          },
        ),
      );
    });

    it("rejects precision overflow exceeding 7 decimal places", () => {
      // Fraction lengths between 8 and 18 digits
      const excessPrecisionArb = fc
        .tuple(
          fc.integer({ min: 0, max: 1000 }),
          fc.stringMatching(/^[0-9]{8,14}$/),
        )
        .map(([whole, frac]) => `${whole}.${frac}`);

      fc.assert(
        fc.property(excessPrecisionArb, (amountStr) => {
          const res = validateAmount(amountStr);
          expect(res.status).toBe("error");
          if (res.status === "error") {
            expect(res.error.code).toBe(SorokitErrorCode.VALIDATION);
            expect(res.error.message).toContain("decimal places");
          }

          // Shared parseScaled also enforces scale limit
          expect(() => xlmToStroops(amountStr)).toThrow(RangeError);
        }),
      );
    });

    it("rejects amounts exceeding the maximum Stellar supply bound", () => {
      // Exact boundary: one stroop beyond MAX_AMOUNT
      const onePastMax = "922337203685.4775808";
      const exactRes = validateAmount(onePastMax);
      expect(exactRes.status).toBe("error");
      if (exactRes.status === "error") {
        expect(exactRes.error.code).toBe(SorokitErrorCode.VALIDATION);
      }

      // Arbitrary amounts beyond maximum whole units
      const overMaxArb = fc
        .bigInt({ min: 922337203686n, max: 100_000_000_000_000n })
        .map((s) => s.toString());

      fc.assert(
        fc.property(overMaxArb, (overMaxStr) => {
          const res = validateAmount(overMaxStr);
          expect(res.status).toBe("error");
          if (res.status === "error") {
            expect(res.error.code).toBe(SorokitErrorCode.VALIDATION);
          }
        }),
      );
    });

    it("rejects non-decimal strings, scientific notation, and non-finite inputs", () => {
      const invalidStrings = [
        "",
        "   ",
        "abc",
        "1e5",
        "1e-7",
        "2.5e3",
        "1.2.3",
        "NaN",
        "Infinity",
        "-Infinity",
        "0x10",
      ];

      for (const val of invalidStrings) {
        const res = validateAmount(val);
        expect(res.status).toBe("error");
        if (res.status === "error") {
          expect(res.error.code).toBe(SorokitErrorCode.VALIDATION);
        }
      }

      expect(validateAmount(NaN).status).toBe("error");
      expect(validateAmount(Infinity).status).toBe("error");
      expect(validateAmount(-Infinity).status).toBe("error");
    });
  });

  describe("formatting and stroop invariants", () => {
    it("formats valid non-negative stroops without error or mutation", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: MAX_STROOPS }),
          (stroops) => {
            const formatted = formatAmount(stroops, {
              decimals: 7,
              maximumFractionDigits: 7,
            });
            expect(formatted.status).toBe("ok");
            if (formatted.status === "ok") {
              expect(typeof formatted.data).toBe("string");
            }

            // Stroop validation succeeds for all valid non-negative integers
            const stroopValid = validateStroop(stroops);
            expect(stroopValid.status).toBe("ok");
          },
        ),
      );
    });

    it("rejects negative stroop formatting", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -10_000_000_000n, max: -1n }),
          (negativeStroops) => {
            const res = formatAmount(negativeStroops.toString());
            expect(res.status).toBe("error");
            if (res.status === "error") {
              expect(res.error.code).toBe(SorokitErrorCode.VALIDATION);
            }
          },
        ),
      );
    });

    it("enforces division error on zero divisor", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 1n, max: 10_000_000_000n }),
          (stroops) => {
            const amount = stroopsToXlm(stroops);
            expect(() => divideAmount(amount, "0")).toThrow(RangeError);
          },
        ),
      );
    });
  });
});
