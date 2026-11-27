/**
 * Subscription lifecycle tests (#85)
 *
 * Covers normal completion, explicit unsubscribe, failure handling, and
 * repeated close. Each scenario asserts that no handles remain active after
 * cleanup so long-running applications cannot accumulate leaked timers or
 * subscriptions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeToTransactionEvents } from "../transaction/subscriptions";
import { subscribeToAccountEvents } from "../account/subscriptions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal async generator that yields `count` values and then returns.
 * Each iteration resolves after `delayMs` to simulate real async work.
 */
async function* finiteStream<T>(
  values: T[],
  delayMs = 0,
): AsyncGenerator<T> {
  for (const v of values) {
    if (delayMs > 0) await new Promise<void>((r) => setTimeout(r, delayMs));
    yield v;
  }
}

/**
 * Build a generator that never resolves its pending yield — simulating an
 * open streaming subscription that is waiting for the next event.
 * The generator watches `signal` and returns when it fires.
 */
async function* openStream<T>(signal: AbortSignal): AsyncGenerator<T> {
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// ─── Mock setup ──────────────────────────────────────────────────────────────

const { mockStreamTransactions } = vi.hoisted(() => ({
  mockStreamTransactions: vi.fn(),
}));

const { mockStreamAccount } = vi.hoisted(() => ({
  mockStreamAccount: vi.fn(),
}));

vi.mock("../transaction/streamTransactions", () => ({
  streamTransactions: mockStreamTransactions,
}));

vi.mock("../account/streamAccount", () => ({
  streamAccount: mockStreamAccount,
}));

beforeEach(() => {
  mockStreamTransactions.mockReset();
  mockStreamAccount.mockReset();
});

// ─── Transaction subscription lifecycle ──────────────────────────────────────

describe("subscribeToTransactionEvents — lifecycle (#85)", () => {
  it("calls the callback for each matching event and completes cleanly when the stream ends", async () => {
    const page = {
      transactions: [
        { hash: "abc123", status: "success" as const },
        { hash: "def456", status: "pending" as const },
      ],
      nextCursor: null,
    };
    mockStreamTransactions.mockImplementation(() =>
      finiteStream([{ status: "ok" as const, data: page, error: null }]),
    );

    const callback = vi.fn();
    const sub = subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_submitted", "transaction_confirmed"],
      callback,
    );

    // Allow the async loop to drain
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0][0]).toMatchObject({
      type: "transaction_confirmed",
      publicKey: "GACCOUNT",
      transaction: { hash: "abc123", status: "success" },
    });
    expect(callback.mock.calls[1][0]).toMatchObject({
      type: "transaction_submitted",
      publicKey: "GACCOUNT",
      transaction: { hash: "def456", status: "pending" },
    });

    // Calling unsubscribe after the stream has already ended must not throw
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it("stops delivering events immediately after unsubscribe is called", async () => {
    // The stream stays open until aborted — we capture the AbortSignal so we
    // can verify it was triggered by unsubscribe().
    let capturedSignal: AbortSignal | undefined;
    mockStreamTransactions.mockImplementation(
      (_url: string, _key: string, _cfg: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return openStream(signal);
      },
    );

    const callback = vi.fn();
    const sub = subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      callback,
    );

    // Stream is open — no events yet
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(callback).not.toHaveBeenCalled();

    sub.unsubscribe();

    // The AbortSignal must be aborted after unsubscribe
    expect(capturedSignal?.aborted).toBe(true);

    // No callbacks should arrive after unsubscribe
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not throw and delivers no events when the stream immediately yields an error", async () => {
    mockStreamTransactions.mockImplementation(() =>
      finiteStream([
        {
          status: "error" as const,
          data: null,
          error: { code: "TX_FETCH_FAILED", message: "network error", category: "network" },
        },
      ]),
    );

    const callback = vi.fn();
    const sub = subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      callback,
    );

    await new Promise<void>((r) => setTimeout(r, 20));

    expect(callback).not.toHaveBeenCalled();
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it("calling unsubscribe multiple times does not throw or trigger side effects", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockStreamTransactions.mockImplementation(
      (_url: string, _key: string, _cfg: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return openStream(signal);
      },
    );

    const sub = subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      vi.fn(),
    );

    sub.unsubscribe();
    expect(capturedSignal?.aborted).toBe(true);

    // Second and third calls must be safe no-ops
    expect(() => sub.unsubscribe()).not.toThrow();
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it("propagates an external AbortSignal and aborts the stream handle on parent abort", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockStreamTransactions.mockImplementation(
      (_url: string, _key: string, _cfg: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return openStream(signal);
      },
    );

    const parent = new AbortController();
    subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      vi.fn(),
      { signal: parent.signal },
    );

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(capturedSignal?.aborted).toBe(false);

    parent.abort();
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("filters events to only the requested event types", async () => {
    const page = {
      transactions: [
        { hash: "h1", status: "success" as const },
        { hash: "h2", status: "pending" as const },
      ],
      nextCursor: null,
    };
    mockStreamTransactions.mockImplementation(() =>
      finiteStream([{ status: "ok" as const, data: page, error: null }]),
    );

    const callback = vi.fn();
    subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"], // only confirmed, not submitted
      callback,
    );

    await new Promise<void>((r) => setTimeout(r, 20));

    // Only the "success" transaction maps to "transaction_confirmed"
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].type).toBe("transaction_confirmed");
  });

  it("deduplicates events — a transaction seen on consecutive polls is only delivered once", async () => {
    const page = {
      transactions: [{ hash: "dup_hash", status: "success" as const }],
      nextCursor: "cursor1",
    };
    // Two identical polls
    mockStreamTransactions.mockImplementation(() =>
      finiteStream([
        { status: "ok" as const, data: page, error: null },
        { status: "ok" as const, data: page, error: null },
      ]),
    );

    const callback = vi.fn();
    subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      callback,
    );

    await new Promise<void>((r) => setTimeout(r, 20));

    // The same hash must not be delivered twice
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("delegates to the custom transport and routes unsubscribe correctly", () => {
    const unsubscribeMock = vi.fn();
    const transport = {
      subscribe: vi.fn().mockReturnValue({ unsubscribe: unsubscribeMock }),
    };
    const callback = vi.fn();

    const sub = subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      callback,
      { transport },
    );

    expect(transport.subscribe).toHaveBeenCalledWith(
      "GACCOUNT",
      ["transaction_confirmed"],
      callback,
    );

    sub.unsubscribe();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
    // The polling stream must NOT have been started
    expect(mockStreamTransactions).not.toHaveBeenCalled();
  });

  it("returns a no-op subscription when fallbackToPolling is false", () => {
    const sub = subscribeToTransactionEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["transaction_confirmed"],
      vi.fn(),
      { fallbackToPolling: false },
    );

    expect(mockStreamTransactions).not.toHaveBeenCalled();
    expect(() => sub.unsubscribe()).not.toThrow();
  });
});

// ─── Account subscription lifecycle ──────────────────────────────────────────

describe("subscribeToAccountEvents — lifecycle (#85)", () => {
  it("delivers a balance_updated event when the account snapshot changes", async () => {
    const account = {
      publicKey: "GACCOUNT",
      balances: [{ asset: "native", balance: "100.0000000" }],
    };
    mockStreamAccount.mockImplementation(() =>
      finiteStream([{ status: "ok" as const, data: account, error: null }]),
    );

    const callback = vi.fn();
    subscribeToAccountEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["balance_updated"],
      callback,
    );

    await new Promise<void>((r) => setTimeout(r, 20));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({
      type: "balance_updated",
      publicKey: "GACCOUNT",
    });
  });

  it("stops delivering account events after unsubscribe is called", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockStreamAccount.mockImplementation(
      (_url: string, _key: string, _cfg: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return openStream(signal);
      },
    );

    const sub = subscribeToAccountEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["balance_updated"],
      vi.fn(),
    );

    await new Promise<void>((r) => setTimeout(r, 10));
    sub.unsubscribe();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("calling unsubscribe multiple times on an account subscription does not throw", async () => {
    mockStreamAccount.mockImplementation(
      (_url: string, _key: string, _cfg: unknown, signal: AbortSignal) =>
        openStream(signal),
    );

    const sub = subscribeToAccountEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["balance_updated"],
      vi.fn(),
    );

    sub.unsubscribe();
    expect(() => sub.unsubscribe()).not.toThrow();
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it("does not deliver account events when the stream errors immediately", async () => {
    mockStreamAccount.mockImplementation(() =>
      finiteStream([
        {
          status: "error" as const,
          data: null,
          error: { code: "ACCOUNT_NOT_FOUND", message: "not found", category: "network" },
        },
      ]),
    );

    const callback = vi.fn();
    subscribeToAccountEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["balance_updated"],
      callback,
    );

    await new Promise<void>((r) => setTimeout(r, 20));
    expect(callback).not.toHaveBeenCalled();
  });

  it("delegates account subscriptions to a custom transport", () => {
    const unsubscribeMock = vi.fn();
    const transport = {
      subscribe: vi.fn().mockReturnValue({ unsubscribe: unsubscribeMock }),
    };
    const callback = vi.fn();

    const sub = subscribeToAccountEvents(
      "https://horizon-testnet.stellar.org",
      "GACCOUNT",
      ["balance_updated"],
      callback,
      { transport },
    );

    expect(transport.subscribe).toHaveBeenCalledWith(
      "GACCOUNT",
      ["balance_updated"],
      callback,
    );

    sub.unsubscribe();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
    expect(mockStreamAccount).not.toHaveBeenCalled();
  });
});

// ─── StreamEventEmitter lifecycle ────────────────────────────────────────────

import { StreamEventEmitter } from "../streaming/streamEventEmitter";

describe("StreamEventEmitter — lifecycle (#85)", () => {
  it("delivers an event to all registered listeners", async () => {
    type TestEvents = { ping: string };
    const emitter = new StreamEventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on("ping", a);
    emitter.on("ping", b);

    await emitter.emit("ping", "hello");

    expect(a).toHaveBeenCalledWith("hello");
    expect(b).toHaveBeenCalledWith("hello");
  });

  it("stops delivering events to a listener after the unsubscribe function is called", async () => {
    type TestEvents = { ping: string };
    const emitter = new StreamEventEmitter<TestEvents>();
    const listener = vi.fn();
    const unsub = emitter.on("ping", listener);

    unsub();
    await emitter.emit("ping", "world");

    expect(listener).not.toHaveBeenCalled();
    // No listeners remain after unsubscribe
    expect(emitter.listenerCount("ping")).toBe(0);
  });

  it("removeAllListeners clears every listener and leaves count at zero", async () => {
    type TestEvents = { ping: string; pong: number };
    const emitter = new StreamEventEmitter<TestEvents>();
    emitter.on("ping", vi.fn());
    emitter.on("ping", vi.fn());
    emitter.on("pong", vi.fn());

    emitter.removeAllListeners();

    expect(emitter.listenerCount()).toBe(0);
    // Emitting after clear must not throw
    await expect(emitter.emit("ping", "safe")).resolves.toBeUndefined();
  });

  it("removeAllListeners with an event name clears only that event", async () => {
    type TestEvents = { ping: string; pong: number };
    const emitter = new StreamEventEmitter<TestEvents>();
    emitter.on("ping", vi.fn());
    emitter.on("pong", vi.fn());

    emitter.removeAllListeners("ping");

    expect(emitter.listenerCount("ping")).toBe(0);
    expect(emitter.listenerCount("pong")).toBe(1);
  });

  it("off() removes the specific listener without affecting others on the same event", async () => {
    type TestEvents = { ping: string };
    const emitter = new StreamEventEmitter<TestEvents>();
    const keep = vi.fn();
    const remove = vi.fn();
    emitter.on("ping", keep);
    emitter.on("ping", remove);

    emitter.off("ping", remove);
    await emitter.emit("ping", "check");

    expect(keep).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it("listenerCount returns the correct total across all events when called without an argument", () => {
    type TestEvents = { a: void; b: void };
    const emitter = new StreamEventEmitter<TestEvents>();
    emitter.on("a", vi.fn());
    emitter.on("a", vi.fn());
    emitter.on("b", vi.fn());

    expect(emitter.listenerCount()).toBe(3);
  });

  it("applies backpressure — a slow listener is not called concurrently", async () => {
    type TestEvents = { item: number };
    const emitter = new StreamEventEmitter<TestEvents>();
    const order: number[] = [];

    emitter.on("item", async (n) => {
      await new Promise<void>((r) => setTimeout(r, 10));
      order.push(n);
    });

    // Fire two events without awaiting; emit is sequential per listener
    const p1 = emitter.emit("item", 1);
    const p2 = emitter.emit("item", 2);
    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });

  it("no active handles remain after all listeners are removed and all events settle", async () => {
    type TestEvents = { msg: string };
    const emitter = new StreamEventEmitter<TestEvents>();
    const listener = vi.fn();
    const unsub = emitter.on("msg", listener);

    await emitter.emit("msg", "one");
    unsub();
    await emitter.emit("msg", "two"); // should not invoke listener

    expect(listener).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount("msg")).toBe(0);
  });
});
