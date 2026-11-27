/**
 * Benchmark and bundle measurement environment utilities.
 *
 * Provides helpers for capturing deterministic runtime environment
 * metadata and bundle budget definitions for CI, diagnostics, and benchmark reporting.
 */

import { getEnvironment, isNode, type RuntimeEnvironment } from "./environment";

export interface BenchmarkEnvironmentDetails {
  runtime: RuntimeEnvironment;
  nodeVersion?: string;
  platform?: string;
  arch?: string;
  heapUsedBytes?: number;
  heapTotalBytes?: number;
  timestamp: string;
}

export interface BundleBudgetDefinition {
  name: string;
  file: string;
  budgetBytes: number;
  category: "release-gate" | "informational";
}

export const DEFAULT_BUNDLE_BUDGETS: BundleBudgetDefinition[] = [
  { name: "full SDK", file: "dist/index.mjs", budgetBytes: 150 * 1024, category: "release-gate" },
  { name: "wallet", file: "dist/wallet/index.mjs", budgetBytes: 50 * 1024, category: "release-gate" },
  { name: "account", file: "dist/account/index.mjs", budgetBytes: 40 * 1024, category: "release-gate" },
  { name: "lazy loader", file: "dist/lazy/index.mjs", budgetBytes: 5 * 1024, category: "release-gate" },
];

/**
 * Capture deterministic runtime environment metadata for benchmark and performance reports.
 */
export function captureBenchmarkEnvironment(now = () => new Date().toISOString()): BenchmarkEnvironmentDetails {
  const env = getEnvironment();
  const details: BenchmarkEnvironmentDetails = {
    runtime: env,
    timestamp: now(),
  };

  if (isNode() && typeof process !== "undefined") {
    if (process.version) details.nodeVersion = process.version;
    if (process.platform) details.platform = process.platform;
    if (process.arch) details.arch = process.arch;
    if (typeof process.memoryUsage === "function") {
      try {
        const mem = process.memoryUsage();
        details.heapUsedBytes = mem.heapUsed;
        details.heapTotalBytes = mem.heapTotal;
      } catch {
        // Restricted environments may disallow memoryUsage
      }
    }
  }

  return details;
}

/**
 * Evaluate whether an observed gzip size passes the defined budget threshold.
 */
export function evaluateBundleBudget(
  observedGzipBytes: number,
  budget: BundleBudgetDefinition,
): { pass: boolean; differenceBytes: number; percentage: number } {
  const pass = observedGzipBytes <= budget.budgetBytes;
  const differenceBytes = observedGzipBytes - budget.budgetBytes;
  const percentage = Number(((observedGzipBytes / budget.budgetBytes) * 100).toFixed(1));
  return { pass, differenceBytes, percentage };
}
