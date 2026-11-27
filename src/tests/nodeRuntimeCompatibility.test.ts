/**
 * Node.js runtime compatibility tests (#115).
 *
 * Validates that built-ins required by the SDK's minimum supported runtime
 * (Node.js 18) are present, and that the SDK's core public exports work
 * correctly on the running Node version.
 */
import { describe, it, expect } from "vitest";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { createEndpointRegistry } from "../network/endpointRegistry";
import { EndpointPool } from "../network/endpointFailover";

describe("Node.js runtime compatibility (#115)", () => {
  describe("runtime globals", () => {
    it("process is defined (Node.js environment)", () => {
      expect(typeof process).toBe("object");
      expect(typeof process.version).toBe("string");
    });

    it("globalThis is defined (ES2020+, Node 12+)", () => {
      expect(typeof globalThis).toBe("object");
    });

    it("AbortController is defined (Node 15+ built-in)", () => {
      expect(typeof AbortController).toBe("function");
    });

    it("Promise is defined", () => {
      expect(typeof Promise).toBe("function");
    });

    it("structuredClone is defined (Node 17+ built-in)", () => {
      // structuredClone was added in Node 17. On Node 18+ it must be present.
      const major = parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
      if (major >= 17) {
        expect(typeof structuredClone).toBe("function");
      } else {
        // Skip on older Node versions
        expect(true).toBe(true);
      }
    });

    it("URL is defined (Node 10+ built-in)", () => {
      expect(typeof URL).toBe("function");
      const u = new URL("https://example.com");
      expect(u.hostname).toBe("example.com");
    });

    it("setTimeout and clearTimeout are defined", () => {
      expect(typeof setTimeout).toBe("function");
      expect(typeof clearTimeout).toBe("function");
    });

    it("Map and Set are defined", () => {
      expect(typeof Map).toBe("function");
      expect(typeof Set).toBe("function");
    });
  });

  describe("Node.js version", () => {
    it("running Node.js >= 18", () => {
      const major = parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
      expect(major).toBeGreaterThanOrEqual(18);
    });

    it("process.version is a semver string", () => {
      expect(process.version).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });

  describe("SorokitResult helpers", () => {
    it("ok() wraps a value correctly", () => {
      const result: SorokitResult<number> = ok(42);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data).toBe(42);
      }
    });

    it("err() wraps an error correctly", () => {
      const result: SorokitResult<number> = err(
        SorokitErrorCode.NETWORK_ERROR,
        "test error",
      );
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error.code).toBe(SorokitErrorCode.NETWORK_ERROR);
        expect(result.error.message).toBe("test error");
      }
    });

    it("SorokitErrorCode is an object with string values", () => {
      expect(typeof SorokitErrorCode).toBe("object");
      expect(typeof SorokitErrorCode.NETWORK_ERROR).toBe("string");
    });
  });

  describe("EndpointRegistry", () => {
    it("createEndpointRegistry is a function", () => {
      expect(typeof createEndpointRegistry).toBe("function");
    });

    it("createEndpointRegistry() returns a registry instance", () => {
      const reg = createEndpointRegistry();
      expect(typeof reg.registerEndpoint).toBe("function");
      expect(typeof reg.getEndpoints).toBe("function");
      expect(typeof reg.getHealthScores).toBe("function");
    });

    it("registerEndpoint works on current Node version", () => {
      const reg = createEndpointRegistry();
      const result = reg.registerEndpoint("horizon", "https://horizon.stellar.org");
      expect(result.status).toBe("ok");
    });
  });

  describe("EndpointPool", () => {
    it("EndpointPool is a class (function)", () => {
      expect(typeof EndpointPool).toBe("function");
    });

    it("EndpointPool can be instantiated on current Node version", () => {
      const pool = new EndpointPool(["https://horizon.stellar.org"]);
      expect(pool.primary).toBe("https://horizon.stellar.org");
      expect(typeof pool.current).toBe("string");
    });

    it("EndpointPool.getHealth() returns health array", () => {
      const pool = new EndpointPool([
        "https://horizon.stellar.org",
        "https://horizon-testnet.stellar.org",
      ]);
      const health = pool.getHealth();
      expect(Array.isArray(health)).toBe(true);
      expect(health).toHaveLength(2);
    });
  });
});
