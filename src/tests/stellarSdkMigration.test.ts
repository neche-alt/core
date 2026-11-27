import { describe, expect, it } from "vitest";
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

describe("Stellar SDK Upgrades & XDR Migration Compatibility", () => {
  describe("XDR serialization round-trip fidelity", () => {
    it("round-trips primitive values to and from XDR base64 strings", () => {
      // Test u32
      const u32Original = nativeToScVal(99999, { type: "u32" });
      const u32Xdr = u32Original.toXDR("base64");
      const u32Restored = xdr.ScVal.fromXDR(u32Xdr, "base64");
      expect(scValToNative(u32Restored)).toBe(99999);

      // Test boolean
      const boolOriginal = nativeToScVal(true, { type: "bool" });
      const boolXdr = boolOriginal.toXDR("base64");
      const boolRestored = xdr.ScVal.fromXDR(boolXdr, "base64");
      expect(scValToNative(boolRestored)).toBe(true);

      // Test string
      const strOriginal = nativeToScVal("stellar-compatibility", { type: "string" });
      const strXdr = strOriginal.toXDR("base64");
      const strRestored = xdr.ScVal.fromXDR(strXdr, "base64");
      expect(scValToNative(strRestored)).toBe("stellar-compatibility");

      // Test i128 BigInt
      const bigIntOriginal = nativeToScVal(BigInt("5000000000000"), { type: "i128" });
      const bigIntXdr = bigIntOriginal.toXDR("base64");
      const bigIntRestored = xdr.ScVal.fromXDR(bigIntXdr, "base64");
      expect(scValToNative(bigIntRestored)).toBe(BigInt("5000000000000"));
    });

    it("round-trips complex nested types (vectors and maps)", () => {
      const vecOriginal = nativeToScVal(["itemA", "itemB", "itemC"], { type: "vec" });
      const vecXdr = vecOriginal.toXDR("base64");
      const vecRestored = xdr.ScVal.fromXDR(vecXdr, "base64");
      expect(scValToNative(vecRestored)).toEqual(["itemA", "itemB", "itemC"]);

      const mapOriginal = nativeToScVal(
        {
          keyA: 100,
          keyB: true,
        },
        { type: "map" }
      );
      const mapXdr = mapOriginal.toXDR("base64");
      const mapRestored = xdr.ScVal.fromXDR(mapXdr, "base64");
      const nativeMap = scValToNative(mapRestored);
      expect(nativeMap.keyA).toBe(100);
      expect(nativeMap.keyB).toBe(true);
    });

    it("round-trips Stellar Account and Contract addresses", () => {
      const accountStr = "GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV";
      const scValAddress = new xdr.ScVal.scvAddress(Address.fromString(accountStr).toScAddress());
      const addressXdr = scValAddress.toXDR("base64");
      const restored = xdr.ScVal.fromXDR(addressXdr, "base64");

      const restoredNative = Address.fromScAddress(restored.address()).toString();
      expect(restoredNative).toBe(accountStr);
    });
  });

  describe("Boundary and failure handling", () => {
    it("safely throws on invalid or truncated XDR base64 string", () => {
      expect(() => {
        xdr.ScVal.fromXDR("NOT_VALID_BASE64_XDR_DATA", "base64");
      }).toThrow();
    });

    it("safely throws on malformed Stellar account address format", () => {
      expect(() => {
        Address.fromString("INVALID_ADDRESS_STRING");
      }).toThrow();
    });
  });
});
