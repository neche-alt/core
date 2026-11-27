/**
 * Unit tests for src/shared/browserCompatibility.ts
 *
 * Tests use globalThis manipulation to simulate missing APIs without requiring
 * a real browser environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkBrowserCompatibility,
  assertBrowserCompatibility,
  requireBrowserAPIs,
} from "./browserCompatibility";
import type { RequiredWebAPI } from "./browserCompatibility";

// ── Helpers ───────────────────────────────────────────────���───────────────────

type GlobalKey = "AbortController" | "fetch" | "BroadcastChannel" | "crypto";

const ORIGINAL: Partial<Record<GlobalKey, unknown>> = {};
const REQUIRED_APIS: RequiredWebAPI[] = [
  "AbortController",
  "crypto.subtle",
  "fetch",
  "BroadcastChannel",
];

function saveGlobals() {
  ORIGINAL.AbortController = (globalThis as Record<string, unknown>).AbortController;
  ORIGINAL.fetch = (globalThis as Record<string, unknown>).fetch;
  ORIGINAL.BroadcastChannel = (globalThis as Record<string, unknown>).BroadcastChannel;
  ORIGINAL.crypto = (globalThis as Record<string, unknown>).crypto;
}

function restoreGlobals() {
  (globalThis as Record<string, unknown>).AbortController = ORIGINAL.AbortController;
  (globalThis as Record<string, unknown>).fetch = ORIGINAL.fetch;
  (globalThis as Record<string, unknown>).BroadcastChannel = ORIGINAL.BroadcastChannel;
  (globalThis as Record<string, unknown>).crypto = ORIGINAL.crypto;
}

function deleteGlobal(key: GlobalKey) {
  delete (globalThis as Record<string, unknown>)[key];
}

function setCryptoNoSubtle() {
  (globalThis as Record<string, unknown>).crypto = { getRandomValues: () => {} };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkBrowserCompatibility", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("returns compatible:true when all APIs are present", () => {
    // jsdom provides AbortController and fetch; ensure BroadcastChannel and
    // crypto.subtle are set.
    (globalThis as Record<string, unknown>).AbortController = class {};
    (globalThis as Record<string, unknown>).fetch = () => {};
    (globalThis as Record<string, unknown>).BroadcastChannel = class {};
    (globalThis as Record<string, unknown>).crypto = { subtle: {} };

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(true);
    expect(report.missing).toHaveLength(0);
    expect(report.probes).toHaveLength(4);
    for (const probe of report.probes) {
      expect(probe.available).toBe(true);
    }
  });

  it("detects missing AbortController", () => {
    deleteGlobal("AbortController");

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(false);
    expect(report.missing).toContain("AbortController");
  });

  it("detects missing fetch", () => {
    deleteGlobal("fetch");

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(false);
    expect(report.missing).toContain("fetch");
  });

  it("detects missing BroadcastChannel", () => {
    deleteGlobal("BroadcastChannel");

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(false);
    expect(report.missing).toContain("BroadcastChannel");
  });

  it("detects missing crypto.subtle (crypto present but no subtle)", () => {
    setCryptoNoSubtle();

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(false);
    expect(report.missing).toContain("crypto.subtle");
  });

  it("detects missing crypto entirely", () => {
    deleteGlobal("crypto");

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(false);
    expect(report.missing).toContain("crypto.subtle");
  });

  it("lists all four APIs as missing when environment has none", () => {
    deleteGlobal("AbortController");
    deleteGlobal("fetch");
    deleteGlobal("BroadcastChannel");
    deleteGlobal("crypto");

    const report = checkBrowserCompatibility();

    expect(report.compatible).toBe(false);
    expect(report.missing).toHaveLength(4);
    for (const api of REQUIRED_APIS) {
      expect(report.missing).toContain(api);
    }
  });

  it("includes a probe entry for every required API", () => {
    const report = checkBrowserCompatibility();

    const apis = report.probes.map((p) => p.api);
    for (const api of REQUIRED_APIS) {
      expect(apis).toContain(api);
    }
  });
});

describe("assertBrowserCompatibility", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("returns ok when all APIs are present", () => {
    (globalThis as Record<string, unknown>).AbortController = class {};
    (globalThis as Record<string, unknown>).fetch = () => {};
    (globalThis as Record<string, unknown>).BroadcastChannel = class {};
    (globalThis as Record<string, unknown>).crypto = { subtle: {} };

    const result = assertBrowserCompatibility();

    expect(result.status).toBe("ok");
  });

  it("returns error naming missing APIs", () => {
    deleteGlobal("AbortController");
    deleteGlobal("BroadcastChannel");

    const result = assertBrowserCompatibility();

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("AbortController");
      expect(result.error.message).toContain("BroadcastChannel");
      expect(result.error.code).toBe("WALLET_BROWSER_ONLY");
    }
  });

  it("error message names every missing API", () => {
    deleteGlobal("AbortController");
    deleteGlobal("fetch");
    deleteGlobal("BroadcastChannel");
    deleteGlobal("crypto");

    const result = assertBrowserCompatibility();

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("AbortController");
      expect(result.error.message).toContain("crypto.subtle");
      expect(result.error.message).toContain("fetch");
      expect(result.error.message).toContain("BroadcastChannel");
    }
  });
});

describe("requireBrowserAPIs", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("returns ok when all requested APIs are present", () => {
    (globalThis as Record<string, unknown>).AbortController = class {};
    (globalThis as Record<string, unknown>).fetch = () => {};

    const result = requireBrowserAPIs(["AbortController", "fetch"]);

    expect(result.status).toBe("ok");
  });

  it("returns error naming the missing API", () => {
    deleteGlobal("AbortController");

    const result = requireBrowserAPIs(["AbortController", "fetch"]);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("AbortController");
    }
  });

  it("accepts a subset of required APIs", () => {
    (globalThis as Record<string, unknown>).fetch = () => {};

    const result = requireBrowserAPIs(["fetch"]);

    expect(result.status).toBe("ok");
  });
});
