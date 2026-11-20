/**
 * Concurrency tests for bounded request pools (#88).
 *
 * Uses a deterministic delayed transport — manually resolved promises — so
 * every assertion about in-flight count, queue depth, ordering, and error
 * recovery is fully synchronous and not subject to timer scheduling.
 */

import { describe, it, expect, vi } from "vitest";
import { createRateLimiter, SorokitRateLimitError, withRateLimit } from "../../src/utility/rateLimiter";
import { SorokitErrorCode } from "../../src/shared/response";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a controlled async operation whose resolution is deferred until the
 * caller calls `release()`. This lets tests assert state while the operation
 * is still in-flight.
 */
function deferredOp<T = string>(value: T): {
  op: () => Promise<T>;
  release: () => void;
  reject: (reason?: unknown) => void;
} {
  let resolveHandle!: (v: T) => void;
  let rejectHandle!: (r?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveHandle = res;
    rejectHandle = rej;
  });
  return {
    op: () => promise,
    release: () => resolveHandle(value),
    reject: (reason) => rejectHandle(reason),
  };
}

/** Flush the microtask queue so queued promise continuations can run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Maximum in-flight count ─────────────────────────────────────────────────

describe("maximum in-flight count", () => {
  it("never exceeds the pool limit while operations are running", async () => {
    // A pool of 3 within a 10-second window (effectively: at most 3 at once).
    const limiter = createRateLimiter(3, 10_000, { maxRetries: 0 });

    const ops = Array.from({ length: 3 }, (_, i) => deferredOp(`r${i}`));
    const extra = deferredOp("extra");

    // Start 3 — they should all be admitted immediately.
    const results = ops.map(({ op }) => limiter.execute(op));
    // Start a 4th — it must queue behind the 3 already running.
    const extraResult = limiter.execute(extra.op);

    await flushMicrotasks();

    // The 4th is in the queue; pending reflects what is waiting, not running.
    expect(limiter.pending).toBe(1);

    // Release the first two; the third is still holding its slot.
    ops[0]!.release();
    ops[1]!.release();
    await flushMicrotasks();

    // Queue drains as slots open.
    expect(limiter.pending).toBe(0);

    // Clean up.
    ops[2]!.release();
    extra.release();
    await Promise.all([...results, extraResult]);
  });

  it("tracks pending count accurately across sequential batches", async () => {
    const limiter = createRateLimiter(2, 10_000, { maxRetries: 0 });
    const batch = Array.from({ length: 4 }, (_, i) => deferredOp(`b${i}`));
    const promises = batch.map(({ op }) => limiter.execute(op));

    await flushMicrotasks();

    // 2 running + 2 queued.
    expect(limiter.pending).toBe(2);

    batch[0]!.release();
    batch[1]!.release();
    await flushMicrotasks();

    // Queue drained as slots opened.
    expect(limiter.pending).toBe(0);

    batch[2]!.release();
    batch[3]!.release();
    await Promise.all(promises);
    expect(limiter.pending).toBe(0);
  });
});

// ─── Bounded queue overflow ───────────────────────────────────────────────────

describe("bounded queue overflow", () => {
  it("rejects immediately when the queue is full", async () => {
    // limit=1, maxQueueSize=2 — 1 running + 2 waiting = 3 total; the 4th must fail.
    const limiter = createRateLimiter(1, 10_000, {
      maxRetries: 0,
      maxQueueSize: 2,
    });

    const inflight = deferredOp("running");
    const q1 = deferredOp("q1");
    const q2 = deferredOp("q2");
    const overflow = deferredOp("overflow");

    limiter.execute(inflight.op);
    limiter.execute(q1.op);
    limiter.execute(q2.op);
    const overflowResult = await limiter.execute(overflow.op);

    expect(overflowResult.status).toBe("error");
    if (overflowResult.status === "error") {
      expect(overflowResult.error.code).toBe(SorokitErrorCode.RATE_LIMITED);
    }

    // Clean up.
    inflight.release();
    q1.release();
    q2.release();
    overflow.release();
  });

  it("accepts new requests again after the queue drains below maxQueueSize", async () => {
    const limiter = createRateLimiter(1, 10_000, {
      maxRetries: 0,
      maxQueueSize: 1,
    });

    const inflight = deferredOp("a");
    const queued = deferredOp("b");

    const p1 = limiter.execute(inflight.op);
    const p2 = limiter.execute(queued.op);
    await flushMicrotasks();

    // Queue is at capacity — overflow must fail.
    const overflow = await limiter.execute(deferredOp("overflow").op);
    expect(overflow.status).toBe("error");

    // Drain — the queued one runs and completes.
    inflight.release();
    queued.release();
    await Promise.all([p1, p2]);

    // Now a fresh request must succeed.
    const fresh = deferredOp("fresh");
    const p3 = limiter.execute(fresh.op);
    fresh.release();
    const r3 = await p3;
    expect(r3.status).toBe("ok");
  });
});

// ─── Eventual completion ──────────────────────────────────────────────────────

describe("eventual completion", () => {
  it("all queued requests complete when the pool processes them", async () => {
    const count = 10;
    const limiter = createRateLimiter(3, 10_000, { maxRetries: 0 });
    const ops = Array.from({ length: count }, (_, i) => deferredOp(i));
    const promises = ops.map(({ op }) => limiter.execute(op));

    // Release all deferred ops in order.
    for (const { release } of ops) {
      release();
      await flushMicrotasks();
    }

    const results = await Promise.all(promises);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(limiter.pending).toBe(0);
  });

  it("no requests are permanently blocked when the pool is busy", async () => {
    const limiter = createRateLimiter(2, 10_000, { maxRetries: 0 });
    const ops = Array.from({ length: 6 }, (_, i) => deferredOp(`v${i}`));
    const promises = ops.map(({ op }) => limiter.execute(op));

    // Release in pairs — simulates a pool that slowly drains.
    for (let i = 0; i < ops.length; i += 2) {
      ops[i]!.release();
      ops[i + 1]!.release();
      await flushMicrotasks();
    }

    const results = await Promise.all(promises);
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });
});

// ─── Error recovery ───────────────────────────────────────────────────────────

describe("error recovery", () => {
  it("a failed operation does not block subsequent requests", async () => {
    const limiter = createRateLimiter(1, 10_000, { maxRetries: 0 });

    const failing = deferredOp("fail");
    const good = deferredOp("good");

    const p1 = limiter.execute(failing.op);
    const p2 = limiter.execute(good.op);

    await flushMicrotasks();

    // Reject the first operation.
    failing.reject(new Error("transport failure"));
    await flushMicrotasks();

    // The second should still run and succeed.
    good.release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe("error");
    expect(r2.status).toBe("ok");
  });

  it("multiple consecutive errors leave the queue clear", async () => {
    const limiter = createRateLimiter(2, 10_000, { maxRetries: 0 });
    const errors = Array.from({ length: 3 }, () => deferredOp("x"));
    const success = deferredOp("ok");

    const promises = [
      ...errors.map(({ op }) => limiter.execute(op)),
      limiter.execute(success.op),
    ];

    await flushMicrotasks();

    for (const { reject } of errors) {
      reject(new Error("fail"));
      await flushMicrotasks();
    }

    success.release();

    const results = await Promise.all(promises);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === "error")).toHaveLength(3);
    expect(statuses.filter((s) => s === "ok")).toHaveLength(1);
    expect(limiter.pending).toBe(0);
  });

  it("recovery after a full-queue rejection allows the next request through", async () => {
    const limiter = createRateLimiter(1, 10_000, {
      maxRetries: 0,
      maxQueueSize: 0,
    });

    const inflight = deferredOp("inflight");
    limiter.execute(inflight.op);
    await flushMicrotasks();

    // Queue is at capacity (0 allowed) — this must reject immediately.
    const overflow = await limiter.execute(deferredOp("overflow").op);
    expect(overflow.status).toBe("error");

    // Once the in-flight op finishes, a new request must succeed.
    inflight.release();
    await flushMicrotasks();

    const fresh = deferredOp("fresh");
    const p = limiter.execute(fresh.op);
    fresh.release();
    const r = await p;
    expect(r.status).toBe("ok");
  });
});

// ─── FIFO ordering ────────────────────────────────────────────────────────────

describe("FIFO ordering", () => {
  it("drains the queue in submission order", async () => {
    const limiter = createRateLimiter(1, 10_000, { maxRetries: 0 });
    const completionOrder: number[] = [];

    const ops = Array.from({ length: 4 }, (_, i) => {
      const d = deferredOp(i);
      return { ...d, index: i };
    });

    const promises = ops.map(({ op, index }) =>
      limiter.execute(async () => {
        const result = await op();
        completionOrder.push(result);
        return result;
      }),
    );

    await flushMicrotasks();

    // Release one at a time; each release opens the next slot.
    for (const { release } of ops) {
      release();
      await flushMicrotasks();
    }

    await Promise.all(promises);
    expect(completionOrder).toEqual([0, 1, 2, 3]);
  });
});

// ─── withRateLimit decorator ─────────────────────────────────────────────────

describe("withRateLimit decorator pool", () => {
  it("rejects with SorokitRateLimitError when the queue overflows", async () => {
    const slow = vi.fn((): Promise<string> => new Promise(() => {})); // never resolves
    const limited = withRateLimit(
      { fetch: slow },
      { default: { limit: 1, windowMs: 10_000, options: { maxQueueSize: 0, maxRetries: 0 } } },
    );

    // First call occupies the single slot.
    limited.fetch();
    await flushMicrotasks();

    // Second call overflows.
    await expect(limited.fetch()).rejects.toBeInstanceOf(SorokitRateLimitError);
  });

  it("independent method limiters do not share quotas", async () => {
    const aOp = deferredOp("a");
    const bOp = deferredOp("b");

    const methods = {
      a: aOp.op,
      b: bOp.op,
    };

    const limited = withRateLimit(methods, {
      perMethod: {
        a: { limit: 1, windowMs: 10_000, options: { maxRetries: 0 } },
        b: { limit: 1, windowMs: 10_000, options: { maxRetries: 0 } },
      },
    });

    const pa = limited.a();
    const pb = limited.b();
    await flushMicrotasks();

    // Both should be running concurrently — neither is blocked by the other.
    aOp.release();
    bOp.release();

    const [ra, rb] = await Promise.all([pa, pb]);
    expect(ra).toBe("a");
    expect(rb).toBe("b");
  });
});
