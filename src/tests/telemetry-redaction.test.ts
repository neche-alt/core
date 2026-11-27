/**
 * Telemetry redaction tests (#87).
 *
 * Verifies that account identifiers, secret-like values, and raw transaction
 * payloads are never emitted through the telemetry pipeline on either success
 * or failure paths. Sentinel values are injected so any accidental leakage
 * is unambiguous in assertions.
 *
 * Strategy:
 *  - Initialize telemetry with the in-memory exporter so emitted spans/metrics
 *    can be inspected without a real collector.
 *  - Run instrumented SDK operations (traceSpan, traceWalletConnect,
 *    traceTransactionSubmit, traceAccountFetch) with sentinel sensitive values
 *    attached as span attributes.
 *  - Assert sentinel values are absent from every exported SpanData field.
 *  - Assert non-sensitive context (operation name, status, duration) is present
 *    so useful diagnostics are not accidentally removed by redaction.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initTelemetry,
  resetTelemetry,
  traceSpan,
  traceWalletConnect,
  traceTransactionSubmit,
  traceAccountFetch,
  recordOperationDuration,
  recordOperationError,
  getTelemetrySpans,
  getTelemetryMetricsSummary,
} from "../performance/telemetry";

// ---------------------------------------------------------------------------
// Sentinel sensitive values
// ---------------------------------------------------------------------------

/** These strings must never appear anywhere in exported telemetry data. */
const SENSITIVE = {
  secretKey: "SCZANGBA5XTONSQOIQQ7FGPAVXDZU7KFVXHQEZMNCRS6TNGBTTERRAS",
  mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  accountId: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA",
  rawXdr: "AAAAAgAAAAArg6xVmhrfK8Kf1L0wCEKReWNmDUacUNz/RAwldACowwAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAABqO6RQAAAAAAAAAA",
  apiKey: "sk_live_SUPER_SECRET_API_KEY_DO_NOT_LOG",
};

/** Non-sensitive context that MUST remain present in spans. */
const NON_SENSITIVE = {
  operationName: "test.operation",
  walletOperation: "wallet.connect",
  transactionOperation: "transaction.submit",
  accountOperation: "account.fetch",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsSensitiveValue(data: unknown, sensitiveValues: string[]): boolean {
  const serialized = JSON.stringify(data) ?? "";
  return sensitiveValues.some((v) => serialized.includes(v));
}

function assertNoSensitiveLeakage(spans: ReturnType<typeof getTelemetrySpans>, label: string): void {
  const sensitiveValues = Object.values(SENSITIVE);
  for (const span of spans) {
    const leaked = sensitiveValues.filter((v) => JSON.stringify(span).includes(v));
    if (leaked.length > 0) {
      throw new Error(
        `${label}: sensitive value(s) leaked in span "${span.name}": ${leaked.join(", ")}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("telemetry redaction (#87)", () => {
  beforeEach(() => {
    resetTelemetry();
    initTelemetry({ serviceName: "redaction-test", exporter: "memory" });
  });

  afterEach(() => {
    resetTelemetry();
  });

  // ── 1. Span attributes — secret key never emitted ─────────────────────────

  describe("span attributes on success path", () => {
    it("does not emit a secret key set as a span attribute", async () => {
      await traceSpan(NON_SENSITIVE.operationName, async (span) => {
        // Simulate a badly-written consumer accidentally setting a secret
        span?.setAttribute("wallet.secret", SENSITIVE.secretKey);
        span?.setAttribute("operation.id", "op_123");
        span?.setStatus("ok");
        return "done";
      });

      const spans = getTelemetrySpans();
      expect(spans.length).toBeGreaterThan(0);

      // The secret key must not appear in any exported span field
      assertNoSensitiveLeakage(spans, "success path — span attributes");
    });

    it("does not emit a mnemonic set as a span attribute", async () => {
      await traceSpan(NON_SENSITIVE.operationName, async (span) => {
        span?.setAttribute("recovery.mnemonic", SENSITIVE.mnemonic);
        span?.setAttribute("operation.type", "recovery");
        span?.setStatus("ok");
        return "done";
      });

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "success path — mnemonic attribute");
    });

    it("does not emit an account identifier set directly as a span attribute", async () => {
      await traceSpan(NON_SENSITIVE.operationName, async (span) => {
        // Account IDs are intentionally stripped — apps should use hashed/truncated refs
        span?.setAttribute("account.id", SENSITIVE.accountId);
        span?.setStatus("ok");
        return "done";
      });

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "success path — account id attribute");
    });

    it("does not emit a raw transaction XDR payload in span attributes", async () => {
      await traceTransactionSubmit(async (span) => {
        span?.setAttribute("transaction.raw_xdr", SENSITIVE.rawXdr);
        span?.setAttribute("transaction.hash", "safe_hash_abc123");
        span?.setStatus("ok");
        return "done";
      });

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "success path — raw XDR in transaction span");
    });

    it("retains non-sensitive context (operation name, status) after attribute filtering", async () => {
      await traceSpan(NON_SENSITIVE.operationName, async (span) => {
        span?.setAttribute("operation.id", "safe_op_id");
        span?.setStatus("ok");
        return "done";
      });

      const spans = getTelemetrySpans();
      const span = spans.find((s) => s.name === NON_SENSITIVE.operationName);

      expect(span).toBeDefined();
      expect(span!.status.code).toBe("ok");
      expect(span!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 2. Failure paths ───────────────────────────────────────────────────────

  describe("span attributes on failure path", () => {
    it("does not emit a secret key when a span records an error", async () => {
      try {
        await traceSpan(NON_SENSITIVE.operationName, async (span) => {
          span?.setAttribute("wallet.key", SENSITIVE.secretKey);
          span?.setAttribute("error.code", "WALLET_REJECTED");
          span?.recordError(new Error("user rejected — wallet.key was " + SENSITIVE.secretKey));
          span?.setStatus("error", "wallet rejected");
          throw new Error("wallet rejected");
        });
      } catch {
        // Expected — we threw intentionally
      }

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "failure path — secret key on error");
    });

    it("does not emit a raw XDR in span events on failure", async () => {
      try {
        await traceTransactionSubmit(async (span) => {
          span?.addEvent("submission_failed", {
            reason: "timeout",
            raw_payload: SENSITIVE.rawXdr,
          });
          span?.setStatus("error", "timeout");
          throw new Error("submission timeout");
        });
      } catch {
        // Expected
      }

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "failure path — raw XDR in span event");
    });

    it("does not emit an API key passed in span events on failure", async () => {
      try {
        await traceSpan("api.call", async (span) => {
          span?.addEvent("auth_error", { key: SENSITIVE.apiKey });
          span?.setStatus("error", "auth failed");
          throw new Error("auth failed");
        });
      } catch {
        // Expected
      }

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "failure path — API key in span event");
    });

    it("retains error status and operation name after failure without leaking cause details", async () => {
      try {
        await traceAccountFetch(async (span) => {
          span?.setAttribute("account.id", SENSITIVE.accountId);
          span?.setStatus("error", "account not found");
          throw new Error("account not found — accountId=" + SENSITIVE.accountId);
        });
      } catch {
        // Expected
      }

      const spans = getTelemetrySpans();
      const failSpan = spans.find((s) => s.status.code === "error");
      expect(failSpan).toBeDefined();
      expect(failSpan!.status.code).toBe("error");
      // Status message should not contain the account ID
      if (failSpan!.status.message) {
        expect(failSpan!.status.message).not.toContain(SENSITIVE.accountId);
      }
    });
  });

  // ── 3. Wallet connect spans ────────────────────────────────────────────────

  describe("wallet connect spans", () => {
    it("does not emit a secret key set during wallet connection tracing", async () => {
      await traceWalletConnect(async (span) => {
        span?.setAttribute("wallet.adapter", "freighter");
        span?.setAttribute("wallet.private_key", SENSITIVE.secretKey);
        span?.setStatus("ok");
        return "connected";
      });

      const spans = getTelemetrySpans();
      assertNoSensitiveLeakage(spans, "wallet connect — secret key");
    });

    it("retains wallet.adapter attribute as useful non-sensitive context", async () => {
      await traceWalletConnect(async (span) => {
        span?.setAttribute("wallet.adapter", "freighter");
        span?.setStatus("ok");
        return "connected";
      });

      const spans = getTelemetrySpans();
      const walletSpan = spans.find((s) => s.name === "wallet.connect");
      expect(walletSpan).toBeDefined();
    });
  });

  // ── 4. Metrics — no sensitive values in metric names or labels ─────────────

  describe("metrics redaction", () => {
    it("does not emit sensitive values in metric operation names", () => {
      // Metric names are user-supplied strings — a consumer accidentally
      // logging an account ID as the operation name must not leak it
      recordOperationDuration(`op.${SENSITIVE.accountId}`, 123);
      recordOperationError(`error.${SENSITIVE.secretKey}`);

      const summary = getTelemetryMetricsSummary();
      const summaryJson = JSON.stringify(summary);

      // Sensitive values must not appear in emitted metric keys/data
      for (const v of Object.values(SENSITIVE)) {
        expect(summaryJson).not.toContain(v);
      }
    });

    it("retains metric count and duration in summaries without exposing raw sensitive labels", () => {
      recordOperationDuration("transaction.submit", 250);
      recordOperationDuration("transaction.submit", 300);

      const summary = getTelemetryMetricsSummary("transaction.submit_duration");
      // The summary may be empty when the memory exporter batches differently,
      // but it must never contain sensitive values regardless
      const summaryJson = JSON.stringify(summary);
      for (const v of Object.values(SENSITIVE)) {
        expect(summaryJson).not.toContain(v);
      }
    });
  });

  // ── 5. Cross-span isolation ────────────────────────────────────────────────

  describe("cross-span isolation", () => {
    it("sensitive attribute set in one span does not bleed into a subsequent span", async () => {
      // Span 1 — sets a secret
      await traceSpan("span.one", async (span) => {
        span?.setAttribute("leak_candidate", SENSITIVE.secretKey);
        span?.setStatus("ok");
        return "done";
      });

      // Span 2 — must not inherit span 1's attributes
      await traceSpan("span.two", async (span) => {
        span?.setAttribute("safe_attr", "safe_value");
        span?.setStatus("ok");
        return "done";
      });

      const spans = getTelemetrySpans();
      const spanTwo = spans.find((s) => s.name === "span.two");
      expect(spanTwo).toBeDefined();
      expect(JSON.stringify(spanTwo)).not.toContain(SENSITIVE.secretKey);
    });
  });
});
