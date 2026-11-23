/**
 * Fee panel for the transaction dashboard (#136).
 *
 * This framework-agnostic module wires together:
 *   - CongestionMonitor  — tracks network health (healthy / elevated / congested)
 *   - estimateFee        — base fee estimate from the network
 *   - feeForecast        — historical trend projection (low / medium / high)
 *   - feePolicy          — maps a chosen policy tier to a concrete fee
 *   - feeSurge           — detects and warns during fee surges
 *
 * It exposes a reactive `FeePanel` class that keeps an internal snapshot and
 * notifies subscribers whenever the snapshot changes. React and Vue wrappers
 * in the same directory consume it via subscriptions.
 *
 * Out of scope (per issue #136):
 *   - Automatically submitting with the chosen fee
 *   - New fee calculation logic
 */

import {
  CongestionMonitor,
  createCongestionMonitor,
  type CongestionLevel,
  type CongestionSnapshot,
  type CongestionSample,
} from "../../src/network/congestionMonitor";
import {
  getNetworkBaseFee,
  type FeeNetwork,
} from "../../src/transaction/feePolicy";
import {
  isFeeSurge,
} from "../../src/transaction/feeSurge";
import {
  forecastFees,
  type FeeForecastResult,
} from "../../src/transaction/feeForecast";
import type { FeeObservation } from "../../src/transaction/feeForecast";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The three fee policy tiers shown on the panel. */
export type FeePolicyTier = "low" | "medium" | "high";

/** A single suggested fee for one policy tier. */
export interface FeeSuggestion {
  tier: FeePolicyTier;
  /** Concrete fee in stroops for this tier. */
  feeStroops: number;
  /** Human-readable label (e.g. "Low · 100 stroops"). */
  label: string;
}

/** Snapshot of everything the fee panel needs to render. */
export interface FeePanelSnapshot {
  /** Current congestion level reported by the monitor. */
  congestionLevel: CongestionLevel;
  /** Raw congestion metrics. */
  congestion: CongestionSnapshot;
  /** Three fee suggestions (low / medium / high). */
  suggestions: [FeeSuggestion, FeeSuggestion, FeeSuggestion];
  /** The tier the user currently has selected. */
  selectedTier: FeePolicyTier;
  /** Concrete fee for the selected tier in stroops. */
  selectedFeeStroops: number;
  /**
   * True when the current network fee is a surge (exceeds 2× recent median).
   * When true the panel should display a warning.
   */
  surgeWarning: boolean;
  /**
   * Optional surge warning message. Non-null only when surgeWarning is true.
   */
  surgeMessage: string | null;
}

export interface FeePanelOptions {
  /** Network identifier used for per-network base fee policy. Default: "testnet". */
  network?: FeeNetwork;
  /**
   * Historical fee observations used by feeForecast to derive the low/high
   * range. When omitted the panel falls back to multiples of the base fee.
   */
  feeObservations?: FeeObservation[];
  /** Initial selected tier. Default: "medium". */
  initialTier?: FeePolicyTier;
  /** CongestionMonitor instance to use. A new one is created when omitted. */
  congestionMonitor?: CongestionMonitor;
  /**
   * Recent median fee in stroops used to detect surges.
   * When omitted surge detection is disabled.
   */
  recentMedianFee?: number;
}

type Subscriber = (snapshot: FeePanelSnapshot) => void;

// ─── Fee derivation helpers ───────────────────────────────────────────────────

/**
 * Derive low / medium / high fee suggestions.
 *
 * When enough historical observations are available, feeForecast's
 * confidence range maps to the low/high bounds. When history is insufficient
 * we fall back to 1× / 1.5× / 2× the network base fee.
 */
function buildSuggestions(
  baseFeeStroops: number,
  forecastResult: FeeForecastResult,
): [FeeSuggestion, FeeSuggestion, FeeSuggestion] {
  let lowFee: number;
  let medFee: number;
  let highFee: number;

  if (forecastResult.available) {
    const { lowerBoundStroops, predictedFeeStroops, upperBoundStroops } =
      forecastResult.forecast;
    lowFee = Math.max(baseFeeStroops, Math.round(lowerBoundStroops));
    medFee = Math.max(baseFeeStroops, Math.round(predictedFeeStroops));
    highFee = Math.max(baseFeeStroops, Math.round(upperBoundStroops));
  } else {
    lowFee = baseFeeStroops;
    medFee = Math.round(baseFeeStroops * 1.5);
    highFee = baseFeeStroops * 2;
  }

  return [
    { tier: "low", feeStroops: lowFee, label: `Low · ${lowFee} stroops` },
    { tier: "medium", feeStroops: medFee, label: `Medium · ${medFee} stroops` },
    { tier: "high", feeStroops: highFee, label: `High · ${highFee} stroops` },
  ];
}

function feeForTier(
  tier: FeePolicyTier,
  suggestions: [FeeSuggestion, FeeSuggestion, FeeSuggestion],
): number {
  return suggestions.find((s) => s.tier === tier)?.feeStroops ?? suggestions[1].feeStroops;
}

// ─── FeePanel ─────────────────────────────────────────────────────────────────

/**
 * Reactive fee panel that combines congestion monitoring, fee forecasting,
 * fee policy, and surge detection into a single subscribable snapshot.
 *
 * ```ts
 * const panel = new FeePanel({ network: "testnet" });
 * const unsub = panel.subscribe((snapshot) => renderPanel(snapshot));
 *
 * // Record a congestion sample whenever a transaction round-trip completes:
 * panel.recordSample({ latencyMs: 350, success: true });
 *
 * // Let the user pick a tier:
 * panel.selectTier("high");
 *
 * // Clean up:
 * unsub();
 * ```
 */
export class FeePanel {
  private readonly monitor: CongestionMonitor;
  private readonly network: FeeNetwork;
  private readonly feeObservations: FeeObservation[];
  private readonly recentMedianFee: number | undefined;
  private selectedTier: FeePolicyTier;
  private snapshot: FeePanelSnapshot;
  private readonly subscribers = new Set<Subscriber>();

  constructor(options: FeePanelOptions = {}) {
    this.network = options.network ?? "testnet";
    this.feeObservations = options.feeObservations ?? [];
    this.recentMedianFee = options.recentMedianFee;
    this.selectedTier = options.initialTier ?? "medium";
    this.monitor =
      options.congestionMonitor ?? createCongestionMonitor();

    this.snapshot = this.buildSnapshot();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Current snapshot — read without subscribing. */
  getSnapshot(): FeePanelSnapshot {
    return this.snapshot;
  }

  /**
   * Subscribe to snapshot updates.
   * Returns an unsubscribe function.
   */
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    // Deliver the current snapshot immediately so the subscriber can render.
    subscriber(this.snapshot);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * Record a network round-trip sample.
   * Updates the congestion level and re-publishes the snapshot.
   */
  recordSample(sample: CongestionSample): void {
    this.monitor.record(sample);
    this.publish();
  }

  /**
   * Change the selected fee policy tier.
   * Immediately re-publishes the snapshot with the new selection.
   */
  selectTier(tier: FeePolicyTier): void {
    this.selectedTier = tier;
    this.publish();
  }

  /**
   * Replace the fee observations used for forecasting and re-publish.
   * Call this whenever fresh historical data becomes available.
   */
  updateFeeObservations(observations: FeeObservation[]): void {
    (this as { feeObservations: FeeObservation[] }).feeObservations =
      observations;
    this.publish();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private buildSnapshot(): FeePanelSnapshot {
    const congestion = this.monitor.snapshot();
    const baseFeeStroops = getNetworkBaseFee(this.network);

    const forecastResult = forecastFees(0, {
      observations: this.feeObservations,
      networkPassphrase: this.network,
    });

    const suggestions = buildSuggestions(baseFeeStroops, forecastResult);
    const selectedFeeStroops = feeForTier(this.selectedTier, suggestions);

    // Surge detection: compare the high-tier suggestion against the recent
    // median. When no median is available, surge is never reported.
    const surgeWarning =
      this.recentMedianFee !== undefined
        ? isFeeSurge(suggestions[2].feeStroops, this.recentMedianFee)
        : false;

    const surgeMessage = surgeWarning
      ? `Network fees are surging (${suggestions[2].feeStroops} stroops exceeds 2× the recent median of ${this.recentMedianFee} stroops). Consider waiting or selecting a higher fee to avoid a stuck transaction.`
      : null;

    return {
      congestionLevel: congestion.level,
      congestion,
      suggestions,
      selectedTier: this.selectedTier,
      selectedFeeStroops,
      surgeWarning,
      surgeMessage,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const sub of this.subscribers) {
      sub(this.snapshot);
    }
  }
}

/** Convenience factory. */
export function createFeePanel(options?: FeePanelOptions): FeePanel {
  return new FeePanel(options);
}
