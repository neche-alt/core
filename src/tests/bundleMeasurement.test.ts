import { describe, it, expect } from "vitest";
import {
  captureBenchmarkEnvironment,
  evaluateBundleBudget,
  DEFAULT_BUNDLE_BUDGETS,
  type BundleBudgetDefinition,
} from "../shared/benchmarkEnvironment";

describe("captureBenchmarkEnvironment", () => {
  it("captures runtime metadata with default timestamp generator", () => {
    const env = captureBenchmarkEnvironment();
    expect(env.runtime).toBeDefined();
    expect(typeof env.timestamp).toBe("string");
    expect(Date.parse(env.timestamp)).not.toBeNaN();
    if (typeof process !== "undefined" && process.version) {
      expect(env.nodeVersion).toBe(process.version);
      expect(env.platform).toBe(process.platform);
      expect(env.arch).toBe(process.arch);
      expect(env.heapUsedBytes).toBeGreaterThan(0);
      expect(env.heapTotalBytes).toBeGreaterThan(0);
    }
  });

  it("accepts a deterministic custom timestamp function", () => {
    const fixedIso = "2026-11-26T12:00:00.000Z";
    const env = captureBenchmarkEnvironment(() => fixedIso);
    expect(env.timestamp).toBe(fixedIso);
  });
});

describe("DEFAULT_BUNDLE_BUDGETS", () => {
  it("defines release gates for critical artifacts", () => {
    expect(DEFAULT_BUNDLE_BUDGETS.length).toBeGreaterThanOrEqual(4);
    for (const budget of DEFAULT_BUNDLE_BUDGETS) {
      expect(budget.name).toBeDefined();
      expect(budget.file).toBeDefined();
      expect(budget.budgetBytes).toBeGreaterThan(0);
      expect(["release-gate", "informational"]).toContain(budget.category);
    }

    const rootBudget = DEFAULT_BUNDLE_BUDGETS.find((b) => b.name === "full SDK");
    expect(rootBudget).toBeDefined();
    expect(rootBudget?.category).toBe("release-gate");
    expect(rootBudget?.budgetBytes).toBe(150 * 1024);
  });
});

describe("evaluateBundleBudget", () => {
  const sampleBudget: BundleBudgetDefinition = {
    name: "test-module",
    file: "dist/test.mjs",
    budgetBytes: 1000,
    category: "release-gate",
  };

  it("passes when size is strictly below the budget", () => {
    const result = evaluateBundleBudget(800, sampleBudget);
    expect(result.pass).toBe(true);
    expect(result.differenceBytes).toBe(-200);
    expect(result.percentage).toBe(80);
  });

  it("passes at the exact boundary condition (size == budget)", () => {
    const result = evaluateBundleBudget(1000, sampleBudget);
    expect(result.pass).toBe(true);
    expect(result.differenceBytes).toBe(0);
    expect(result.percentage).toBe(100);
  });

  it("fails when size is 1 byte over the budget", () => {
    const result = evaluateBundleBudget(1001, sampleBudget);
    expect(result.pass).toBe(false);
    expect(result.differenceBytes).toBe(1);
    expect(result.percentage).toBe(100.1);
  });

  it("handles boundary case of 0 observed bytes", () => {
    const result = evaluateBundleBudget(0, sampleBudget);
    expect(result.pass).toBe(true);
    expect(result.differenceBytes).toBe(-1000);
    expect(result.percentage).toBe(0);
  });

  it("handles large size overrun", () => {
    const result = evaluateBundleBudget(2500, sampleBudget);
    expect(result.pass).toBe(false);
    expect(result.differenceBytes).toBe(1500);
    expect(result.percentage).toBe(250);
  });
});
