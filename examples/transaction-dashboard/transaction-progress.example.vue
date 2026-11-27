<script setup lang="ts">
/**
 * Transaction submission progress component — Vue 3 example (#133).
 *
 * Maps the simulate → sign → submit → confirm lifecycle from status.ts and
 * transactionQueue.ts events into a step-by-step progress UI. When a fee-bump
 * transaction is used, an extra "fee_bump" step is inserted before "confirm".
 *
 * Usage:
 *   <TransactionProgress
 *     :transaction-id="txId"
 *     :queue="txQueue"
 *     :includes-fee-bump="true"
 *   />
 */

import { ref, computed, onMounted, onUnmounted } from "vue";
import type { TransactionQueue, QueueItemStatus } from "../../src/transaction/transactionQueue";

// ─── Props ────────────────────────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    transactionId: string;
    queue: TransactionQueue;
    includesFeeBump?: boolean;
  }>(),
  { includesFeeBump: false },
);

// ─── Types ────────────────────────────────────────────────────────────────────

type SubmissionStep = "simulate" | "sign" | "submit" | "fee_bump" | "confirm";
type StepStatus = "pending" | "active" | "completed" | "failed";

interface StepState {
  step: SubmissionStep;
  label: string;
  status: StepStatus;
  errorMessage?: string;
}

// ─── Step metadata ────────────────────────────────────────────────────────────

const STEP_LABELS: Record<SubmissionStep, string> = {
  simulate: "Simulate",
  sign: "Sign",
  submit: "Submit",
  fee_bump: "Apply Fee Bump",
  confirm: "Confirm",
};

function buildStepList(includesFeeBump: boolean): StepState[] {
  const stepIds: SubmissionStep[] = ["simulate", "sign", "submit"];
  if (includesFeeBump) stepIds.push("fee_bump");
  stepIds.push("confirm");
  return stepIds.map((step) => ({ step, label: STEP_LABELS[step], status: "pending" }));
}

function queueStatusToStep(status: QueueItemStatus): SubmissionStep {
  switch (status) {
    case "pending":    return "simulate";
    case "processing": return "submit";
    case "completed":  return "confirm";
    case "failed":     return "submit";
  }
}

// ─── Reactive state ───────────────────────────────────────────────────────────

const steps = ref<StepState[]>(buildStepList(props.includesFeeBump));
const currentStep = ref<SubmissionStep | null>("simulate");
const submissionError = ref<{ step: SubmissionStep; message: string } | null>(null);

function refresh(): void {
  const item = props.queue.getTransaction(props.transactionId);
  if (!item) return;

  const activeStep = queueStatusToStep(item.status);
  const stepOrder: SubmissionStep[] = props.includesFeeBump
    ? ["simulate", "sign", "submit", "fee_bump", "confirm"]
    : ["simulate", "sign", "submit", "confirm"];
  const activeIdx = stepOrder.indexOf(activeStep);

  steps.value = buildStepList(props.includesFeeBump).map((s): StepState => {
    const thisIdx = stepOrder.indexOf(s.step);
    if (item.status === "failed" && s.step === activeStep) {
      return { ...s, status: "failed", errorMessage: item.error ?? "Submission failed" };
    }
    if (thisIdx < activeIdx) return { ...s, status: "completed" };
    if (thisIdx === activeIdx && item.status !== "failed") return { ...s, status: "active" };
    return { ...s, status: "pending" };
  });

  submissionError.value =
    item.status === "failed"
      ? { step: activeStep, message: item.error ?? "Submission failed" }
      : null;

  currentStep.value = item.status === "completed" ? null : activeStep;
}

let intervalId: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  refresh();
  intervalId = setInterval(refresh, 500);
});

onUnmounted(() => {
  if (intervalId !== undefined) clearInterval(intervalId);
});

// ─── Computed helpers ─────────────────────────────────────────────────────────

const visibleSteps = computed(() =>
  steps.value.filter((s) => s.step !== "fee_bump" || props.includesFeeBump),
);

function iconFor(status: StepStatus): string {
  switch (status) {
    case "completed": return "✓";
    case "active":    return "⟳";
    case "failed":    return "✗";
    default:          return "○";
  }
}

function colorFor(status: StepStatus): string {
  switch (status) {
    case "completed": return "#27ae60";
    case "active":    return "#2980b9";
    case "failed":    return "#c0392b";
    default:          return "#7f8c8d";
  }
}
</script>

<template>
  <section aria-label="Transaction submission progress">
    <h3>Submission Progress</h3>
    <ol class="progress-list">
      <li
        v-for="s in visibleSteps"
        :key="s.step"
        :aria-current="s.status === 'active' ? 'step' : undefined"
        class="progress-step"
      >
        <span aria-hidden="true" class="step-icon">{{ iconFor(s.status) }}</span>
        <span
          class="step-label"
          :style="{
            fontWeight: s.status === 'active' ? 'bold' : 'normal',
            color: colorFor(s.status),
          }"
        >
          {{ s.label }}
        </span>
        <span
          v-if="s.status === 'failed' && s.errorMessage"
          class="step-error"
        >
          — {{ s.errorMessage }}
        </span>
      </li>
    </ol>

    <p v-if="submissionError" role="alert" class="error-summary">
      Failed at <strong>{{ STEP_LABELS[submissionError.step] }}</strong>:
      {{ submissionError.message }}
    </p>

    <p v-if="!currentStep && !submissionError" class="confirmed">
      Transaction confirmed ✓
    </p>
  </section>
</template>

<style scoped>
.progress-list {
  list-style: none;
  padding: 0;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.step-icon {
  width: 1.25em;
  text-align: center;
}

.step-error {
  color: #c0392b;
  font-size: 0.875em;
}

.error-summary {
  color: #c0392b;
  margin-top: 8px;
}

.confirmed {
  color: #27ae60;
}
</style>
