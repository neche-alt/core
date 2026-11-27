import { describe, it, expect, vi } from "vitest";
import { createRequestDeduplicator } from "../network/requestDedup";
import { deduplicateRequest, clearInflightRequests, getInflightRequestCount } from "../shared/utils";

describe("Request deduplication under cancellation races (#76)", () => {
  describe("createRequestDeduplicator concurrency and cancellation", () => {
    it("ensures cancellation of caller 1 does not corrupt caller 2 result", async () => {
      const dedup = createRequestDeduplicator({ enabled: true });
      let fetchCount = 0;

      const fetcher = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            fetchCount++;
            setTimeout(() => resolve("shared-account-data"), 50);
          }),
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const p1 = dedup.deduplicate(["account", "GABC"], fetcher, controller1.signal);
      const p2 = dedup.deduplicate(["account", "GABC"], fetcher, controller2.signal);

      expect(dedup.getInFlightCount()).toBe(1);

      // Caller 1 cancels early
      setTimeout(() => controller1.abort(new Error("caller 1 aborted")), 10);

      // Caller 1 must reject with its abort reason
      await expect(p1).rejects.toThrow("caller 1 aborted");

      // Caller 2 must resolve successfully with uncorrupted data
      const result2 = await p2;
      expect(result2).toBe("shared-account-data");

      // Underlying fetcher was only invoked once
      expect(fetchCount).toBe(1);
      expect(dedup.getInFlightCount()).toBe(0);
    });

    it("ensures cancellation of caller 2 does not corrupt caller 1 result", async () => {
      const dedup = createRequestDeduplicator({ enabled: true });

      const fetcher = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("success-data"), 50);
          }),
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const p1 = dedup.deduplicate(["tx", "hash123"], fetcher, controller1.signal);
      const p2 = dedup.deduplicate(["tx", "hash123"], fetcher, controller2.signal);

      // Caller 2 cancels early
      setTimeout(() => controller2.abort(new Error("caller 2 aborted")), 15);

      await expect(p2).rejects.toThrow("caller 2 aborted");
      const result1 = await p1;
      expect(result1).toBe("success-data");
      expect(dedup.getInFlightCount()).toBe(0);
    });

    it("aborts underlying operation and cleans up when all callers cancel", async () => {
      const dedup = createRequestDeduplicator({ enabled: true });
      let underlyingAborted = false;

      const fetcher = vi.fn(
        (signal?: AbortSignal) =>
          new Promise<string>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              underlyingAborted = true;
              reject(new Error("underlying request aborted"));
            });
            setTimeout(() => resolve("never-reached"), 100);
          }),
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const p1 = dedup.deduplicate(["feed", "events"], fetcher, controller1.signal);
      const p2 = dedup.deduplicate(["feed", "events"], fetcher, controller2.signal);

      // Both callers cancel
      controller1.abort(new Error("caller 1 left"));
      controller2.abort(new Error("caller 2 left"));

      await expect(p1).rejects.toThrow("caller 1 left");
      await expect(p2).rejects.toThrow("caller 2 left");

      // Underlying request aborted and cleaned up
      expect(underlyingAborted).toBe(true);
      expect(dedup.getInFlightCount()).toBe(0);

      // Subsequent call triggers fresh request
      const freshResult = await dedup.deduplicate(
        ["feed", "events"],
        () => Promise.resolve("fresh-data"),
      );
      expect(freshResult).toBe("fresh-data");
    });

    it("verifies completion order when callers cancel at different times", async () => {
      const dedup = createRequestDeduplicator({ enabled: true });
      const events: string[] = [];

      const fetcher = () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 60);
        });

      const c1 = new AbortController();
      const c2 = new AbortController();
      const c3 = new AbortController();

      const p1 = dedup.deduplicate(["order", "test"], fetcher, c1.signal).catch((e) => {
        events.push(`p1:${(e as Error).message}`);
      });
      const p2 = dedup.deduplicate(["order", "test"], fetcher, c2.signal).catch((e) => {
        events.push(`p2:${(e as Error).message}`);
      });
      const p3 = dedup.deduplicate(["order", "test"], fetcher, c3.signal).then((v) => {
        events.push(`p3:${v}`);
      });

      setTimeout(() => c1.abort(new Error("abort1")), 10);
      setTimeout(() => c2.abort(new Error("abort2")), 25);

      await Promise.all([p1, p2, p3]);

      expect(events).toEqual(["p1:abort1", "p2:abort2", "p3:done"]);
    });

    it("propagates underlying fetcher rejection to all awaiting callers and cleans up", async () => {
      const dedup = createRequestDeduplicator({ enabled: true });

      const fetcher = vi.fn(
        () =>
          new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error("network failure")), 20);
          }),
      );

      const p1 = dedup.deduplicate(["error", "test"], fetcher);
      const p2 = dedup.deduplicate(["error", "test"], fetcher);

      await expect(p1).rejects.toThrow("network failure");
      await expect(p2).rejects.toThrow("network failure");
      expect(dedup.getInFlightCount()).toBe(0);
    });

    it("rejects immediately if caller signal is pre-aborted", async () => {
      const dedup = createRequestDeduplicator({ enabled: true });
      const fetcher = vi.fn(() => Promise.resolve("data"));

      const controller = new AbortController();
      controller.abort(new Error("pre-aborted"));

      await expect(
        dedup.deduplicate(["pre", "aborted"], fetcher, controller.signal),
      ).rejects.toThrow("pre-aborted");

      expect(fetcher).not.toHaveBeenCalled();
      expect(dedup.getInFlightCount()).toBe(0);
    });

    it("bypasses deduplication when config.enabled is false or omitted", async () => {
      const dedup = createRequestDeduplicator({ enabled: false });
      let count = 0;
      const fetcher = () => {
        count++;
        return Promise.resolve(`res-${count}`);
      };

      const [r1, r2] = await Promise.all([
        dedup.deduplicate(["disabled", "key"], fetcher),
        dedup.deduplicate(["disabled", "key"], fetcher),
      ]);

      expect(r1).toBe("res-1");
      expect(r2).toBe("res-2");
      expect(count).toBe(2);
    });
  });

  describe("shared/utils deduplicateRequest with independent signals", () => {
    it("handles caller cancellation without corrupting concurrent callers", async () => {
      clearInflightRequests();
      let fetchCount = 0;

      const fn = () =>
        new Promise<string>((resolve) => {
          fetchCount++;
          setTimeout(() => resolve("shared-util-data"), 40);
        });

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const p1 = deduplicateRequest("util:key", fn, { signal: controller1.signal });
      const p2 = deduplicateRequest("util:key", fn, { signal: controller2.signal });

      expect(getInflightRequestCount()).toBe(1);

      controller1.abort(new Error("util caller 1 cancelled"));

      await expect(p1).rejects.toThrow("util caller 1 cancelled");
      const res2 = await p2;
      expect(res2).toBe("shared-util-data");
      expect(fetchCount).toBe(1);
      expect(getInflightRequestCount()).toBe(0);
    });
  });
});
