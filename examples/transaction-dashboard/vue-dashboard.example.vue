<!--
  Vue transaction status dashboard example (#708, #136).

  Subscribes to a `TransactionStatusAggregator` and renders live metrics,
  status distribution, and recent transactions. Unsubscribes on unmount so
  SPAs don't leak listeners.

  The fee panel (#136) adds live congestion-adjusted fee suggestions. It reads
  from `CongestionMonitor`, `feeForecast`, `feePolicy`, and `feeSurge` to show
  low / medium / high fee suggestions, a surge warning, and a reactive
  selected-fee display.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  TransactionStatusAggregator,
  type DashboardSnapshot,
} from "../../src/transaction/transactionDashboard";
import {
  FeePanel,
  createFeePanel,
  type FeePanelSnapshot,
  type FeePolicyTier,
} from "./fee-panel";

const props = defineProps<{
  aggregator: TransactionStatusAggregator;
  panel?: FeePanel;
}>();

const snapshot = ref<DashboardSnapshot>(props.aggregator.getSnapshot());

// Use the provided panel or create a default one for standalone use.
const feePanel = props.panel ?? createFeePanel({ network: "testnet" });
const feeSnap = ref<FeePanelSnapshot>(feePanel.getSnapshot());

let unsubscribeDashboard: (() => void) | undefined;
let unsubscribeFeePanel: (() => void) | undefined;

onMounted(() => {
  unsubscribeDashboard = props.aggregator.subscribe((next) => {
    snapshot.value = next;
  });
  unsubscribeFeePanel = feePanel.subscribe((next) => {
    feeSnap.value = next;
  });
});

onUnmounted(() => {
  unsubscribeDashboard?.();
  unsubscribeFeePanel?.();
});

function selectTier(tier: FeePolicyTier) {
  feePanel.selectTier(tier);
}

const congestionColor: Record<string, string> = {
  healthy: "#16a34a",
  elevated: "#d97706",
  congested: "#dc2626",
};
</script>

<template>
  <section aria-label="Transaction status dashboard">
    <header>
      <h2>Transactions ({{ snapshot.metrics.total }})</h2>
      <p>
        Success rate: {{ (snapshot.metrics.successRate * 100).toFixed(1) }}% · Avg fee:
        {{ snapshot.metrics.avgFee ?? "—" }}
      </p>
    </header>

    <!-- Fee panel — congestion-adjusted suggestions (#136) -->
    <section aria-label="Fee panel" class="fee-panel">
      <h3>Network fees</h3>

      <!-- Congestion level -->
      <p>
        Congestion:
        <strong :style="{ color: congestionColor[feeSnap.congestionLevel] ?? '#374151' }">
          {{ feeSnap.congestionLevel }}
        </strong>
        <span class="muted">
          (avg latency {{ Math.round(feeSnap.congestion.averageLatencyMs) }} ms ·
          {{ (feeSnap.congestion.failureRate * 100).toFixed(1) }}% failure rate)
        </span>
      </p>

      <!-- Three fee suggestions -->
      <div class="suggestions">
        <button
          v-for="s in feeSnap.suggestions"
          :key="s.tier"
          :aria-pressed="feeSnap.selectedTier === s.tier"
          :class="['suggestion-btn', { selected: feeSnap.selectedTier === s.tier }]"
          @click="selectTier(s.tier)"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- Selected fee -->
      <p class="selected-fee">
        Selected fee:
        <span class="fee-value">{{ feeSnap.selectedFeeStroops }} stroops</span>
      </p>

      <!-- Surge warning -->
      <p
        v-if="feeSnap.surgeWarning && feeSnap.surgeMessage"
        role="alert"
        class="surge-warning"
      >
        ⚠️ {{ feeSnap.surgeMessage }}
      </p>
    </section>

    <ul>
      <li v-for="s in snapshot.charts.statusDistribution" :key="s.label">
        {{ s.label }}: {{ s.value }}
      </li>
    </ul>
    <ol>
      <li v-for="entry in snapshot.recent" :key="entry.tx.hash">
        {{ entry.tx.hash.slice(0, 8) }}… — {{ entry.tx.status }} ({{ entry.category }})
      </li>
    </ol>
  </section>
</template>

<style scoped>
.fee-panel {
  margin-top: 1.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
}

.fee-panel h3 {
  margin: 0 0 0.75rem;
}

.muted {
  color: #6b7280;
  font-size: 0.85rem;
}

.suggestions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.suggestion-btn {
  flex: 1;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  cursor: pointer;
}

.suggestion-btn.selected {
  border: 2px solid #1d4ed8;
  background: #eff6ff;
  font-weight: 600;
}

.selected-fee {
  margin: 0 0 0.5rem;
  font-weight: 500;
}

.fee-value {
  color: #1d4ed8;
}

.surge-warning {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  font-size: 0.85rem;
  color: #92400e;
}
</style>
