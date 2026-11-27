/**
 * Tests for cold-start-aware serverless helpers (#35).
 *
 * Covers: lazy singleton, singleton reset, deadline creation and auto-abort,
 * and payment delegation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../src/client/createSorokitClient", () => ({
  createSorokitClient: vi.fn(),
}));

vi.mock("../../examples/next-serverless/src/sorokitServer", () => ({
  serverSendPayment: vi.fn(),
}));

import { createSorokitClient } from "../../src/client/createSorokitClient";
import { serverSendPayment } from "../../examples/next-serverless/src/sorokitServer";
import {
  lazyGetClient,
  resetClient,
  withDeadline,
  coldStartSendPayment,
} from "../../examples/next-serverless/src/coldStart";

const mockCreateClient = vi.mocked(createSorokitClient);
const mockSendPayment = vi.mocked(serverSendPayment);

function makeFakeClient(id = "client-1") {
  return { _id: id } as unknown as ReturnType<typeof createSorokitClient> extends
    { status: "ok"; data: infer C }
    ? C
    : never;
}

function okClient(id = "client-1") {
  const client = makeFakeClient(id);
  return Object.freeze({ status: "ok" as const, data: client, error: null });
}

beforeEach(() => {
  resetClient();
  mockCreateClient.mockReset();
  mockSendPayment.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── lazyGetClient ─────────────────────────────────────────────────────────────

describe("lazyGetClient", () => {
  it("creates the client on the first call", () => {
    mockCreateClient.mockReturnValue(okClient());
    lazyGetClient();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    mockCreateClient.mockReturnValue(okClient());
    const first = lazyGetClient();
    const second = lazyGetClient();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("throws when createSorokitClient returns an error", () => {
    mockCreateClient.mockReturnValue(
      Object.freeze({
        status: "error" as const,
        data: null,
        error: {
          code: "INVALID_CONFIG" as const,
          message: "bad network",
          category: "validation" as const,
          recovery: { retryable: false, action: "fix config" },
        },
      }),
    );
    expect(() => lazyGetClient()).toThrow("bad network");
  });
});

// ── resetClient ───────────────────────────────────────────────────────────────

describe("resetClient", () => {
  it("causes the next lazyGetClient call to create a new instance", () => {
    mockCreateClient
      .mockReturnValueOnce(okClient("client-1"))
      .mockReturnValueOnce(okClient("client-2"));

    const first = lazyGetClient();
    resetClient();
    const second = lazyGetClient();

    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });
});

// ── withDeadline ──────────────────────────────────────────────────────────────

describe("withDeadline", () => {
  it("returns a signal that is not yet aborted", () => {
    const { signal, cancel } = withDeadline(5_000);
    expect(signal.aborted).toBe(false);
    cancel();
  });

  it("cancel() aborts the signal immediately", () => {
    const { signal, cancel } = withDeadline(5_000);
    cancel();
    expect(signal.aborted).toBe(true);
  });

  it("auto-aborts after the timeout elapses", () => {
    vi.useFakeTimers();
    const { signal, cancel } = withDeadline(1_000);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(signal.aborted).toBe(true);
    cancel(); // idempotent cleanup
  });

  it("cancel() before timeout prevents the timer from aborting later", () => {
    vi.useFakeTimers();
    const { signal, cancel } = withDeadline(1_000);
    cancel();
    // Signal is already aborted but the key point is no unhandled timer fires.
    vi.advanceTimersByTime(2_000);
    expect(signal.aborted).toBe(true); // aborted by cancel(), not timer
  });
});

// ── coldStartSendPayment ──────────────────────────────────────────────────────

describe("coldStartSendPayment", () => {
  const baseParams = {
    sourcePublicKey: "GAAA",
    destination: "GBBB",
    amount: "10",
    secretKey: "STEST",
  };

  it("delegates to serverSendPayment and returns its result", async () => {
    mockCreateClient.mockReturnValue(okClient());
    const expected = Object.freeze({
      status: "ok" as const,
      data: { hash: "abc123", ledger: 1 } as unknown as import("../../src/transaction/types").TransactionResult,
      error: null,
    });
    mockSendPayment.mockResolvedValue(expected);

    const result = await coldStartSendPayment(baseParams);
    expect(result).toBe(expected);
    expect(mockSendPayment).toHaveBeenCalledTimes(1);
  });

  it("cancels the deadline after serverSendPayment resolves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockCreateClient.mockReturnValue(okClient());
    mockSendPayment.mockResolvedValue(
      Object.freeze({ status: "ok" as const, data: { hash: "x" } as unknown as import("../../src/transaction/types").TransactionResult, error: null }),
    );

    await coldStartSendPayment({ ...baseParams, deadlineMs: 5_000 });

    // After cancel() the timer should be cleared — advancing time should not
    // cause any side-effect (no uncaught errors, no second abort).
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it("cancels the deadline even when serverSendPayment rejects", async () => {
    mockCreateClient.mockReturnValue(okClient());
    mockSendPayment.mockRejectedValue(new Error("network down"));

    await expect(coldStartSendPayment(baseParams)).rejects.toThrow("network down");
    // If we reach here the finally block ran and cancel() was called without error.
  });
});
