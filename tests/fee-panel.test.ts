/**
 * Tests for the dashboard fee panel (#136).
 *
 * Covers:
 * - Snapshot shape: congestion level, three suggestions, selected fee
 * - Tier selection updates selectedFeeStroops reactively
 * - Surge warning fires when high-tier fee exceeds 2× the recent median
 * - Surge warning is absent when fees are within normal range
 * - Subscriber is called on record and selectTier
 * - Unsubscribe stops further callbacks
 * - Falls back to base-fee multiples when insufficient forecast history
 * - Forecasted bounds are used when enough observations are provided
 */
import { describe, it, expect, vi } from "vitest";
import { FeePanel, createFeePanel } from "../examples/transaction-dashboard/fee-panel";
import type { FeePanelSnapshot } from "../examples/transaction-dashboard/fee-panel";
import { createCongestionMonitor } from "../src/network/congestionMonitor";
import type { FeeObservation } from "../src/transaction/feeForecast";

function makePanel(opts?: ConstructorParameters<typeof FeePanel>[0]) {
  return createFeePanel(opts);
}

// ─── Snapshot shape ──────────────────────────────────────────────────────────

describe("FeePanel snapshot shape (#136)", () => {
  it("initial snapshot has congestionLevel, suggestions, selectedTier, selectedFeeStroops", () => {
    const panel = makePanel({ network: "testnet" });
    const snap = panel.getSnapshot();

    expect(snap).toHaveProperty("congestionLevel");
    expect(snap).toHaveProperty("congestion");
    expect(snap).toHaveProperty("suggestions");
    expect(snap).toHaveProperty("selectedTier");
    expect(snap).toHaveProperty("selectedFeeStroops");
    expect(snap).toHaveProperty("surgeWarning");
    expect(snap).toHaveProperty("surgeMessage");
  });

  it("provides exactly three fee suggestions: low, medium, high", () => {
    const panel = makePanel({ network: "testnet" });
    const { suggestions } = panel.getSnapshot();

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].tier).toBe("low");
    expect(suggestions[1].tier).toBe("medium");
    expect(suggestions[2].tier).toBe("high");
  });

  it("each suggestion has a label containing the tier name and stroops", () => {
    const panel = makePanel({ network: "testnet" });
    const { suggestions } = panel.getSnapshot();

    for (const s of suggestions) {
      expect(s.label).toContain(s.tier.charAt(0).toUpperCase() + s.tier.slice(1));
      expect(s.label).toContain("stroops");
      expect(s.feeStroops).toBeGreaterThan(0);
    }
  });

  it("default selected tier is medium", () => {
    const panel = makePanel();
    expect(panel.getSnapshot().selectedTier).toBe("medium");
  });

  it("initialTier option is respected", () => {
    const panel = makePanel({ initialTier: "high" });
    expect(panel.getSnapshot().selectedTier).toBe("high");
  });
});

// ─── Tier selection ──────────────────────────────────────────────────────────

describe("FeePanel tier selection (#136)", () => {
  it("selectTier updates selectedTier in the snapshot", () => {
    const panel = makePanel();
    panel.selectTier("low");
    expect(panel.getSnapshot().selectedTier).toBe("low");
    panel.selectTier("high");
    expect(panel.getSnapshot().selectedTier).toBe("high");
  });

  it("selectedFeeStroops matches the fee of the selected tier", () => {
    const panel = makePanel();
    for (const tier of ["low", "medium", "high"] as const) {
      panel.selectTier(tier);
      const snap = panel.getSnapshot();
      const suggestion = snap.suggestions.find((s) => s.tier === tier)!;
      expect(snap.selectedFeeStroops).toBe(suggestion.feeStroops);
    }
  });

  it("high fee is >= medium fee >= low fee", () => {
    const panel = makePanel({ network: "testnet" });
    const { suggestions } = panel.getSnapshot();
    expect(suggestions[0].feeStroops).toBeLessThanOrEqual(suggestions[1].feeStroops);
    expect(suggestions[1].feeStroops).toBeLessThanOrEqual(suggestions[2].feeStroops);
  });
});

// ─── Surge warning ───────────────────────────────────────────────────────────

describe("FeePanel surge warning (#136)", () => {
  it("surgeWarning is false when fees are within normal range", () => {
    // recentMedianFee = 1000, high suggestion will be ~200 stroops (testnet base 100 × 2)
    // 200 is well below 2 × 1000 = 2000 → no surge
    const panel = makePanel({ network: "testnet", recentMedianFee: 1000 });
    expect(panel.getSnapshot().surgeWarning).toBe(false);
    expect(panel.getSnapshot().surgeMessage).toBeNull();
  });

  it("surgeWarning is true when high suggestion exceeds 2× recent median", () => {
    // recentMedianFee = 50, high suggestion will be 200 stroops
    // 200 > 2 × 50 = 100 → surge
    const panel = makePanel({ network: "testnet", recentMedianFee: 50 });
    expect(panel.getSnapshot().surgeWarning).toBe(true);
    expect(panel.getSnapshot().surgeMessage).not.toBeNull();
  });

  it("surgeMessage contains median and current fee information", () => {
    const panel = makePanel({ network: "testnet", recentMedianFee: 50 });
    const { surgeMessage } = panel.getSnapshot();
    expect(surgeMessage).toContain("surge");
    expect(surgeMessage).toContain("50");
  });

  it("surgeWarning is false when no recentMedianFee is provided", () => {
    const panel = makePanel({ network: "testnet" });
    expect(panel.getSnapshot().surgeWarning).toBe(false);
  });
});

// ─── Reactivity ──────────────────────────────────────────────────────────────

describe("FeePanel reactivity (#136)", () => {
  it("subscribe is called immediately with the current snapshot", () => {
    const panel = makePanel();
    const cb = vi.fn<[FeePanelSnapshot], void>();
    panel.subscribe(cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("subscriber is called again after selectTier", () => {
    const panel = makePanel();
    const cb = vi.fn<[FeePanelSnapshot], void>();
    panel.subscribe(cb);
    cb.mockClear();

    panel.selectTier("high");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0]![0].selectedTier).toBe("high");
  });

  it("subscriber is called again after recordSample", () => {
    const panel = makePanel();
    const cb = vi.fn<[FeePanelSnapshot], void>();
    panel.subscribe(cb);
    cb.mockClear();

    panel.recordSample({ latencyMs: 300, success: true });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("unsubscribe stops further callbacks", () => {
    const panel = makePanel();
    const cb = vi.fn<[FeePanelSnapshot], void>();
    const unsub = panel.subscribe(cb);
    cb.mockClear();

    unsub();
    panel.selectTier("low");
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─── Congestion level ────────────────────────────────────────────────────────

describe("FeePanel congestion level (#136)", () => {
  it("initial congestion level is healthy when no samples recorded", () => {
    const panel = makePanel();
    // No samples → averageLatencyMs = 0 < healthyLatencyMs threshold → healthy
    expect(panel.getSnapshot().congestionLevel).toBe("healthy");
  });

  it("congestion level updates to congested after high-latency samples", () => {
    const monitor = createCongestionMonitor({
      healthyLatencyMs: 500,
      congestedLatencyMs: 2000,
      windowSize: 5,
    });
    const panel = makePanel({ congestionMonitor: monitor });

    // Record enough high-latency samples to push average above congestedLatencyMs
    for (let i = 0; i < 5; i++) {
      panel.recordSample({ latencyMs: 3000, success: true });
    }

    expect(panel.getSnapshot().congestionLevel).toBe("congested");
  });
});

// ─── Forecast integration ────────────────────────────────────────────────────

describe("FeePanel forecast integration (#136)", () => {
  it("falls back to base-fee multiples when no observations are provided", () => {
    const panel = makePanel({ network: "testnet" });
    const { suggestions } = panel.getSnapshot();
    // With no history, base fee for testnet = 100 stroops
    // low = 100, medium = 150, high = 200
    expect(suggestions[0].feeStroops).toBe(100);
    expect(suggestions[1].feeStroops).toBe(150);
    expect(suggestions[2].feeStroops).toBe(200);
  });

  it("uses forecast bounds when sufficient observations are provided", () => {
    const now = Date.now();
    // Build 10 observations spread over 10 days with stable fees (~500 stroops)
    const observations: FeeObservation[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: now - (10 - i) * 86_400_000,
      feeStroops: 500 + i * 2,
    }));

    const panel = makePanel({
      network: "testnet",
      feeObservations: observations,
    });

    const { suggestions } = panel.getSnapshot();
    // Forecast should produce fees near ~500+ stroops — well above the 100-stroop base
    expect(suggestions[1].feeStroops).toBeGreaterThan(100);
  });
});
