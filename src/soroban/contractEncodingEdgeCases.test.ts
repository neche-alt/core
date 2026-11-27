/**
 * Contract argument encoding edge cases (#41).
 *
 * Covers complex nested types, numeric boundary values, and round-trip
 * encode/decode behaviour for all supported Soroban value types.
 */

import { describe, it, expect } from "vitest";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  encodeContractArgs,
  encodeAbiValue,
  decodeContractValue,
  decodeAbiValue,
} from "./contractEncoding";
import type { ContractMethod } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundTrip(type: string, value: unknown): unknown {
  const encoded = encodeAbiValue(type, value, "roundTrip");
  return decodeAbiValue(encoded, type);
}

// ─── Numeric boundary values ──────────────────────────────────────────────────

describe("numeric boundary values", () => {
  describe("u32", () => {
    it("encodes and decodes 0", () => {
      expect(roundTrip("u32", 0)).toBe(0);
    });

    it("encodes and decodes the maximum u32 value (4294967295)", () => {
      expect(roundTrip("u32", 4294967295)).toBe(4294967295);
    });

    it("throws for a negative u32", () => {
      expect(() => encodeAbiValue("u32", -1, "u32")).toThrow();
    });

    it("throws when u32 value exceeds 2^32-1", () => {
      expect(() => encodeAbiValue("u32", 4294967296, "u32")).toThrow();
    });
  });

  describe("i32", () => {
    it("encodes and decodes the minimum i32 (-2147483648)", () => {
      expect(roundTrip("i32", -2147483648)).toBe(-2147483648);
    });

    it("encodes and decodes the maximum i32 (2147483647)", () => {
      expect(roundTrip("i32", 2147483647)).toBe(2147483647);
    });

    it("throws when i32 value exceeds 2^31-1", () => {
      expect(() => encodeAbiValue("i32", 2147483648, "i32")).toThrow();
    });

    it("throws when i32 value is below -2^31", () => {
      expect(() => encodeAbiValue("i32", -2147483649, "i32")).toThrow();
    });
  });

  describe("u64", () => {
    it("encodes and decodes 0n", () => {
      expect(roundTrip("u64", 0n)).toBe(0n);
    });

    it("encodes and decodes the maximum u64 value (2^64 - 1)", () => {
      const max = (1n << 64n) - 1n;
      expect(roundTrip("u64", max)).toBe(max);
    });

    it("encodes a number as u64", () => {
      expect(roundTrip("u64", 42)).toBe(42n);
    });
  });

  describe("i64", () => {
    it("encodes and decodes the minimum i64 (-2^63)", () => {
      const min = -(1n << 63n);
      expect(roundTrip("i64", min)).toBe(min);
    });

    it("encodes and decodes the maximum i64 (2^63 - 1)", () => {
      const max = (1n << 63n) - 1n;
      expect(roundTrip("i64", max)).toBe(max);
    });

    it("encodes and decodes negative i64", () => {
      expect(roundTrip("i64", -1n)).toBe(-1n);
    });
  });

  describe("u128", () => {
    it("encodes and decodes 0n", () => {
      expect(roundTrip("u128", 0n)).toBe(0n);
    });

    it("encodes and decodes the maximum u128 value (2^128 - 1)", () => {
      const max = (1n << 128n) - 1n;
      expect(roundTrip("u128", max)).toBe(max);
    });

    it("encodes a large number via bigint", () => {
      const big = 123456789012345678901234567890n;
      expect(roundTrip("u128", big)).toBe(big);
    });
  });

  describe("i128", () => {
    it("encodes and decodes the minimum i128 (-2^127)", () => {
      const min = -(1n << 127n);
      expect(roundTrip("i128", min)).toBe(min);
    });

    it("encodes and decodes the maximum i128 (2^127 - 1)", () => {
      const max = (1n << 127n) - 1n;
      expect(roundTrip("i128", max)).toBe(max);
    });

    it("encodes and decodes a negative i128 value", () => {
      const val = -999999999999999999999999999999n;
      expect(roundTrip("i128", val)).toBe(val);
    });
  });
});

// ─── String, symbol, bytes ────────────────────────────────────────────────────

describe("string and bytes types", () => {
  it("round-trips an empty string", () => {
    expect(roundTrip("string", "")).toBe("");
  });

  it("round-trips a UTF-8 string with multibyte characters", () => {
    const s = "héllo wörld 🌍";
    expect(roundTrip("string", s)).toBe(s);
  });

  it("round-trips a symbol", () => {
    expect(roundTrip("symbol", "transfer")).toBe("transfer");
  });

  it("throws when encoding a non-string as symbol", () => {
    expect(() => encodeAbiValue("symbol", 123, "sym")).toThrow();
  });

  it("round-trips bytes (Uint8Array)", () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const decoded = roundTrip("bytes", bytes);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded as Uint8Array)).toEqual([0, 1, 2, 255]);
  });

  it("round-trips a Buffer as bytes", () => {
    const buf = Buffer.from([10, 20, 30]);
    const decoded = roundTrip("bytes", buf);
    expect(decoded).toBeInstanceOf(Uint8Array);
  });

  it("throws when encoding a string as bytes", () => {
    expect(() => encodeAbiValue("bytes", "not-bytes", "bytes")).toThrow();
  });
});

// ─── Boolean and void ────────────────────────────────────────────────────────

describe("bool and void", () => {
  it("round-trips true", () => {
    expect(roundTrip("bool", true)).toBe(true);
  });

  it("round-trips false", () => {
    expect(roundTrip("bool", false)).toBe(false);
  });

  it("throws when encoding a non-boolean as bool", () => {
    expect(() => encodeAbiValue("bool", 1, "bool")).toThrow();
  });

  it("round-trips void (undefined)", () => {
    expect(roundTrip("void", undefined)).toBeUndefined();
  });
});

// ─── Nested vec (array) ───────────────────────────────────────────────────────

describe("vec (array) encoding", () => {
  it("round-trips an empty vec", () => {
    const encoded = encodeAbiValue("vec", [], "empty");
    const decoded = decodeContractValue(encoded);
    expect(decoded).toEqual([]);
  });

  it("round-trips a vec of u32 values", () => {
    const encoded = encodeAbiValue(
      { type: "vec", elementType: "u32" },
      [1, 2, 3],
      "u32vec",
    );
    const decoded = decodeContractValue(encoded) as number[];
    expect(decoded).toEqual([1, 2, 3]);
  });

  it("round-trips a nested vec of vecs (2D)", () => {
    const encoded = encodeAbiValue(
      { type: "vec", elementType: { type: "vec", elementType: "u32" } },
      [[1, 2], [3, 4]],
      "nested",
    );
    const decoded = decodeContractValue(encoded) as unknown[][];
    expect(decoded[0]).toEqual([1, 2]);
    expect(decoded[1]).toEqual([3, 4]);
  });

  it("throws when encoding a non-array as vec", () => {
    expect(() => encodeAbiValue("vec", { not: "array" }, "vec")).toThrow();
  });
});

// ─── Map encoding ─────────────────────────────────────────────────────────────

describe("map encoding", () => {
  it("round-trips a simple string-keyed map", () => {
    const encoded = encodeAbiValue("map", { a: 1, b: 2 }, "map");
    const decoded = decodeContractValue(encoded) as Record<string, unknown>;
    // Keys are encoded as strings; values as nativeToScVal best-effort
    expect(Object.keys(decoded)).toContain("a");
    expect(Object.keys(decoded)).toContain("b");
  });

  it("round-trips a typed map with u32 values", () => {
    const encoded = encodeAbiValue(
      { type: "map", keyType: "string", valueType: "u32" },
      { count: 7 },
      "typed-map",
    );
    const decoded = decodeContractValue(encoded) as Record<string, unknown>;
    expect(decoded["count"]).toBe(7);
  });

  it("throws when encoding a non-object as map", () => {
    expect(() => encodeAbiValue("map", [1, 2], "map")).toThrow();
  });

  it("throws when encoding null as map", () => {
    expect(() => encodeAbiValue("map", null, "map")).toThrow();
  });
});

// ─── Struct (custom) encoding ─────────────────────────────────────────────────

describe("struct / custom type encoding", () => {
  it("round-trips a struct with mixed field types", () => {
    const encoded = encodeAbiValue(
      {
        type: "struct",
        fields: [
          { name: "amount", type: "u128" },
          { name: "recipient", type: "string" },
          { name: "active", type: "bool" },
        ],
      },
      { amount: 500n, recipient: "GABC", active: true },
      "transfer-struct",
    );
    const decoded = decodeContractValue(encoded) as Record<string, unknown>;
    expect(decoded["amount"]).toBe(500n);
    expect(decoded["recipient"]).toBe("GABC");
    expect(decoded["active"]).toBe(true);
  });

  it("throws when a required struct field is missing", () => {
    expect(() =>
      encodeAbiValue(
        { type: "struct", fields: [{ name: "amount", type: "u128" }] },
        {},
        "missing-field",
      ),
    ).toThrow();
  });

  it("throws when encoding a non-object as struct", () => {
    expect(() =>
      encodeAbiValue(
        { type: "struct", fields: [{ name: "x", type: "u32" }] },
        [1],
        "wrong-type",
      ),
    ).toThrow();
  });
});

// ─── encodeContractArgs ───────────────────────────────────────────────────────

describe("encodeContractArgs", () => {
  const method: ContractMethod = {
    name: "deposit",
    inputs: [
      { name: "amount", type: "u128" },
      { name: "recipient", type: "string" },
      { name: "flag", type: "bool" },
    ],
    returnType: "void",
  };

  it("encodes the correct number of arguments", () => {
    const result = encodeContractArgs(method, [100n, "GABC", true]);
    expect(result).toHaveLength(3);
    expect(result[0]!.switch().name).toBe("scvU128");
    expect(result[1]!.switch().name).toBe("scvString");
    expect(result[2]!.switch().name).toBe("scvBool");
  });

  it("throws when argument count is too few", () => {
    expect(() => encodeContractArgs(method, [100n])).toThrow(/expects 3/);
  });

  it("throws when argument count is too many", () => {
    expect(() => encodeContractArgs(method, [1n, "a", true, "extra"])).toThrow(
      /expects 3/,
    );
  });

  it("throws with a descriptive message on type mismatch", () => {
    expect(() => encodeContractArgs(method, ["not-a-bigint", "GABC", true])).toThrow();
  });

  it("encodes a method with no inputs", () => {
    const noArgs: ContractMethod = { name: "ping", inputs: [], returnType: "void" };
    const result = encodeContractArgs(noArgs, []);
    expect(result).toHaveLength(0);
  });
});

// ─── Precision constraints ────────────────────────────────────────────────────

describe("precision constraints", () => {
  it("JavaScript number loses precision above Number.MAX_SAFE_INTEGER — bigint required for u64+", () => {
    // This documents a known precision constraint: JS numbers above 2^53
    // cannot represent all u64 values exactly. Applications must pass bigint.
    const unsafe = Number.MAX_SAFE_INTEGER + 2; // loses precision as number
    const asBigint = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    // Both encode without error (encodeAbiValue accepts number for u64)
    const encodedNum = encodeAbiValue("u64", unsafe, "num");
    const encodedBig = encodeAbiValue("u64", asBigint, "big");
    // The bigint encoding is authoritative; number encoding may differ
    const decodedBig = decodeContractValue(encodedBig) as bigint;
    expect(decodedBig).toBe(asBigint);
    // Decoded value from number path may not equal asBigint due to precision
    const decodedNum = decodeContractValue(encodedNum) as bigint;
    // Document: this value is NOT guaranteed to equal asBigint
    expect(typeof decodedNum).toBe("bigint");
  });

  it("i128 handles values beyond Number.MAX_SAFE_INTEGER correctly via bigint", () => {
    const big = 999999999999999999999999999999999999n;
    const decoded = roundTrip("i128", big);
    expect(decoded).toBe(big);
  });

  it("u128 round-trips values requiring more than 64 bits", () => {
    const val = (1n << 100n) + 12345n;
    expect(roundTrip("u128", val)).toBe(val);
  });
});

// ─── decodeContractValue — ScVal types not covered elsewhere ──────────────────

describe("decodeContractValue edge cases", () => {
  it("decodes scvVoid to undefined", () => {
    expect(decodeContractValue(xdr.ScVal.scvVoid())).toBeUndefined();
  });

  it("decodes an empty scvVec to []", () => {
    expect(decodeContractValue(xdr.ScVal.scvVec([]))).toEqual([]);
  });

  it("decodes an empty scvMap to {}", () => {
    expect(decodeContractValue(xdr.ScVal.scvMap([]))).toEqual({});
  });

  it("decodes scvBool false", () => {
    expect(decodeContractValue(xdr.ScVal.scvBool(false))).toBe(false);
  });

  it("decodes a nested vec of maps", () => {
    const inner = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("k"),
        val: nativeToScVal(1n, { type: "u128" }),
      }),
    ]);
    const outer = xdr.ScVal.scvVec([inner]);
    const decoded = decodeContractValue(outer) as Array<Record<string, unknown>>;
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!["k"]).toBe(1n);
  });
});
