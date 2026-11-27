import { describe, expect, it } from "vitest";
import { sanitizeErrorContext } from "../shared/response";
import { StrKey } from "@stellar/stellar-sdk";
import { resolveNetwork } from "../network/config";

describe("Security Model, Key-Handling & Redaction Safeguards", () => {
  describe("Automated redaction of sensitive telemetry and diagnostics", () => {
    it("redacts secret keys, seeds, and auth tokens from error context", () => {
      const sensitiveContext = {
        operation: "transaction.sign",
        context: {
          secret: "SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          secretKey: "SAYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
          seed: "test seed phrase",
          password: "my-secure-password",
          token: "jwt.bearer.token",
          apiKey: "sk-123456",
          publicKey: "GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV",
          operationId: "op-987",
        },
      };

      const sanitized = sanitizeErrorContext(sensitiveContext as any);
      expect(sanitized).toBeDefined();
      expect(sanitized?.operation).toBe("transaction.sign");

      const ctx = sanitized?.context as Record<string, unknown>;
      expect(ctx.secret).toBe("[REDACTED]");
      expect(ctx.secretKey).toBe("[REDACTED]");
      expect(ctx.seed).toBe("[REDACTED]");
      expect(ctx.password).toBe("[REDACTED]");
      expect(ctx.token).toBe("[REDACTED]");
      expect(ctx.apiKey).toBe("[REDACTED]");

      // Public data remains untouched
      expect(ctx.publicKey).toBe("GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV");
      expect(ctx.operationId).toBe("op-987");
    });

    it("recursively redacts nested sensitive fields inside arrays and objects", () => {
      const nestedContext = {
        operation: "auth.verify",
        context: {
          payload: {
            authDetails: {
              authorization: "Bearer secret-token",
              mnemonic: "twelve secret words here",
              activeAccount: "GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV",
            },
            keys: [
              { private_key: "priv-123", id: 1 },
              { private_key: "priv-456", id: 2 },
            ],
          },
        },
      };

      const sanitized = sanitizeErrorContext(nestedContext as any);
      const payload = (sanitized?.context as any).payload;
      expect(payload.authDetails.authorization).toBe("[REDACTED]");
      expect(payload.authDetails.mnemonic).toBe("[REDACTED]");
      expect(payload.authDetails.activeAccount).toBe("GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV");

      expect(payload.keys[0].private_key).toBe("[REDACTED]");
      expect(payload.keys[0].id).toBe(1);
    });
  });

  describe("Public key vs secret key trust boundary enforcement", () => {
    it("validates Ed25519 public key and rejects secret key where public key is required", () => {
      const validPublicKey = "GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV";
      const secretKey = "SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

      expect(StrKey.isValidEd25519PublicKey(validPublicKey)).toBe(true);
      expect(StrKey.isValidEd25519PublicKey(secretKey)).toBe(false);
      expect(StrKey.isValidEd25519SecretSeed(secretKey)).toBe(true);
    });
  });

  describe("Mainnet vs Testnet network safeguards", () => {
    it("resolves distinct passphrases preventing cross-network replay attacks", () => {
      const testnet = resolveNetwork("testnet");
      const mainnet = resolveNetwork("mainnet");

      expect(testnet.status).toBe("ok");
      expect(mainnet.status).toBe("ok");

      if (testnet.status === "ok" && mainnet.status === "ok") {
        expect(testnet.data.networkPassphrase).toBe("Test SDF Network ; September 2015");
        expect(mainnet.data.networkPassphrase).toBe("Public Global Stellar Network ; July 2015");
        expect(testnet.data.networkPassphrase).not.toBe(mainnet.data.networkPassphrase);
      }
    });

    it("rejects unknown network configurations", () => {
      const invalid = resolveNetwork("invalid-network" as any);
      expect(invalid.status).toBe("error");
    });
  });
});
