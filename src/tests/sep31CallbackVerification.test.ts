/**
 * Tests for SEP-31 callback verification (#152).
 *
 * Covers valid callbacks, tampered signatures, and asset/amount mismatches.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifySep31Callback,
  type Sep31CallbackPayload,
  type Sep31CallbackVerificationOptions,
} from "../integration/sep31DirectPayment";

// ── Minimal TOML stub ─────────────────────────────────────────────────────────

const SIGNING_KEY = "GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH4Y7ONSF5LWOYSLQ";

function makeFetch(overrideToml?: Partial<Record<string, unknown>>) {
  return vi.fn((_url: unknown) => {
    const toml = `
SIGNING_KEY = "${SIGNING_KEY}"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
${overrideToml ? Object.entries(overrideToml).map(([k, v]) => `${k} = "${v}"`).join("\n") : ""}
    `.trim();
    return Promise.resolve(
      new Response(toml, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<Sep31CallbackPayload> = {}): Sep31CallbackPayload {
  return {
    id: "txn_abc123",
    status: "completed",
    amount_in: "100.00",
    amount_out: "98.50",
    asset_code: "USDC",
    asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    updated_at: "2024-01-15T10:30:00Z",
    message: "Payment completed",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("verifySep31Callback", () => {
  let fetchMock: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    fetchMock = makeFetch();
  });

  describe("structural validation", () => {
    it("rejects a non-object payload", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        null as unknown as Sep31CallbackPayload,
        { fetch: fetchMock },
      );
      expect(result.status).toBe("error");
      expect(result.error.message).toMatch(/must be an object/i);
    });

    it("rejects a payload missing id", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ id: "" }),
        { fetch: fetchMock },
      );
      expect(result.status).toBe("error");
      expect(result.error.message).toMatch(/missing a valid `id`/i);
    });

    it("rejects a payload missing status", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ status: "" }),
        { fetch: fetchMock },
      );
      expect(result.status).toBe("error");
      expect(result.error.message).toMatch(/missing a valid `status`/i);
    });
  });

  describe("TOML fetch failure", () => {
    it("returns a network error when TOML cannot be fetched", async () => {
      const failFetch = vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })));
      const result = await verifySep31Callback(
        "broken.example.com",
        makePayload(),
        { fetch: failFetch },
      );
      expect(result.status).toBe("error");
      expect(result.error.code).toBe("NETWORK_ERROR");
    });

    it("returns config error when TOML has no SIGNING_KEY", async () => {
      const noKeyFetch = vi.fn(() =>
        Promise.resolve(
          new Response('NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"', {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      );
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload(),
        { fetch: noKeyFetch },
      );
      expect(result.status).toBe("error");
      expect(result.error.code).toBe("INVALID_CONFIG");
      expect(result.error.message).toMatch(/SIGNING_KEY/i);
    });
  });

  describe("valid callback (no signature)", () => {
    it("returns a normalized result for a well-formed payload", async () => {
      const payload = makePayload();
      const result = await verifySep31Callback("anchor.example.com", payload, {
        fetch: fetchMock,
      });
      expect(result.status).toBe("ok");
      expect(result.data.transactionId).toBe("txn_abc123");
      expect(result.data.status).toBe("completed");
      expect(result.data.amountIn).toBe("100.00");
      expect(result.data.amountOut).toBe("98.50");
      expect(result.data.asset?.code).toBe("USDC");
      expect(result.data.updatedAt).toBe("2024-01-15T10:30:00Z");
      expect(result.data.message).toBe("Payment completed");
      expect(result.data.raw).toEqual(payload);
    });

    it("omits optional fields that are absent from the payload", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        { id: "txn_xyz", status: "pending_external" },
        { fetch: fetchMock },
      );
      expect(result.status).toBe("ok");
      expect(result.data.amountIn).toBeUndefined();
      expect(result.data.asset).toBeUndefined();
      expect(result.data.authContext).toBeUndefined();
    });

    it("attaches authToken to result when provided", async () => {
      const authToken = {
        token: "jwt.token.here",
        expiresAt: Date.now() + 300_000,
        claims: { sub: "GABC" },
      };
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload(),
        { fetch: fetchMock, authToken },
      );
      expect(result.status).toBe("ok");
      expect(result.data.authContext).toEqual(authToken);
    });
  });

  describe("asset mismatch", () => {
    it("rejects when asset_code does not match expectedAsset.code", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ asset_code: "USDC" }),
        {
          fetch: fetchMock,
          expectedAsset: { code: "EURC" },
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.message).toMatch(/asset_code mismatch/i);
      expect(result.error.message).toContain("EURC");
      expect(result.error.message).toContain("USDC");
    });

    it("rejects when asset_issuer does not match expectedAsset.issuer", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ asset_issuer: "GWRONG000000000000000000000000000000000000000000000000000" }),
        {
          fetch: fetchMock,
          expectedAsset: {
            code: "USDC",
            issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          },
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.message).toMatch(/asset_issuer mismatch/i);
    });

    it("passes when asset_code matches expected (case-insensitive)", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ asset_code: "usdc" }),
        {
          fetch: fetchMock,
          expectedAsset: { code: "USDC" },
        },
      );
      expect(result.status).toBe("ok");
    });

    it("passes when payload omits asset_code and expectedAsset is set", async () => {
      // Empty string is treated as absent — no mismatch error
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ asset_code: "" }),
        {
          fetch: fetchMock,
          expectedAsset: { code: "USDC" },
        },
      );
      expect(result.status).toBe("ok");
    });
  });

  describe("amount mismatch", () => {
    it("rejects when amount_in does not match expectedAmountIn", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ amount_in: "50.00" }),
        {
          fetch: fetchMock,
          expectedAmountIn: "100.00",
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.message).toMatch(/amount_in mismatch/i);
      expect(result.error.message).toContain("100.00");
      expect(result.error.message).toContain("50.00");
    });

    it("passes when amount_in matches expectedAmountIn", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ amount_in: "100.00" }),
        {
          fetch: fetchMock,
          expectedAmountIn: "100.00",
        },
      );
      expect(result.status).toBe("ok");
    });

    it("passes when payload omits amount_in and expectedAmountIn is set", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload({ amount_in: "" }),
        {
          fetch: fetchMock,
          expectedAmountIn: "100.00",
        },
      );
      expect(result.status).toBe("ok");
    });
  });

  describe("signature verification", () => {
    it("returns INVALID_AUTH when only signature is provided (no bodyBytes)", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload(),
        {
          fetch: fetchMock,
          signature: "somebase64sig",
          // bodyBytes intentionally omitted
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.code).toBe("INVALID_AUTH");
      expect(result.error.message).toMatch(/bodyBytes/i);
    });

    it("returns INVALID_AUTH when only bodyBytes is provided (no signature)", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload(),
        {
          fetch: fetchMock,
          bodyBytes: new TextEncoder().encode("{}"),
          // signature intentionally omitted
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.code).toBe("INVALID_AUTH");
    });

    it("returns INVALID_AUTH for a tampered (invalid base64) signature", async () => {
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload(),
        {
          fetch: fetchMock,
          signature: "!!!notbase64!!!",
          bodyBytes: new TextEncoder().encode('{"id":"txn_abc123","status":"completed"}'),
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.code).toBe("INVALID_AUTH");
      expect(result.error.message).toMatch(/not valid base64/i);
    });

    it("returns INVALID_AUTH when signature bytes are valid base64 but do not verify", async () => {
      // 64 zero bytes is a structurally valid Ed25519 signature but won't verify
      const fakeSignature = btoa(String.fromCharCode(...new Uint8Array(64)));
      const bodyBytes = new TextEncoder().encode('{"id":"txn_abc123","status":"completed"}');
      const result = await verifySep31Callback(
        "anchor.example.com",
        makePayload(),
        {
          fetch: fetchMock,
          signature: fakeSignature,
          bodyBytes,
        },
      );
      expect(result.status).toBe("error");
      expect(result.error.code).toBe("INVALID_AUTH");
    });
  });
});
