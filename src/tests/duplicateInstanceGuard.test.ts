/**
 * Duplicate-instance guard tests (#130)
 *
 * Verifies that SOROKIT_INSTANCE_SYMBOL is set on globalThis when the first
 * instance loads, that a second load emits a console.warn, and that the
 * shared symbol key matches across both instances.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SOROKIT_INSTANCE_SYMBOL,
  registerSdkInstance,
} from "../shared/devtoolsBridge";

describe("registerSdkInstance (#130)", () => {
  const symKey = SOROKIT_INSTANCE_SYMBOL;

  beforeEach(() => {
    // Reset the symbol before each test so tests are isolated
    delete (globalThis as Record<symbol, unknown>)[symKey];
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[symKey];
  });

  it("registers the instance on globalThis the first time", () => {
    const isFirst = registerSdkInstance("0.1.0");
    expect(isFirst).toBe(true);

    const meta = (globalThis as Record<symbol, unknown>)[symKey] as {
      version: string;
      loadedAt: number;
    };
    expect(meta).toBeDefined();
    expect(meta.version).toBe("0.1.0");
    expect(typeof meta.loadedAt).toBe("number");
  });

  it("returns false and warns when a second instance registers", () => {
    registerSdkInstance("0.1.0");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const isFirst = registerSdkInstance("0.1.0");
    expect(isFirst).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("Duplicate SDK instance");
    warn.mockRestore();
  });

  it("warning message names the bundler configuration doc", () => {
    registerSdkInstance("0.1.0");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSdkInstance("0.1.0");
    expect(warn.mock.calls[0]![0]).toContain("browser-compatibility.md");
    warn.mockRestore();
  });

  it("uses Symbol.for so the same key resolves across module instances", () => {
    // Symbol.for returns the same symbol given the same key string, regardless
    // of which module instance calls it — this is the cross-instance contract.
    const symbolFromOutside = Symbol.for("sorokit-core/instance");
    expect(symKey).toBe(symbolFromOutside);
  });

  it("does not throw outside a browser (no window)", () => {
    // globalThis is always defined in Node; this just confirms no crash
    expect(() => registerSdkInstance("0.1.0")).not.toThrow();
  });
});

describe("SOROKIT_INSTANCE_SYMBOL type surface (#130)", () => {
  it("is exported from devtoolsBridge", () => {
    expect(typeof SOROKIT_INSTANCE_SYMBOL).toBe("symbol");
  });

  it("is accessible via Symbol.for key 'sorokit-core/instance'", () => {
    expect(SOROKIT_INSTANCE_SYMBOL.toString()).toContain("sorokit-core/instance");
  });
});
