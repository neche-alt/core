import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  encodeAbiValue,
  decodeAbiValue,
  type ContractAbiTypeDescriptor,
} from "../soroban/contractEncoding";

describe("Soroban XDR round-trip property tests (#77)", () => {
  const fcOptions = { seed: 42, numRuns: 100 };

  describe("boundary integers round-trip equivalence", () => {
    it("round-trips u32 across full domain and boundaries", () => {
      // Test explicit boundaries
      for (const boundary of [0, 1, 0xffff, 0x7fffffff, 0xffffffff]) {
        const scVal = encodeAbiValue("u32", boundary);
        expect(decodeAbiValue(scVal, "u32")).toBe(boundary);
      }

      fc.assert(
        fc.property(fc.integer({ min: 0, max: 0xffffffff }), (val) => {
          const scVal = encodeAbiValue("u32", val);
          expect(decodeAbiValue(scVal, "u32")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips i32 across full domain and boundaries", () => {
      // Test explicit boundaries
      for (const boundary of [-2147483648, -1, 0, 1, 2147483647]) {
        const scVal = encodeAbiValue("i32", boundary);
        expect(decodeAbiValue(scVal, "i32")).toBe(boundary);
      }

      fc.assert(
        fc.property(fc.integer({ min: -2147483648, max: 2147483647 }), (val) => {
          const scVal = encodeAbiValue("i32", val);
          expect(decodeAbiValue(scVal, "i32")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips u64 across full domain and boundaries", () => {
      const maxU64 = 18446744073709551615n;
      for (const boundary of [0n, 1n, 4294967295n, maxU64]) {
        const scVal = encodeAbiValue("u64", boundary);
        expect(decodeAbiValue(scVal, "u64")).toBe(boundary);
      }

      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: maxU64 }), (val) => {
          const scVal = encodeAbiValue("u64", val);
          expect(decodeAbiValue(scVal, "u64")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips i64 across full domain and boundaries", () => {
      const minI64 = -9223372036854775808n;
      const maxI64 = 9223372036854775807n;
      for (const boundary of [minI64, -1n, 0n, 1n, maxI64]) {
        const scVal = encodeAbiValue("i64", boundary);
        expect(decodeAbiValue(scVal, "i64")).toBe(boundary);
      }

      fc.assert(
        fc.property(fc.bigInt({ min: minI64, max: maxI64 }), (val) => {
          const scVal = encodeAbiValue("i64", val);
          expect(decodeAbiValue(scVal, "i64")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips u128 across full domain and boundaries", () => {
      const maxU128 = (1n << 128n) - 1n;
      for (const boundary of [0n, 1n, 18446744073709551615n, maxU128]) {
        const scVal = encodeAbiValue("u128", boundary);
        expect(decodeAbiValue(scVal, "u128")).toBe(boundary);
      }

      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: maxU128 }), (val) => {
          const scVal = encodeAbiValue("u128", val);
          expect(decodeAbiValue(scVal, "u128")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips i128 across full domain and boundaries", () => {
      const minI128 = -(1n << 127n);
      const maxI128 = (1n << 127n) - 1n;
      for (const boundary of [minI128, -1n, 0n, 1n, maxI128]) {
        const scVal = encodeAbiValue("i128", boundary);
        expect(decodeAbiValue(scVal, "i128")).toBe(boundary);
      }

      fc.assert(
        fc.property(fc.bigInt({ min: minI128, max: maxI128 }), (val) => {
          const scVal = encodeAbiValue("i128", val);
          expect(decodeAbiValue(scVal, "i128")).toBe(val);
        }),
        fcOptions,
      );
    });
  });

  describe("primitive and raw values round-trip equivalence", () => {
    it("round-trips bool values", () => {
      fc.assert(
        fc.property(fc.boolean(), (val) => {
          const scVal = encodeAbiValue("bool", val);
          expect(decodeAbiValue(scVal, "bool")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips string values", () => {
      fc.assert(
        fc.property(fc.string(), (val) => {
          const scVal = encodeAbiValue("string", val);
          expect(decodeAbiValue(scVal, "string")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips symbol identifiers", () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-zA-Z0-9_]{1,32}$/), (val) => {
          const scVal = encodeAbiValue("symbol", val);
          expect(decodeAbiValue(scVal, "symbol")).toBe(val);
        }),
        fcOptions,
      );
    });

    it("round-trips bytes buffers", () => {
      fc.assert(
        fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (val) => {
          const scVal = encodeAbiValue("bytes", val);
          const decoded = decodeAbiValue(scVal, "bytes") as Uint8Array;
          expect(Buffer.from(decoded)).toEqual(Buffer.from(val));
        }),
        fcOptions,
      );
    });

    it("round-trips void / undefined", () => {
      const scVal = encodeAbiValue("void", undefined);
      expect(decodeAbiValue(scVal, "void")).toBeUndefined();
    });
  });

  describe("nested ScVal shapes round-trip equivalence", () => {
    it("round-trips nested vector of u32 (vec<u32>)", () => {
      const descriptor: ContractAbiTypeDescriptor = {
        type: "vec",
        elementType: { type: "u32" },
      };

      fc.assert(
        fc.property(fc.array(fc.integer({ min: 0, max: 0xffffffff }), { maxLength: 20 }), (val) => {
          const scVal = encodeAbiValue(descriptor, val);
          expect(decodeAbiValue(scVal, descriptor)).toEqual(val);
        }),
        fcOptions,
      );
    });

    it("round-trips deeply nested vectors (vec<vec<string>>)", () => {
      const descriptor: ContractAbiTypeDescriptor = {
        type: "vec",
        elementType: {
          type: "vec",
          elementType: { type: "string" },
        },
      };

      fc.assert(
        fc.property(
          fc.array(fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }), { maxLength: 5 }),
          (val) => {
            const scVal = encodeAbiValue(descriptor, val);
            expect(decodeAbiValue(scVal, descriptor)).toEqual(val);
          },
        ),
        fcOptions,
      );
    });

    it("round-trips map structures (map<string, u64>)", () => {
      const descriptor: ContractAbiTypeDescriptor = {
        type: "map",
        keyType: { type: "string" },
        valueType: { type: "u64" },
      };

      fc.assert(
        fc.property(
          fc.dictionary(
            fc.stringMatching(/^[a-z0-9_]{1,16}$/),
            fc.bigInt({ min: 0n, max: 1000000000n }),
            { maxKeys: 10 },
          ),
          (val) => {
            const scVal = encodeAbiValue(descriptor, val);
            expect(decodeAbiValue(scVal, descriptor)).toEqual(val);
          },
        ),
        fcOptions,
      );
    });

    it("round-trips complex struct with mixed primitive and nested fields", () => {
      const descriptor: ContractAbiTypeDescriptor = {
        type: "struct",
        fields: [
          { name: "id", type: "u32" },
          { name: "name", type: "string" },
          { name: "balance", type: "u128" },
          { name: "enabled", type: "bool" },
        ],
      };

      fc.assert(
        fc.property(
          fc.record({
            id: fc.integer({ min: 0, max: 0xffffffff }),
            name: fc.string({ maxLength: 30 }),
            balance: fc.bigInt({ min: 0n, max: (1n << 128n) - 1n }),
            enabled: fc.boolean(),
          }),
          (val) => {
            const scVal = encodeAbiValue(descriptor, val);
            expect(decodeAbiValue(scVal, descriptor)).toEqual(val);
          },
        ),
        fcOptions,
      );
    });

    it("round-trips vector of structs (vec<struct>)", () => {
      const structDesc: ContractAbiTypeDescriptor = {
        type: "struct",
        fields: [
          { name: "orderId", type: "u32" },
          { name: "amount", type: "u64" },
        ],
      };
      const vecDesc: ContractAbiTypeDescriptor = {
        type: "vec",
        elementType: structDesc,
      };

      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              orderId: fc.integer({ min: 0, max: 0xffffffff }),
              amount: fc.bigInt({ min: 0n, max: 18446744073709551615n }),
            }),
            { maxLength: 10 },
          ),
          (val) => {
            const scVal = encodeAbiValue(vecDesc, val);
            expect(decodeAbiValue(scVal, vecDesc)).toEqual(val);
          },
        ),
        fcOptions,
      );
    });
  });

  describe("explicit exclusions and boundary error handling", () => {
    it("rejects non-integer floating point numbers for u32 and i32", () => {
      for (const invalid of [3.14, NaN, Infinity, -Infinity]) {
        expect(() => encodeAbiValue("u32", invalid)).toThrow(TypeError);
        expect(() => encodeAbiValue("i32", invalid)).toThrow(TypeError);
      }
    });

    it("rejects out-of-range integer values for u32", () => {
      expect(() => encodeAbiValue("u32", -1)).toThrow(RangeError);
      expect(() => encodeAbiValue("u32", 0x100000000)).toThrow(RangeError);
    });

    it("rejects out-of-range integer values for i32", () => {
      expect(() => encodeAbiValue("i32", 2147483648)).toThrow(RangeError);
      expect(() => encodeAbiValue("i32", -2147483649)).toThrow(RangeError);
    });

    it("rejects non-array values for vec descriptor", () => {
      const desc: ContractAbiTypeDescriptor = { type: "vec", elementType: "u32" };
      expect(() => encodeAbiValue(desc, "not-an-array")).toThrow(TypeError);
      expect(() => encodeAbiValue(desc, 123)).toThrow(TypeError);
      expect(() => encodeAbiValue(desc, null)).toThrow(TypeError);
    });

    it("rejects non-object values for map descriptor", () => {
      const desc: ContractAbiTypeDescriptor = { type: "map", keyType: "string", valueType: "u32" };
      expect(() => encodeAbiValue(desc, "not-an-object")).toThrow(TypeError);
      expect(() => encodeAbiValue(desc, [1, 2, 3])).toThrow(TypeError);
      expect(() => encodeAbiValue(desc, null)).toThrow(TypeError);
    });

    it("rejects struct value missing required field", () => {
      const desc: ContractAbiTypeDescriptor = {
        type: "struct",
        fields: [
          { name: "id", type: "u32" },
          { name: "secret", type: "string" },
        ],
      };
      expect(() => encodeAbiValue(desc, { id: 1 })).toThrow(TypeError);
    });

    it("rejects invalid types for bool and symbol", () => {
      expect(() => encodeAbiValue("bool", "true")).toThrow(TypeError);
      expect(() => encodeAbiValue("symbol", 12345)).toThrow(TypeError);
    });
  });
});
