import { describe, expect, it, vi } from "vitest";
import { createRequestBatcher } from "../network/requestBatching";
import type { BatchFetcher } from "../network/requestBatching";

describe("createRequestBatcher", () => {
  it("batches identical concurrent requests into a single batchFetcher call (10 concurrent -> 1 request)", async () => {
    const impl: BatchFetcher<string, number> = async (keys) => {
      const map = new Map<string, number>();
      for (const key of keys) map.set(key, key.length);
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 10 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => batcher.request("GABC1234")),
    );

    expect(results).toEqual(Array(10).fill("GABC1234".length));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(["GABC1234"]);
    expect(batcher.getStats()).toMatchObject({ totalRequests: 10, totalBatches: 1, lastBatchSize: 1 });
  });

  it("collects distinct keys made within the window into one batch call", async () => {
    const impl: BatchFetcher<string, string> = async (keys) => {
      const map = new Map<string, string>();
      for (const key of keys) map.set(key, `value-${key}`);
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 20 });

    const [a, b, c] = await Promise.all([
      batcher.request("key-a"),
      batcher.request("key-b"),
      batcher.request("key-c"),
    ]);

    expect([a, b, c]).toEqual(["value-key-a", "value-key-b", "value-key-c"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Set(fetcher.mock.calls[0]?.[0])).toEqual(new Set(["key-a", "key-b", "key-c"]));
  });

  it("splits results back to the correct caller by key", async () => {
    const impl: BatchFetcher<number, string> = async (keys) => {
      const map = new Map<number, string>();
      for (const key of keys) map.set(key, `account-${key}`);
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 10 });

    const [r1, r2, r3] = await Promise.all([
      batcher.request(1),
      batcher.request(2),
      batcher.request(3),
    ]);

    expect(r1).toBe("account-1");
    expect(r2).toBe("account-2");
    expect(r3).toBe("account-3");
  });

  it("fires immediately once maxBatch distinct keys are queued, without waiting for the full window", async () => {
    const impl: BatchFetcher<number, number> = async (keys) => {
      const map = new Map<number, number>();
      for (const key of keys) map.set(key, key * 2);
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 5000, maxBatch: 3 });

    const start = Date.now();
    const results = await Promise.all([
      batcher.request(1),
      batcher.request(2),
      batcher.request(3),
    ]);
    const elapsedMs = Date.now() - start;

    expect(results).toEqual([2, 4, 6]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Should resolve almost immediately, not after the 5s window.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("starts a fresh batch after the previous window has flushed", async () => {
    const impl: BatchFetcher<string, string> = async (keys) => {
      const map = new Map<string, string>();
      for (const key of keys) map.set(key, key.toUpperCase());
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 5 });

    const first = await batcher.request("one");
    const second = await batcher.request("two");

    expect(first).toBe("ONE");
    expect(second).toBe("TWO");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(batcher.getStats().totalBatches).toBe(2);
  });

  it("rejects every waiter for a key the batchFetcher didn't return a result for", async () => {
    const impl: BatchFetcher<string, string> = async () => new Map();
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 10 });

    await expect(batcher.request("missing")).rejects.toThrow(/did not return a result/);
  });

  it("rejects every pending waiter in a batch when batchFetcher itself throws", async () => {
    const impl: BatchFetcher<string, string> = async () => {
      throw new Error("network down");
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 10 });

    const [r1, r2] = await Promise.allSettled([
      batcher.request("a"),
      batcher.request("b"),
    ]);

    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("rejected");
    if (r1.status === "rejected") expect((r1.reason as Error).message).toBe("network down");
  });

  it("bypasses batching entirely when disabled, calling batchFetcher once per request", async () => {
    const impl: BatchFetcher<string, number> = async (keys) => {
      const map = new Map<string, number>();
      for (const key of keys) map.set(key, 1);
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { enabled: false, windowMs: 1000 });

    await Promise.all([batcher.request("x"), batcher.request("x"), batcher.request("y")]);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("uses a custom keyFn to dedupe structurally-equal but referentially-distinct keys", async () => {
    const impl: BatchFetcher<{ id: string }, string> = async (keys) => {
      const map = new Map<{ id: string }, string>();
      for (const key of keys) map.set(key, `resolved-${key.id}`);
      return map;
    };
    const fetcher = vi.fn(impl);

    const batcher = createRequestBatcher(fetcher, { windowMs: 10 }, (key) => key.id);

    const [r1, r2] = await Promise.all([
      batcher.request({ id: "same" }),
      batcher.request({ id: "same" }),
    ]);

    expect(r1).toBe("resolved-same");
    expect(r2).toBe("resolved-same");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toHaveLength(1);
  });
});

describe("createRequestBatcher — adaptive windowing (#148)", () => {
  it("calls onFlush with batchSize and fillTimeMs after each flush", async () => {
    const impl: BatchFetcher<string, string> = async (keys) => {
      const m = new Map<string, string>();
      for (const k of keys) m.set(k, k.toUpperCase());
      return m;
    };
    const fetcher = vi.fn(impl);
    const flushEvents: Array<{ batchSize: number; fillTimeMs: number }> = [];

    const batcher = createRequestBatcher(fetcher, {
      windowMs: 10,
      onFlush: (s) => flushEvents.push(s),
    });

    await Promise.all([batcher.request("a"), batcher.request("b"), batcher.request("c")]);

    expect(flushEvents).toHaveLength(1);
    expect(flushEvents[0]?.batchSize).toBe(3);
    expect(typeof flushEvents[0]?.fillTimeMs).toBe("number");
    expect(flushEvents[0]?.fillTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("tracks avgBatchSize and avgBatchFillMs across multiple batches", async () => {
    const impl: BatchFetcher<string, string> = async (keys) => {
      const m = new Map<string, string>();
      for (const k of keys) m.set(k, k);
      return m;
    };
    const batcher = createRequestBatcher(vi.fn(impl), { windowMs: 5 });

    // First batch: 2 keys
    await Promise.all([batcher.request("x"), batcher.request("y")]);
    // Second batch: 1 key (after window expires)
    await batcher.request("z");

    const stats = batcher.getStats();
    expect(stats.totalBatches).toBe(2);
    expect(stats.avgBatchSize).toBeGreaterThan(0);
    expect(stats.avgBatchFillMs).toBeGreaterThanOrEqual(0);
  });

  it("initialises avgBatchSize and avgBatchFillMs to 0 before any flush", () => {
    const batcher = createRequestBatcher(vi.fn(async () => new Map()), { windowMs: 10 });
    const stats = batcher.getStats();
    expect(stats.avgBatchSize).toBe(0);
    expect(stats.avgBatchFillMs).toBe(0);
  });

  it("flushes immediately on maxBatch even when adaptiveWindow is true", async () => {
    const impl: BatchFetcher<number, number> = async (keys) => {
      const m = new Map<number, number>();
      for (const k of keys) m.set(k, k);
      return m;
    };
    const fetcher = vi.fn(impl);
    const flushEvents: Array<{ batchSize: number }> = [];

    const batcher = createRequestBatcher(fetcher, {
      adaptiveWindow: true,
      minWindowMs: 5,
      maxWindowMs: 50,
      targetLatencyMs: 100,
      maxBatch: 3,
      windowMs: 5000, // would wait 5 s without maxBatch trigger
      onFlush: (s) => flushEvents.push(s),
    });

    const start = Date.now();
    await Promise.all([batcher.request(1), batcher.request(2), batcher.request(3)]);
    const elapsed = Date.now() - start;

    expect(flushEvents[0]?.batchSize).toBe(3);
    // Must have flushed well before the 5 s window
    expect(elapsed).toBeLessThan(1000);
  });

  it("adaptiveWindow option does not break normal batching resolution", async () => {
    const impl: BatchFetcher<string, string> = async (keys) => {
      const m = new Map<string, string>();
      for (const k of keys) m.set(k, `v-${k}`);
      return m;
    };
    const batcher = createRequestBatcher(vi.fn(impl), {
      adaptiveWindow: true,
      minWindowMs: 2,
      maxWindowMs: 20,
      targetLatencyMs: 50,
    });

    const [a, b] = await Promise.all([batcher.request("alpha"), batcher.request("beta")]);
    expect(a).toBe("v-alpha");
    expect(b).toBe("v-beta");
  });

  it("targetLatencyMs caps the adaptive window", async () => {
    // With targetLatencyMs: 8 and maxWindowMs: 100, the effective window
    // must never exceed 8 ms regardless of the maxWindowMs setting.
    const impl: BatchFetcher<string, string> = async (keys) => {
      const m = new Map<string, string>();
      for (const k of keys) m.set(k, k);
      return m;
    };
    const flushTimes: number[] = [];
    const start = Date.now();

    const batcher = createRequestBatcher(vi.fn(impl), {
      adaptiveWindow: true,
      minWindowMs: 2,
      maxWindowMs: 100,
      targetLatencyMs: 8,
      onFlush: () => flushTimes.push(Date.now() - start),
    });

    await batcher.request("only-key");
    // Fill time must be <= targetLatencyMs + a small scheduling buffer
    expect(flushTimes[0]).toBeLessThan(50);
  });
});
