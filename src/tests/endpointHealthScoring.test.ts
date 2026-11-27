/**
 * Tests for endpoint health scoring and weighted failover selection (#147).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EndpointRegistry, createEndpointRegistry } from "../network/endpointRegistry";
import { selectByScore } from "../network/endpointFailover";

const HORIZON_A = "https://horizon-a.example.com";
const HORIZON_B = "https://horizon-b.example.com";
const HORIZON_C = "https://horizon-c.example.com";

describe("endpoint health scoring (#147)", () => {
  let registry: EndpointRegistry;

  beforeEach(() => {
    registry = createEndpointRegistry();
    registry.registerEndpoint("horizon", HORIZON_A);
    registry.registerEndpoint("horizon", HORIZON_B);
  });

  it("new endpoint starts with score 1.0 and successRate 1.0", () => {
    const scores = registry.getHealthScores("horizon");
    for (const s of scores) {
      expect(s.healthScore.score).toBe(1);
      expect(s.healthScore.successRate).toBe(1);
      expect(s.healthScore.p95LatencyMs).toBe(0);
    }
  });

  it("score drops after failures", () => {
    registry.recordFailure("horizon", HORIZON_A);
    registry.recordFailure("horizon", HORIZON_A);

    const scores = registry.getHealthScores("horizon");
    const a = scores.find((s) => s.url === HORIZON_A)!;
    expect(a.healthScore.successRate).toBeLessThan(1);
    expect(a.healthScore.score).toBeLessThan(1);
  });

  it("score climbs back after successes following failures", () => {
    // Record two failures
    registry.recordFailure("horizon", HORIZON_A);
    registry.recordFailure("horizon", HORIZON_A);
    const afterFailures = registry.getHealthScores("horizon").find((s) => s.url === HORIZON_A)!;
    const scoreBefore = afterFailures.healthScore.score;

    // Record two successes — recovery
    registry.recordSuccess("horizon", HORIZON_A);
    registry.recordSuccess("horizon", HORIZON_A);
    const afterSuccess = registry.getHealthScores("horizon").find((s) => s.url === HORIZON_A)!;
    expect(afterSuccess.healthScore.score).toBeGreaterThan(scoreBefore);
  });

  it("OPEN breaker state drives score to 0", () => {
    registry.setBreakerState("horizon", HORIZON_A, "OPEN");
    const scores = registry.getHealthScores("horizon");
    const a = scores.find((s) => s.url === HORIZON_A)!;
    expect(a.healthScore.score).toBe(0);
    expect(a.healthScore.breakerState).toBe("OPEN");
  });

  it("HALF_OPEN breaker state halves the score", () => {
    registry.setBreakerState("horizon", HORIZON_A, "HALF_OPEN");
    const scores = registry.getHealthScores("horizon");
    const a = scores.find((s) => s.url === HORIZON_A)!;
    // successRate=1, latencyFactor=1 (no latency), breakerFactor=0.5 → score=0.5
    expect(a.healthScore.score).toBeCloseTo(0.5);
  });

  it("CLOSED breaker state restores full score", () => {
    registry.setBreakerState("horizon", HORIZON_A, "OPEN");
    registry.setBreakerState("horizon", HORIZON_A, "CLOSED");
    const scores = registry.getHealthScores("horizon");
    const a = scores.find((s) => s.url === HORIZON_A)!;
    expect(a.healthScore.score).toBe(1);
  });

  it("high latency reduces the score", () => {
    registry.recordLatency("horizon", HORIZON_A, 5000); // 5 s
    const scores = registry.getHealthScores("horizon");
    const a = scores.find((s) => s.url === HORIZON_A)!;
    // latencyFactor = 1 / (1 + 5000/1000) = 1/6 ≈ 0.167
    expect(a.healthScore.score).toBeLessThan(0.25);
  });

  it("getHealthScores returns all registered endpoints", () => {
    registry.registerEndpoint("horizon", HORIZON_C);
    const scores = registry.getHealthScores("horizon");
    expect(scores).toHaveLength(3);
    expect(scores.map((s) => s.url)).toContain(HORIZON_C);
  });

  it("getHealthScores filters by type", () => {
    registry.registerEndpoint("rpc", "https://rpc.example.com");
    const horizonScores = registry.getHealthScores("horizon");
    const rpcScores = registry.getHealthScores("rpc");
    expect(horizonScores.every((s) => s.type === "horizon")).toBe(true);
    expect(rpcScores.every((s) => s.type === "rpc")).toBe(true);
  });

  describe("selectByScore weighted selection", () => {
    it("returns null for an empty registry", () => {
      const empty = createEndpointRegistry();
      expect(selectByScore(empty, "horizon")).toBeNull();
    });

    it("always returns the only endpoint when there is one", () => {
      const reg = createEndpointRegistry();
      reg.registerEndpoint("horizon", HORIZON_A);
      for (let i = 0; i < 20; i++) {
        expect(selectByScore(reg, "horizon")).toBe(HORIZON_A);
      }
    });

    it("strongly prefers the higher-scored endpoint over 1000 picks", () => {
      const reg = createEndpointRegistry();
      reg.registerEndpoint("horizon", HORIZON_A);
      reg.registerEndpoint("horizon", HORIZON_B);

      // Drive HORIZON_B score to 0 via OPEN breaker
      reg.setBreakerState("horizon", HORIZON_B, "OPEN");

      let countA = 0;
      for (let i = 0; i < 1000; i++) {
        if (selectByScore(reg, "horizon") === HORIZON_A) countA++;
      }
      // HORIZON_B has score 0, so HORIZON_A should be picked ≥95 % of the time
      expect(countA).toBeGreaterThanOrEqual(950);
    });

    it("falls back to uniform selection when all scores are 0", () => {
      const reg = createEndpointRegistry();
      reg.registerEndpoint("horizon", HORIZON_A);
      reg.registerEndpoint("horizon", HORIZON_B);
      reg.setBreakerState("horizon", HORIZON_A, "OPEN");
      reg.setBreakerState("horizon", HORIZON_B, "OPEN");

      // Both have score 0 — should still return one of the endpoints, not null
      const result = selectByScore(reg, "horizon");
      expect([HORIZON_A, HORIZON_B]).toContain(result);
    });

    it("distributes picks proportionally across two equal-score endpoints", () => {
      const reg = createEndpointRegistry();
      reg.registerEndpoint("horizon", HORIZON_A);
      reg.registerEndpoint("horizon", HORIZON_B);

      let countA = 0;
      const N = 2000;
      for (let i = 0; i < N; i++) {
        if (selectByScore(reg, "horizon") === HORIZON_A) countA++;
      }
      // With equal scores each endpoint should be picked ~50 % — allow ±15 %
      expect(countA / N).toBeGreaterThan(0.35);
      expect(countA / N).toBeLessThan(0.65);
    });
  });

  describe("getOptimalEndpoint with health scoring", () => {
    it("prefers the higher-scored endpoint", () => {
      // A is healthy with no latency; B has high latency
      registry.recordLatency("horizon", HORIZON_B, 8000);
      const result = registry.getOptimalEndpoint("horizon");
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.url).toBe(HORIZON_A);
      }
    });

    it("falls back to unhealthy endpoint when all are unhealthy", () => {
      const reg = createEndpointRegistry({ maxFailures: 1 });
      reg.registerEndpoint("horizon", HORIZON_A);
      reg.recordFailure("horizon", HORIZON_A);

      const result = reg.getOptimalEndpoint("horizon");
      expect(result.status).toBe("ok");
    });
  });
});
