/**
 * Server-side request batching example (#148).
 *
 * Demonstrates adaptive batching windows for bulk account reads, showing the
 * coalescing gains vs latency tradeoff under burst and steady-state load.
 *
 * Run with: npx ts-node examples/server-batching/server-batching.example.ts
 */

import { createRequestBatcher } from "../../src/network/requestBatching";
import type { BatchFetcher } from "../../src/network/requestBatching";

// ─── Simulated account fetcher ────────────────────────────────────────────────

interface AccountSummary {
  publicKey: string;
  balance: string;
}

/**
 * Simulates a Horizon batch fetch: one network call returns all requested
 * accounts. The 20 ms artificial delay represents a real round trip.
 */
const simulatedHorizonFetch: BatchFetcher<string, AccountSummary> = async (keys) => {
  await new Promise<void>((r) => setTimeout(r, 20)); // simulate network latency
  const result = new Map<string, AccountSummary>();
  for (const key of keys) {
    result.set(key, { publicKey: key, balance: "100.0000000" });
  }
  return result;
};

// ─── Telemetry accumulator (stand-in for recordOperationDuration) ─────────────

interface BatchTelemetry {
  batchCount: number;
  totalKeys: number;
  totalFillMs: number;
}

function makeTelemetry(): BatchTelemetry {
  return { batchCount: 0, totalKeys: 0, totalFillMs: 0 };
}

// ─── Helper: generate N distinct account keys ─────────────────────────────────

function accountKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `G${"A".repeat(5)}${String(i).padStart(50, "0")}`);
}

// ─── Scenario 1: Fixed window, burst of 30 requests ──────────────────────────

async function scenarioFixedWindow(): Promise<void> {
  console.log("\n── Scenario 1: Fixed 10 ms window, burst of 30 requests ──");

  const telemetry = makeTelemetry();
  const batcher = createRequestBatcher(simulatedHorizonFetch, {
    windowMs: 10,
    maxBatch: 50,
    onFlush: ({ batchSize, fillTimeMs }) => {
      telemetry.batchCount += 1;
      telemetry.totalKeys += batchSize;
      telemetry.totalFillMs += fillTimeMs;
    },
  });

  const keys = accountKeys(30);
  const start = Date.now();
  await Promise.all(keys.map((k) => batcher.request(k)));
  const elapsed = Date.now() - start;

  const stats = batcher.getStats();
  console.log(`  Requests : ${stats.totalRequests}`);
  console.log(`  Batches  : ${stats.totalBatches}  (${stats.totalRequests / stats.totalBatches}x coalescing gain)`);
  console.log(`  Avg fill : ${stats.avgBatchFillMs.toFixed(1)} ms`);
  console.log(`  Avg size : ${stats.avgBatchSize.toFixed(1)} keys/batch`);
  console.log(`  Elapsed  : ${elapsed} ms`);
}

// ─── Scenario 2: Adaptive window, high-throughput burst ──────────────────────

async function scenarioAdaptiveHighLoad(): Promise<void> {
  console.log("\n── Scenario 2: Adaptive window, high-throughput burst (100 requests) ──");

  const telemetry = makeTelemetry();
  const batcher = createRequestBatcher(simulatedHorizonFetch, {
    adaptiveWindow: true,
    minWindowMs: 5,
    maxWindowMs: 50,
    targetLatencyMs: 100,
    maxBatch: 50,
    onFlush: ({ batchSize, fillTimeMs }) => {
      telemetry.batchCount += 1;
      telemetry.totalKeys += batchSize;
      telemetry.totalFillMs += fillTimeMs;
    },
  });

  // Fire 100 requests with 1 ms spacing — high throughput.
  const keys = accountKeys(100);
  const start = Date.now();
  for (let i = 0; i < keys.length; i++) {
    setTimeout(() => { void batcher.request(keys[i] as string); }, i);
  }
  // Wait long enough for all batches to complete.
  await new Promise<void>((r) => setTimeout(r, 300));
  const elapsed = Date.now() - start;

  const stats = batcher.getStats();
  console.log(`  Requests : ${stats.totalRequests}`);
  console.log(`  Batches  : ${stats.totalBatches}`);
  console.log(`  Avg fill : ${stats.avgBatchFillMs.toFixed(1)} ms`);
  console.log(`  Avg size : ${stats.avgBatchSize.toFixed(1)} keys/batch`);
  console.log(`  Elapsed  : ${elapsed} ms`);
  console.log(`  Window adapted to high load — wider windows coalesce more keys.`);
}

// ─── Scenario 3: Adaptive window, low-throughput steady state ────────────────

async function scenarioAdaptiveLowLoad(): Promise<void> {
  console.log("\n── Scenario 3: Adaptive window, low-throughput (1 request / 200 ms) ──");

  const batcher = createRequestBatcher(simulatedHorizonFetch, {
    adaptiveWindow: true,
    minWindowMs: 5,
    maxWindowMs: 50,
    targetLatencyMs: 100,
    maxBatch: 50,
  });

  const keys = accountKeys(5);
  const latencies: number[] = [];

  for (const key of keys) {
    const t = Date.now();
    await batcher.request(key);
    latencies.push(Date.now() - t);
    await new Promise<void>((r) => setTimeout(r, 200));
  }

  const stats = batcher.getStats();
  const avgLatency = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  console.log(`  Requests : ${stats.totalRequests}`);
  console.log(`  Batches  : ${stats.totalBatches}  (1:1 — no coalescing needed at low rate)`);
  console.log(`  Avg per-request latency: ${avgLatency.toFixed(1)} ms`);
  console.log(`  Window shrank toward minWindowMs to bound tail latency.`);
}

// ─── Scenario 4: maxBatchSize flush trigger ───────────────────────────────────

async function scenarioMaxBatchFlush(): Promise<void> {
  console.log("\n── Scenario 4: maxBatch flush trigger (window=5000ms, maxBatch=5) ──");

  const flushTimes: number[] = [];
  const start = Date.now();

  const batcher = createRequestBatcher(simulatedHorizonFetch, {
    windowMs: 5000, // very long window — flush must be triggered by maxBatch
    maxBatch: 5,
    onFlush: () => flushTimes.push(Date.now() - start),
  });

  const keys = accountKeys(5);
  await Promise.all(keys.map((k) => batcher.request(k)));

  console.log(`  Flush triggered at ~${flushTimes[0] ?? "?"}ms (not at the 5000ms window)`);
  console.log(`  Demonstrates that maxBatch flushes immediately regardless of windowMs.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log("Sorokit — Server batching window examples (#148)");
  await scenarioFixedWindow();
  await scenarioAdaptiveHighLoad();
  await scenarioAdaptiveLowLoad();
  await scenarioMaxBatchFlush();
  console.log("\nDone.");
})();
