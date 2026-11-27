import { err, ok, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { fetchStellarToml } from "./sep1Toml";
import type { AuthToken } from "./sep10Auth";

export interface DirectPaymentAsset {
  code: string;
  issuer?: string;
}

// ─── Callback verification ───────────────────────────────────────────────────

/**
 * Raw SEP-31 callback payload as received from an anchor's HTTP POST.
 * Unknown extra fields are permitted and preserved in `metadata`.
 */
export interface Sep31CallbackPayload {
  /** Transaction ID assigned by the anchor. */
  id: string;
  /** New transaction status (e.g. "completed", "pending_external"). */
  status: string;
  /** Amount sent, expressed as a decimal string (e.g. "100.00"). */
  amount_in?: string;
  /** Amount received after fees, expressed as a decimal string. */
  amount_out?: string;
  /** Asset code for the sent amount (e.g. "USDC"). */
  asset_code?: string;
  /** Asset issuer Stellar account for the sent amount. */
  asset_issuer?: string;
  /** ISO 8601 timestamp of the status change. */
  updated_at?: string;
  /** Human-readable message from the anchor. */
  message?: string;
  /** Any additional fields the anchor includes. */
  [key: string]: unknown;
}

/**
 * Normalized, verified callback result returned by {@link verifySep31Callback}.
 */
export interface Sep31CallbackResult {
  /** Anchor-assigned transaction ID. */
  transactionId: string;
  /** Canonical transaction status. */
  status: string;
  /** Amount sent (if provided by the anchor). */
  amountIn?: string;
  /** Amount out after fees (if provided). */
  amountOut?: string;
  /** Asset the payment was denominated in. */
  asset?: DirectPaymentAsset;
  /** ISO 8601 string of the last status update. */
  updatedAt?: string;
  /** Free-text message from the anchor. */
  message?: string;
  /** The raw payload, retained for caller inspection. */
  raw: Sep31CallbackPayload;
  /** SEP-10 auth context under which the callback was verified, if supplied. */
  authContext?: AuthToken;
}

/**
 * Options for {@link verifySep31Callback}.
 */
export interface Sep31CallbackVerificationOptions {
  /**
   * The `X-Stellar-Signature` header value from the inbound HTTP request.
   * When provided, the signature is verified against the anchor's TOML
   * signing key before anything else is accepted.
   */
  signature?: string;
  /**
   * Raw request body bytes used to verify the signature.
   * Required when `signature` is supplied.
   */
  bodyBytes?: Uint8Array;
  /**
   * Expected asset — if set, the callback's asset_code and asset_issuer are
   * checked against these values and a mismatch produces a structured error.
   */
  expectedAsset?: DirectPaymentAsset;
  /**
   * Expected amount in — if set, the callback's amount_in is checked.
   */
  expectedAmountIn?: string;
  /**
   * SEP-10 auth token for authenticated context. If supplied it is attached
   * to the returned {@link Sep31CallbackResult.authContext}.
   */
  authToken?: AuthToken;
  /** Override fetch for TOML retrieval (useful in tests). */
  fetch?: typeof fetch;
  /** Timeout for the TOML fetch. Defaults to 15 s. */
  timeoutMs?: number;
}

/**
 * Verify an inbound SEP-31 transaction-status callback from an anchor.
 *
 * Steps:
 * 1. Validate the payload structure (required fields present).
 * 2. Fetch the anchor's `stellar.toml` to retrieve the SIGNING_KEY.
 * 3. If `options.signature` and `options.bodyBytes` are provided, verify the
 *    Ed25519 signature against the signing key using the Web Crypto API.
 * 4. If `options.expectedAsset` is set, compare asset_code / asset_issuer.
 * 5. If `options.expectedAmountIn` is set, compare amount_in.
 * 6. Return a normalized {@link Sep31CallbackResult}.
 *
 * @param anchorDomain - The anchor's domain (e.g. `"anchor.example.com"`).
 *   Used to fetch the TOML signing key.
 * @param payload - Parsed JSON body of the callback request.
 * @param options - Signature bytes, expected asset/amount, and auth context.
 */
export async function verifySep31Callback(
  anchorDomain: string,
  payload: Sep31CallbackPayload,
  options: Sep31CallbackVerificationOptions = {},
): Promise<SorokitResult<Sep31CallbackResult>> {
  // ── 1. Structural validation ──────────────────────────────────────────────
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return err(SorokitErrorCode.VALIDATION, "SEP-31 callback payload must be an object.");
  }
  if (typeof payload.id !== "string" || !payload.id.trim()) {
    return err(SorokitErrorCode.VALIDATION, "SEP-31 callback is missing a valid `id` field.");
  }
  if (typeof payload.status !== "string" || !payload.status.trim()) {
    return err(SorokitErrorCode.VALIDATION, "SEP-31 callback is missing a valid `status` field.");
  }

  // ── 2. Fetch anchor signing key ───────────────────────────────────────────
  const tomlResult = await fetchStellarToml(anchorDomain, {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    verifyOnCacheHit: true,
  });
  if (tomlResult.status === "error") {
    return err(
      SorokitErrorCode.NETWORK_ERROR,
      `Failed to fetch stellar.toml for anchor "${anchorDomain}": ${tomlResult.error.message}`,
      tomlResult.error,
    );
  }

  const signingKey = tomlResult.data.SIGNING_KEY ?? tomlResult.data.signing_key;
  if (!signingKey) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Anchor "${anchorDomain}" stellar.toml does not define a SIGNING_KEY.`,
    );
  }

  // ── 3. Signature verification ─────────────────────────────────────────────
  if (options.signature !== undefined || options.bodyBytes !== undefined) {
    if (!options.signature || !options.bodyBytes) {
      return err(
        SorokitErrorCode.INVALID_AUTH,
        "Both `signature` and `bodyBytes` are required for callback signature verification.",
      );
    }
    const verifyResult = await verifySep31Signature(options.signature, options.bodyBytes, signingKey);
    if (verifyResult.status === "error") return verifyResult;
  }

  // ── 4. Asset mismatch check ───────────────────────────────────────────────
  if (options.expectedAsset) {
    const expectedCode = options.expectedAsset.code.trim().toUpperCase();
    const actualCode = (payload.asset_code ?? "").trim().toUpperCase();
    if (actualCode && actualCode !== expectedCode) {
      return err(
        SorokitErrorCode.VALIDATION,
        `SEP-31 callback asset_code mismatch: expected "${expectedCode}", got "${actualCode}".`,
      );
    }
    if (options.expectedAsset.issuer) {
      const expectedIssuer = options.expectedAsset.issuer.trim();
      const actualIssuer = (payload.asset_issuer ?? "").trim();
      if (actualIssuer && actualIssuer !== expectedIssuer) {
        return err(
          SorokitErrorCode.VALIDATION,
          `SEP-31 callback asset_issuer mismatch: expected "${expectedIssuer}", got "${actualIssuer}".`,
        );
      }
    }
  }

  // ── 5. Amount mismatch check ──────────────────────────────────────────────
  if (options.expectedAmountIn !== undefined) {
    const expected = options.expectedAmountIn.trim();
    const actual = (payload.amount_in ?? "").trim();
    if (actual && actual !== expected) {
      return err(
        SorokitErrorCode.VALIDATION,
        `SEP-31 callback amount_in mismatch: expected "${expected}", got "${actual}".`,
      );
    }
  }

  // ── 6. Normalize and return ───────────────────────────────────────────────
  const asset: DirectPaymentAsset | undefined = payload.asset_code
    ? {
        code: payload.asset_code,
        ...(payload.asset_issuer ? { issuer: payload.asset_issuer } : {}),
      }
    : undefined;

  const result: Sep31CallbackResult = {
    transactionId: payload.id,
    status: payload.status,
    ...(payload.amount_in !== undefined ? { amountIn: payload.amount_in } : {}),
    ...(payload.amount_out !== undefined ? { amountOut: payload.amount_out } : {}),
    ...(asset !== undefined ? { asset } : {}),
    ...(payload.updated_at !== undefined ? { updatedAt: payload.updated_at } : {}),
    ...(payload.message !== undefined ? { message: payload.message } : {}),
    raw: payload,
    ...(options.authToken !== undefined ? { authContext: options.authToken } : {}),
  };

  return ok(result);
}

/**
 * Verify an Ed25519 signature produced by the anchor's SIGNING_KEY over the
 * raw callback body bytes.
 *
 * The signature is expected to be a base64-encoded Ed25519 signature of the
 * raw UTF-8 body bytes, using the Stellar key encoding convention where the
 * raw 32-byte public key is extracted from the StrKey-encoded SIGNING_KEY.
 *
 * Uses the Web Crypto API (available in browsers and Node.js ≥ 18).
 */
async function verifySep31Signature(
  signatureB64: string,
  bodyBytes: Uint8Array,
  signingKeyStrKey: string,
): Promise<SorokitResult<void>> {
  // Decode the base64 signature
  let signatureBytes: Uint8Array;
  try {
    const normalized = signatureB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    signatureBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return err(SorokitErrorCode.INVALID_AUTH, "SEP-31 callback signature is not valid base64.");
  }

  // Extract the raw 32-byte Ed25519 public key from the Stellar StrKey.
  // A Stellar G... account key is: 1 byte version (0x06 << 3 = 0x30) + 32 bytes key + 2 bytes checksum.
  let rawPublicKey: Uint8Array;
  try {
    const decoded = base32Decode(signingKeyStrKey);
    if (decoded.length !== 35) {
      return err(SorokitErrorCode.INVALID_AUTH, "SEP-31 anchor SIGNING_KEY has unexpected length after decoding.");
    }
    rawPublicKey = decoded.slice(1, 33);
  } catch {
    return err(SorokitErrorCode.INVALID_AUTH, "SEP-31 anchor SIGNING_KEY could not be decoded.");
  }

  // Use Web Crypto to verify
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      rawPublicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify("Ed25519", cryptoKey, signatureBytes, bodyBytes);
    if (!valid) {
      return err(SorokitErrorCode.INVALID_AUTH, "SEP-31 callback signature verification failed: signature does not match.");
    }
    return ok(undefined);
  } catch (cause) {
    // Web Crypto may not support Ed25519 in older runtimes; surface as config error.
    return err(
      SorokitErrorCode.INVALID_AUTH,
      "SEP-31 callback signature verification failed.",
      cause,
    );
  }
}

/**
 * Minimal base32 decoder for Stellar StrKey encoded values.
 * Alphabet: ABCDEFGHIJKLMNOPQRSTUVWXYZ234567
 */
function base32Decode(input: string): Uint8Array {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const lookup = new Map<string, number>(
    ALPHABET.split("").map((c, i) => [c, i]),
  );
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const v = lookup.get(char);
    if (v === undefined) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export interface DirectPaymentReceiver {
  account?: string;
  stellarAddress?: string;
  [key: string]: unknown;
}

export interface DirectPaymentQuoteRequestOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  authToken?: string;
  accountId?: string;
  params?: Record<string, string>;
}

function normalizeServerUrl(serverUrl: string): URL {
  const value = serverUrl.trim();
  if (!value) throw new Error("A server URL is required.");
  return /^https?:\/\//i.test(value)
    ? new URL(value.endsWith("/") ? value : `${value}/`)
    : new URL(`https://${value}`);
}

async function fetchJson<T>(
  fetcher: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const data = (await response.json()) as T;
    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Request failed with status ${response.status}.`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function resolveReceiverAddress(receiver: string | DirectPaymentReceiver): string {
  if (typeof receiver === "string") return receiver.trim();
  const address = receiver.stellarAddress ?? receiver.account;
  if (typeof address !== "string" || !address.trim()) {
    throw new Error("A valid receiver address is required.");
  }
  return address.trim();
}

export async function quoteDirectPayment(
  serverUrl: string,
  sendingAsset: DirectPaymentAsset,
  receiver: string | DirectPaymentReceiver,
  options: DirectPaymentQuoteRequestOptions = {},
): Promise<SorokitResult<Record<string, unknown>>> {
  if (!sendingAsset?.code?.trim()) {
    return err(SorokitErrorCode.VALIDATION, "A sending asset code is required.");
  }
  let receiverAddress: string;
  try {
    receiverAddress = resolveReceiverAddress(receiver);
  } catch (cause) {
    return err(SorokitErrorCode.VALIDATION, "A valid receiver address is required.", cause);
  }
  try {
    const base = normalizeServerUrl(serverUrl);
    const url = new URL("sep31/quote", base.toString());
    url.searchParams.set("asset_code", sendingAsset.code);
    if (sendingAsset.issuer) url.searchParams.set("asset_issuer", sendingAsset.issuer);
    url.searchParams.set("recipient", receiverAddress);
    if (options.accountId) url.searchParams.set("account", options.accountId);
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") {
      return err(SorokitErrorCode.INVALID_CONFIG, "A fetch implementation is required.");
    }
    const result = await fetchJson<Record<string, unknown>>(
      fetcher,
      url,
      {
        method: "GET",
        headers: options.authToken ? { Authorization: `Bearer ${options.authToken}`, Accept: "application/json" } : { Accept: "application/json" },
      },
      options.timeoutMs ?? 15_000,
    );
    return ok(result);
  } catch (cause) {
    return err(SorokitErrorCode.NETWORK_ERROR, "SEP-31 direct payment quote failed.", cause);
  }
}

export async function sendDirectPayment(
  serverUrl: string,
  amount: string,
  receiver: string | DirectPaymentReceiver,
  options: DirectPaymentQuoteRequestOptions = {},
): Promise<SorokitResult<Record<string, unknown>>> {
  if (!amount?.trim()) {
    return err(SorokitErrorCode.VALIDATION, "A payment amount is required.");
  }
  let receiverAddress: string;
  try {
    receiverAddress = resolveReceiverAddress(receiver);
  } catch (cause) {
    return err(SorokitErrorCode.VALIDATION, "A valid receiver address is required.", cause);
  }
  try {
    const base = normalizeServerUrl(serverUrl);
    const url = new URL("sep31/transactions", base.toString());
    url.searchParams.set("amount", amount);
    url.searchParams.set("recipient", receiverAddress);
    if (options.accountId) url.searchParams.set("account", options.accountId);
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") {
      return err(SorokitErrorCode.INVALID_CONFIG, "A fetch implementation is required.");
    }
    const result = await fetchJson<Record<string, unknown>>(
      fetcher,
      url,
      {
        method: "POST",
        headers: options.authToken ? { Authorization: `Bearer ${options.authToken}`, Accept: "application/json" } : { Accept: "application/json" },
      },
      options.timeoutMs ?? 15_000,
    );
    return ok(result);
  } catch (cause) {
    return err(SorokitErrorCode.NETWORK_ERROR, "SEP-31 direct payment submission failed.", cause);
  }
}

export async function trackDirectPayment(
  serverUrl: string,
  txId: string,
  options: DirectPaymentQuoteRequestOptions = {},
): Promise<SorokitResult<Record<string, unknown>>> {
  if (!txId?.trim()) {
    return err(SorokitErrorCode.VALIDATION, "A transaction ID is required.");
  }
  try {
    const base = normalizeServerUrl(serverUrl);
    const url = new URL("sep31/transactions", base.toString());
    url.searchParams.set("id", txId);
    if (options.accountId) url.searchParams.set("account", options.accountId);
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") {
      return err(SorokitErrorCode.INVALID_CONFIG, "A fetch implementation is required.");
    }
    const result = await fetchJson<Record<string, unknown>>(
      fetcher,
      url,
      {
        method: "GET",
        headers: options.authToken ? { Authorization: `Bearer ${options.authToken}`, Accept: "application/json" } : { Accept: "application/json" },
      },
      options.timeoutMs ?? 15_000,
    );
    return ok(result);
  } catch (cause) {
    return err(SorokitErrorCode.NETWORK_ERROR, "SEP-31 direct payment tracking failed.", cause);
  }
}
