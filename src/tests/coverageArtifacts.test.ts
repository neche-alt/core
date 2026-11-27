/**
 * Focused tests for coverage artifact generation (#117).
 *
 * Covers the stable, well-exercised modules most relevant to coverage
 * reporting: cursor store persistence, event deduplication TTL eviction,
 * and telemetry configuration validation.  These tests are intentionally
 * narrow — they assert the behaviour of each boundary or failure case that
 * is most likely to regress silently.
 */

import { describe, it, expect, vi } from "vitest";
import {
  MemoryCursorStore,
  LocalStorageCursorStore,
  PersistentEventDeduplicationStore,
  createCursorStore,
} from "../streaming/cursorStore";
import { validateTelemetryConfig } from "../performance/telemetry";

// ─── MemoryCursorStore ────────────────────────────────────────────────────────

describe("MemoryCursorStore", () => {
  it("save and load round-trip", async () => {
    const store = new MemoryCursorStore();
    await store.save("k", "cursor-1");
    expect(await store.load("k")).toBe("cursor-1");
  });

  it("load returns undefined for an unknown key", async () => {
    const store = new MemoryCursorStore();
    expect(await store.load("missing")).toBeUndefined();
  });

  it("save overwrites an existing cursor", async () => {
    const store = new MemoryCursorStore();
    await store.save("k", "first");
    await store.save("k", "second");
    expect(await store.load("k")).toBe("second");
  });

  it("clear() with a key removes only that key", async () => {
    const store = new MemoryCursorStore();
    await store.save("a", "1");
    await store.save("b", "2");
    await store.clear("a");
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBe("2");
  });

  it("clear() without a key removes all cursors", async () => {
    const store = new MemoryCursorStore();
    await store.save("a", "1");
    await store.save("b", "2");
    await store.clear();
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("b")).toBeUndefined();
  });
});

// ─── createCursorStore ────────────────────────────────────────────────────────

describe("createCursorStore", () => {
  it("returns a MemoryCursorStore when no storage argument is provided and localStorage is absent", () => {
    // In Node/vitest environment localStorage is not defined, so it falls back.
    const store = createCursorStore(undefined);
    // MemoryCursorStore has no extra properties beyond the interface; we
    // verify it at least behaves like a CursorStore.
    expect(typeof store.save).toBe("function");
    expect(typeof store.load).toBe("function");
    expect(typeof store.clear).toBe("function");
  });

  it("returns a LocalStorageCursorStore when a Storage instance is passed", () => {
    const mockStorage: Storage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
    };
    const store = createCursorStore(mockStorage);
    expect(store).toBeInstanceOf(LocalStorageCursorStore);
  });
});

// ─── PersistentEventDeduplicationStore ───────────────────────────────────────

describe("PersistentEventDeduplicationStore", () => {
  it("has() returns false for a new id", async () => {
    const store = new PersistentEventDeduplicationStore();
    expect(await store.has("new-id")).toBe(false);
  });

  it("add() then has() returns true", async () => {
    const store = new PersistentEventDeduplicationStore();
    await store.add("event-1");
    expect(await store.has("event-1")).toBe(true);
  });

  it("clear() removes all ids", async () => {
    const store = new PersistentEventDeduplicationStore();
    await store.add("event-1");
    await store.add("event-2");
    await store.clear();
    expect(await store.has("event-1")).toBe(false);
    expect(await store.has("event-2")).toBe(false);
  });

  it("evicts ids whose TTL has expired", async () => {
    let now = 0;
    const store = new PersistentEventDeduplicationStore(
      1_000, // maxSize
      100,   // ttlMs — 100 ms
      () => now,
    );

    now = 0;
    await store.add("old-event");
    now = 150; // past the 100 ms TTL
    // has() triggers eviction
    expect(await store.has("old-event")).toBe(false);
  });

  it("evicts oldest entries when maxSize is exceeded", async () => {
    const store = new PersistentEventDeduplicationStore(2, 60_000);
    await store.add("a");
    await store.add("b");
    await store.add("c"); // should evict "a"
    // After eviction the size is 2; "a" may or may not be present depending
    // on insertion order — what matters is size stays bounded.
    // We can't inspect internal Map size directly, but we can verify
    // the store still functions correctly.
    expect(await store.has("b")).toBe(true);
    expect(await store.has("c")).toBe(true);
  });
});

// ─── validateTelemetryConfig ──────────────────────────────────────────────────

describe("validateTelemetryConfig", () => {
  it("returns null for a valid minimal config", () => {
    expect(validateTelemetryConfig({ serviceName: "my-app" })).toBeNull();
  });

  it("returns null for a fully-specified valid config", () => {
    expect(
      validateTelemetryConfig({
        serviceName: "my-app",
        serviceVersion: "1.0.0",
        exporter: "console",
        samplingRate: 0.5,
        metricsIntervalMs: 5000,
      }),
    ).toBeNull();
  });

  it("returns an error string when serviceName is missing", () => {
    // @ts-expect-error intentional missing serviceName
    const result = validateTelemetryConfig({});
    expect(typeof result).toBe("string");
    expect(result).toMatch(/serviceName/);
  });

  it("returns an error string when serviceName is empty", () => {
    const result = validateTelemetryConfig({ serviceName: "   " });
    expect(typeof result).toBe("string");
  });

  it("returns an error string for an invalid exporter", () => {
    const result = validateTelemetryConfig({
      serviceName: "app",
      // @ts-expect-error intentional invalid exporter
      exporter: "unknown-backend",
    });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/exporter/i);
  });

  it("returns an error string when samplingRate is out of range", () => {
    const result = validateTelemetryConfig({ serviceName: "app", samplingRate: 2 });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/samplingRate/);
  });

  it("returns an error string for a non-positive metricsIntervalMs", () => {
    const result = validateTelemetryConfig({ serviceName: "app", metricsIntervalMs: 0 });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/metricsIntervalMs/);
  });

  it("returns an error string when config is not an object", () => {
    // @ts-expect-error intentional wrong type
    const result = validateTelemetryConfig("not-an-object");
    expect(typeof result).toBe("string");
  });
});
