import { describe, expect, it } from "vitest";
import {
  decodeContractError,
  DEFAULT_CONTRACT_ERROR_MAP,
  FACTORY_CONTRACT_ERRORS,
  ROUTER_CONTRACT_ERRORS,
} from "../soroban/contractErrors";
import {
  SANITIZED_KNOWN_ERROR_FIXTURES,
  SANITIZED_UNKNOWN_ERROR_FIXTURES,
  SANITIZED_PARTIAL_ERROR_FIXTURES,
  SANITIZED_MALFORMED_ERROR_FIXTURES,
  MockHostError,
} from "../soroban/contractErrorFixtures";

describe("contract error decoder fixture coverage (#78)", () => {
  describe("known sanitized error responses", () => {
    it("decodes host error with factory pair already exists code (#1)", () => {
      const fixture = SANITIZED_KNOWN_ERROR_FIXTURES.hostErrorFactoryPairExists;
      const decoded = decodeContractError(fixture.input, FACTORY_CONTRACT_ERRORS);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("already exists");
      expect(decoded.remediation).toContain("Query the factory");
      expect(decoded.raw).toBe(fixture.input);
    });

    it("decodes host error with router slippage exceeded code (#3)", () => {
      const fixture = SANITIZED_KNOWN_ERROR_FIXTURES.hostErrorRouterSlippage;
      const decoded = decodeContractError(fixture.input, ROUTER_CONTRACT_ERRORS);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("slippage");
      expect(decoded.remediation).toContain("slippage tolerance");
      expect(decoded.raw).toBe(fixture.input);
    });

    it("decodes JSON-RPC simulation failure payload and retains raw diagnostic context", () => {
      const fixture = SANITIZED_KNOWN_ERROR_FIXTURES.jsonRpcSimulationFailure;
      const decoded = decodeContractError(fixture.input, FACTORY_CONTRACT_ERRORS);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("already exists");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({
        events: ["AAAAFAAAAAAAAAAAAAAA..."],
        diagnosticXdr: "AAAAEgAAAAAAAAAAAAAA...",
      });
    });

    it("decodes symbolic router error and retains detail context", () => {
      const fixture = SANITIZED_KNOWN_ERROR_FIXTURES.symbolicRouterError;
      const decoded = decodeContractError(fixture.input, ROUTER_CONTRACT_ERRORS);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("swap path is invalid");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({ pathLength: 1, hops: [] });
    });

    it("decodes namespaced factory error and retains caller diagnostic info", () => {
      const fixture = SANITIZED_KNOWN_ERROR_FIXTURES.namespacedFactoryUnauthorized;
      const decoded = decodeContractError(fixture.input, DEFAULT_CONTRACT_ERROR_MAP);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("not authorized");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({
        caller: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA",
      });
    });

    it("decodes simulateTransaction failure payload with events", () => {
      const fixture = SANITIZED_KNOWN_ERROR_FIXTURES.simulateTransactionErrorString;
      const decoded = decodeContractError(fixture.input, ROUTER_CONTRACT_ERRORS);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe("7");
      expect(decoded.message).toContain("x·y=k");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual([
        { contractId: "CCONTRACT", topics: ["swap"] },
      ]);
    });
  });

  describe("unknown sanitized error responses", () => {
    it("handles unmapped numeric host error code while preserving raw context", () => {
      const fixture = SANITIZED_UNKNOWN_ERROR_FIXTURES.unmappedNumericHostError;
      const decoded = decodeContractError(fixture.input);

      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("9999");
      expect(decoded.raw).toBe(fixture.input);
    });

    it("handles unmapped symbolic error and retains data payload", () => {
      const fixture = SANITIZED_UNKNOWN_ERROR_FIXTURES.unmappedSymbolicError;
      const decoded = decodeContractError(fixture.input);

      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toBe(fixture.input.message);
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({ unlockLedger: 1234567 });
    });

    it("handles JSON-RPC internal server error and retains traceId diagnostic", () => {
      const fixture = SANITIZED_UNKNOWN_ERROR_FIXTURES.jsonRpcInternalServerError;
      const decoded = decodeContractError(fixture.input);

      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("Node internal storage");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({ traceId: "trace-soroban-001" });
    });

    it("handles unmapped bare number input", () => {
      const fixture = SANITIZED_UNKNOWN_ERROR_FIXTURES.unmappedBareNumber;
      const decoded = decodeContractError(fixture.input);

      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.raw).toBe(8888);
    });
  });

  describe("partial sanitized error responses", () => {
    it("decodes code without message field", () => {
      const fixture = SANITIZED_PARTIAL_ERROR_FIXTURES.codeWithoutMessage;
      const decoded = decodeContractError(fixture.input, DEFAULT_CONTRACT_ERROR_MAP);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("valid token contract");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({ asset: "USDC" });
    });

    it("handles message without code field and retains detail", () => {
      const fixture = SANITIZED_PARTIAL_ERROR_FIXTURES.messageWithoutCode;
      const decoded = decodeContractError(fixture.input);

      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBeNull();
      expect(decoded.message).toBe(fixture.input.message);
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({ gasUsed: 45000 });
    });

    it("decodes nested error object with code and diagnostic data", () => {
      const fixture = SANITIZED_PARTIAL_ERROR_FIXTURES.nestedEmptyError;
      const decoded = decodeContractError(fixture.input, DEFAULT_CONTRACT_ERROR_MAP);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("Insufficient liquidity");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({
        reserves: { tokenA: "0", tokenB: "100" },
      });
    });

    it("decodes object with null message and retains detail", () => {
      const fixture = SANITIZED_PARTIAL_ERROR_FIXTURES.nullMessageField;
      const decoded = decodeContractError(fixture.input, DEFAULT_CONTRACT_ERROR_MAP);

      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe(fixture.expectedCode);
      expect(decoded.message).toContain("deadline");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual({ deadline: 1700000000 });
    });

    it("handles RPC payload with diagnostic events", () => {
      const fixture = SANITIZED_PARTIAL_ERROR_FIXTURES.rpcPayloadWithDiagnosticEvents;
      const decoded = decodeContractError(fixture.input);

      expect(decoded.decoded).toBe(false);
      expect(decoded.message).toBe("Contract execution failed");
      expect(decoded.raw).toBe(fixture.input);
      expect(decoded.diagnostic).toEqual([
        { id: "evt_1", topics: ["error"] },
      ]);
    });
  });

  describe("malformed sanitized error responses", () => {
    it("safely handles null without throwing", () => {
      const decoded = decodeContractError(SANITIZED_MALFORMED_ERROR_FIXTURES.nullInput);
      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBeNull();
      expect(decoded.raw).toBeNull();
    });

    it("safely handles undefined without throwing", () => {
      const decoded = decodeContractError(SANITIZED_MALFORMED_ERROR_FIXTURES.undefinedInput);
      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBeNull();
      expect(decoded.raw).toBeUndefined();
    });

    it("safely handles boolean without throwing", () => {
      const decoded = decodeContractError(SANITIZED_MALFORMED_ERROR_FIXTURES.booleanInput);
      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBeNull();
      expect(decoded.raw).toBe(false);
    });

    it("safely handles HTML error responses from reverse proxies", () => {
      const decoded = decodeContractError(SANITIZED_MALFORMED_ERROR_FIXTURES.htmlErrorString);
      expect(decoded.decoded).toBe(false);
      expect(decoded.message).toContain("504");
      expect(decoded.raw).toBe(SANITIZED_MALFORMED_ERROR_FIXTURES.htmlErrorString);
    });

    it("safely handles hostile object with throwing getters", () => {
      const decoded = decodeContractError(SANITIZED_MALFORMED_ERROR_FIXTURES.throwingGetter);
      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBeNull();
      expect(decoded.raw).toBe(SANITIZED_MALFORMED_ERROR_FIXTURES.throwingGetter);
    });

    it("safely handles circular reference structures", () => {
      const decoded = decodeContractError(
        SANITIZED_MALFORMED_ERROR_FIXTURES.circularReference,
        DEFAULT_CONTRACT_ERROR_MAP,
      );
      expect(decoded.decoded).toBe(true);
      expect(decoded.code).toBe("ROUTER_1");
      expect(decoded.message).toContain("swap path");
      expect(decoded.raw).toBe(SANITIZED_MALFORMED_ERROR_FIXTURES.circularReference);
    });

    it("safely handles junk arrays containing symbols and functions", () => {
      const decoded = decodeContractError(SANITIZED_MALFORMED_ERROR_FIXTURES.junkArray);
      expect(decoded.decoded).toBe(false);
      expect(decoded.code).toBeNull();
      expect(decoded.raw).toBe(SANITIZED_MALFORMED_ERROR_FIXTURES.junkArray);
    });
  });
});
