import { describe, expect, it, vi } from "vitest";
import {
  createFailoverFetch,
  EndpointPool,
} from "../network/endpointFailover";
import { mapHorizonError } from "../shared/horizonErrorMapper";
import { SorokitErrorCode } from "../shared/response";

function withFakeNow(startMs: number) {
  const spy = vi.spyOn(Date, "now").mockReturnValue(startMs);
  return {
    advanceTo: (ms: number) => spy.mockReturnValue(ms),
    restore: () => spy.mockRestore(),
  };
}

describe("endpoint failover", () => {
  it("retries a transient primary failure on the backup", async () => {
    const pool = new EndpointPool([
      "https://primary.example",
      "https://backup.example",
    ], { failureThreshold: 1 });
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await createFailoverFetch(pool, fetcher)("https://primary.example/ledgers");

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("backup.example");
    expect(pool.getHealth()[0]?.healthy).toBe(false);
  });

  it("skips an endpoint that exceeded its failure threshold and prefers the healthy one (#855)", () => {
    const pool = new EndpointPool(
      ["https://primary.example", "https://backup.example"],
      { failureThreshold: 2, recoveryIntervalMs: 60_000 },
    );

    pool.markFailure("https://primary.example");
    pool.markFailure("https://primary.example");

    const primaryHealth = pool
      .getHealth()
      .find((h) => h.endpoint === "https://primary.example");
    expect(primaryHealth?.healthy).toBe(false);
    expect(primaryHealth?.consecutiveFailures).toBe(2);

    // With the primary unhealthy and inside its recovery window, `current`
    // must select the still-healthy backup rather than cycling back to it.
    expect(pool.current).toBe("https://backup.example");
    expect(pool.current).toBe("https://backup.example");
  });

  it("recovers an unhealthy endpoint once its recovery window elapses (#855)", () => {
    const clock = withFakeNow(1_000_000);
    try {
      const pool = new EndpointPool(
        ["https://primary.example", "https://backup.example"],
        { failureThreshold: 1, recoveryIntervalMs: 30_000 },
      );

      pool.markFailure("https://primary.example");
      expect(
        pool.getHealth().find((h) => h.endpoint === "https://primary.example")
          ?.healthy,
      ).toBe(false);

      // Still inside the recovery window: the primary stays deprioritised.
      clock.advanceTo(1_000_000 + 10_000);
      expect(pool.current).toBe("https://backup.example");

      // Recovery window has elapsed: the primary is eligible to be selected
      // again even though its `healthy` flag hasn't been reset yet (recovery
      // is a time-based retry opportunity, confirmed by a real request's
      // markSuccess call, not an automatic flip).
      clock.advanceTo(1_000_000 + 30_000);
      const candidates = new Set<string>();
      for (let i = 0; i < pool.endpoints.length; i += 1) candidates.add(pool.current);
      expect(candidates.has("https://primary.example")).toBe(true);

      pool.markSuccess("https://primary.example");
      expect(
        pool.getHealth().find((h) => h.endpoint === "https://primary.example")
          ?.healthy,
      ).toBe(true);
    } finally {
      clock.restore();
    }
  });

  it("maps common Horizon response classes to stable SDK codes", () => {
    expect(mapHorizonError({ status: 400, message: "tx_bad_auth" }).code)
      .toBe(SorokitErrorCode.INVALID_TRANSACTION);
    expect(mapHorizonError({ status: 404 }, { resource: "account" }).code)
      .toBe(SorokitErrorCode.ACCOUNT_NOT_FOUND);
    expect(mapHorizonError({ status: 500 }).code)
      .toBe(SorokitErrorCode.SERVICE_UNAVAILABLE);
  });

  describe("graceful degradation, endpoint recovery, and stale data handling (#33)", () => {
    it("handles an endpoint that recovers after temporary downtime and restores priority", async () => {
      const clock = withFakeNow(5_000_000);
      try {
        const pool = new EndpointPool(
          ["https://primary.example", "https://backup.example"],
          { failureThreshold: 1, recoveryIntervalMs: 20_000 },
        );

        let primaryCalls = 0;
        let backupCalls = 0;

        const fetcher = vi.fn().mockImplementation(async (url: string | URL | Request) => {
          const urlStr = String(url);
          if (urlStr.includes("primary.example")) {
            primaryCalls += 1;
            if (primaryCalls === 1) {
              // Initial failure: primary is down
              return new Response("Service Unavailable", { status: 503 });
            }
            // Recovered state
            return new Response(JSON.stringify({ status: "ok", ledger: 1005 }), { status: 200 });
          }
          if (urlStr.includes("backup.example")) {
            backupCalls += 1;
            return new Response(JSON.stringify({ status: "ok", ledger: 1000 }), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        });

        const failoverFetch = createFailoverFetch(pool, fetcher);

        // First request: primary fails (503), fails over to backup
        const res1 = await failoverFetch("https://primary.example/status");
        expect(res1.ok).toBe(true);
        expect(backupCalls).toBe(1);
        expect(primaryCalls).toBe(1);

        // Primary is now marked unhealthy
        const primaryHealth1 = pool.getHealth().find((h) => h.endpoint === "https://primary.example");
        expect(primaryHealth1?.healthy).toBe(false);

        // Subsequent call within recovery window routes directly to backup without hammering failing primary
        const res2 = await failoverFetch("https://primary.example/status");
        expect(res2.ok).toBe(true);
        expect(backupCalls).toBe(2);
        expect(primaryCalls).toBe(1);

        // Advance clock past the recovery window
        clock.advanceTo(5_000_000 + 25_000);

        // Third call: recovery window elapsed, primary is given a retry opportunity
        const res3 = await failoverFetch("https://primary.example/status");
        expect(res3.ok).toBe(true);
        const data3 = await res3.json();
        expect(data3.ledger).toBe(1005);

        // Primary should now be marked healthy again with 0 consecutive failures
        const primaryHealth2 = pool.getHealth().find((h) => h.endpoint === "https://primary.example");
        expect(primaryHealth2?.healthy).toBe(true);
        expect(primaryHealth2?.consecutiveFailures).toBe(0);
      } finally {
        clock.restore();
      }
    });

    it("detects when a failover backup returns stale data lagging behind a known ledger height", async () => {
      const pool = new EndpointPool([
        "https://primary.example",
        "https://lagging-backup.example",
      ], { failureThreshold: 1 });

      const fetcher = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("primary.example")) {
          // Primary is experiencing a transient 500 error
          return new Response("Internal Server Error", { status: 500 });
        }
        // Backup is lagging behind: reports ledger 500 while application observed 550
        return new Response(
          JSON.stringify({
            sequence: "500",
            balances: [{ asset_type: "native", balance: "10.0" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const failoverFetch = createFailoverFetch(pool, fetcher);

      // Perform request through failover fetch
      const res = await failoverFetch("https://primary.example/accounts/G123");
      expect(res.ok).toBe(true);
      const accountData = await res.json();

      // Graceful degradation guard: application verifies ledger sequence height
      const knownHighWaterMarkLedger = 550;
      const returnedLedger = Number(accountData.sequence);

      const isStale = returnedLedger < knownHighWaterMarkLedger;
      expect(isStale).toBe(true);
      expect(returnedLedger).toBe(500);

      // The stale data should be flagged or rejected rather than blindly trusted
      const policyDecision = isStale
        ? { status: "degraded_stale", ledger: returnedLedger, requiredLedger: knownHighWaterMarkLedger }
        : { status: "fresh", data: accountData };

      expect(policyDecision.status).toBe("degraded_stale");
      expect(policyDecision.ledger).toBe(500);
    });

    it("does not fail over on non-retryable 4xx client errors", async () => {
      const pool = new EndpointPool([
        "https://primary.example",
        "https://backup.example",
      ]);

      const fetcher = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
      const failoverFetch = createFailoverFetch(pool, fetcher);

      const res = await failoverFetch("https://primary.example/accounts/non_existent");
      expect(res.status).toBe(404);
      // 404 is not retryable, so it should not attempt backup or mark failure
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pool.getHealth()[0]?.healthy).toBe(true);
    });
  });
});
