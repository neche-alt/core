<!--
  Vue transaction status dashboard example (#708, #106).

  Subscribes to a `TransactionStatusAggregator` and renders live metrics,
  status distribution, and recent transactions. Unsubscribes on unmount so
  SPAs don't leak listeners.

  Error recovery (#106):
  - Read failures (snapshot reload) expose a safe "Retry" button — re-fetching
    is idempotent and cannot cause side-effects.
  - Write failures (transaction submission) show a status-check prompt with a
    block-explorer link so the user confirms the tx did not land before
    resubmitting, preventing accidental double-spends.
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

/** Distinguishes safe read retries from writes that need a status check first. */
export type DashboardErrorKind = "read" | "write";

export interface DashboardError {
  kind: DashboardErrorKind;
  message: string;
  /** Hash of the transaction involved, present for write errors. */
  txHash?: string;
}

const props = defineProps<{
  aggregator: TransactionStatusAggregator;
  /**
   * Called when the user clicks "Retry" on a read error.
   * Provide a function that re-fetches data and re-populates the aggregator.
   */
  onRetryRead?: () => Promise<void>;
}>();

const snapshot = ref<DashboardSnapshot>(props.aggregator.getSnapshot());
const dashError = ref<DashboardError | null>(null);
const retrying = ref(false);

let unsubscribe: (() => void) | undefined;

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

/** Returns true when retrying the operation is safe without a status check. */
function isRetryable(err: DashboardError): boolean {
  return err.kind === "read";
}

/** Returns true when the caller must check transaction status before retrying. */
function requiresStatusCheck(err: DashboardError): boolean {
  return err.kind === "write";
}

async function handleRetryRead() {
  if (!props.onRetryRead) return;
  retrying.value = true;
  dashError.value = null;
  try {
    await props.onRetryRead();
  } catch (err) {
    dashError.value = {
      kind: "read",
      message: err instanceof Error ? err.message : "Failed to reload transactions.",
    };
  } finally {
    retrying.value = false;
  }
}
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

    <!-- Error recovery affordances (#106) -->
    <div v-if="dashError" role="alert" aria-live="polite">
      <p>{{ dashError.message }}</p>

      <!-- Read error: safe to retry immediately -->
      <button
        v-if="isRetryable(dashError) && onRetryRead"
        :disabled="retrying"
        @click="handleRetryRead"
      >
        {{ retrying ? "Retrying…" : "Retry" }}
      </button>

      <!-- Write error: direct user to check status before retrying -->
      <template v-if="requiresStatusCheck(dashError)">
        <p>
          <strong>Do not resubmit yet.</strong> Check whether the transaction landed first:
          <a
            v-if="dashError.txHash"
            :href="`https://stellar.expert/explorer/testnet/tx/${dashError.txHash}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Stellar Expert ↗
          </a>
        </p>
      </template>
    </div>

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
