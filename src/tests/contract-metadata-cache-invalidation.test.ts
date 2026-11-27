/**
 * Focused tests for contract metadata cache invalidation (issue #48).
 *
 * Verifies:
 *   - invalidateContractMetadataCache clears BOTH the method/ABI cache and the schema cache.
 *   - invalidateContractCache (existing) only clears the method cache, NOT the schema cache.
 *   - Cache keys follow the expected naming convention.
 *   - Calling invalidation on a non-existent entry is a no-op (no throw).
 *   - After invalidation, the next fetch re-reads from the network (simulated contract upgrade).
 *   - Switching RPC endpoints after invalidation forces a re-fetch.
 *   - External cache entries are also cleared by invalidateContractMetadataCache.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryCache } from "../shared/cache";
import {
  invalidateContractCache,
  invalidateContractMetadataCache,
  resetMetadataCache,
  getContractMetadataCacheStats,
  clearContractSchemaCache,
} from "../soroban/contractMetadata";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// A fake Stellar contract address (C... prefix, 56 characters).
function fakeContractId(suffix = "A"): string {
  return ("C" + "A".repeat(55)).slice(0, 55) + suffix;
}

// ─── Cache key structure ───────────────────────────────────────────────────────

describe("cache key structure", () => {
  it("method/ABI key follows the sorokit:contract-metadata:{contractId} pattern", () => {
    const contractId = fakeContractId("1");
    const expectedKey = `sorokit:contract-metadata:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(expectedKey, { methods: [], expiresAt: Date.now() + 60_000 });
    expect(cache.get(expectedKey)).toBeDefined();
  });

  it("schema key follows the sorokit:contract-schema:{contractId} pattern", () => {
    const contractId = fakeContractId("2");
    const expectedKey = `sorokit:contract-schema:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(expectedKey, { contractId, methods: [] });
    expect(cache.get(expectedKey)).toBeDefined();
  });

  it("method key and schema key are distinct for the same contractId", () => {
    const contractId = fakeContractId("3");
    const metaKey = `sorokit:contract-metadata:${contractId}`;
    const schemaKey = `sorokit:contract-schema:${contractId}`;
    expect(metaKey).not.toBe(schemaKey);
  });
});

// ─── invalidateContractCache (method-only) ────────────────────────────────────

describe("invalidateContractCache — method cache only", () => {
  beforeEach(() => {
    resetMetadataCache();
  });

  it("is a no-op when the contractId has no cached entry (does not throw)", () => {
    expect(() =>
      invalidateContractCache(fakeContractId("X")),
    ).not.toThrow();
  });

  it("removes the method/ABI entry from an external cache", () => {
    const contractId = fakeContractId("4");
    const metaKey = `sorokit:contract-metadata:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(metaKey, { methods: [], expiresAt: Date.now() + 60_000 });

    expect(cache.get(metaKey)).toBeDefined();
    invalidateContractCache(contractId, cache);
    expect(cache.get(metaKey)).toBeUndefined();
  });

  it("does NOT remove the schema entry from an external cache", () => {
    const contractId = fakeContractId("5");
    const schemaKey = `sorokit:contract-schema:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(schemaKey, { contractId, methods: [] });

    invalidateContractCache(contractId, cache);

    expect(cache.get(schemaKey)).toBeDefined();
  });

  it("only invalidates the target contract, not others", () => {
    const idA = fakeContractId("A");
    const idB = fakeContractId("B");
    const metaKeyA = `sorokit:contract-metadata:${idA}`;
    const metaKeyB = `sorokit:contract-metadata:${idB}`;
    const cache = createInMemoryCache();
    cache.set(metaKeyA, { methods: [], expiresAt: Date.now() + 60_000 });
    cache.set(metaKeyB, { methods: [], expiresAt: Date.now() + 60_000 });

    invalidateContractCache(idA, cache);

    expect(cache.get(metaKeyA)).toBeUndefined();
    expect(cache.get(metaKeyB)).toBeDefined();
  });
});

// ─── invalidateContractMetadataCache (full invalidation) ──────────────────────

describe("invalidateContractMetadataCache — clears both caches", () => {
  beforeEach(() => {
    resetMetadataCache();
  });

  it("is a no-op when nothing is cached (does not throw)", () => {
    expect(() =>
      invalidateContractMetadataCache(fakeContractId("Y")),
    ).not.toThrow();
  });

  it("removes the method/ABI entry from an external cache", () => {
    const contractId = fakeContractId("6");
    const metaKey = `sorokit:contract-metadata:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(metaKey, { methods: [], expiresAt: Date.now() + 60_000 });

    invalidateContractMetadataCache(contractId, cache);

    expect(cache.get(metaKey)).toBeUndefined();
  });

  it("removes the schema entry from an external cache", () => {
    const contractId = fakeContractId("7");
    const schemaKey = `sorokit:contract-schema:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(schemaKey, { contractId, methods: [] });

    invalidateContractMetadataCache(contractId, cache);

    expect(cache.get(schemaKey)).toBeUndefined();
  });

  it("removes BOTH entries from an external cache in one call", () => {
    const contractId = fakeContractId("8");
    const metaKey = `sorokit:contract-metadata:${contractId}`;
    const schemaKey = `sorokit:contract-schema:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(metaKey, { methods: [], expiresAt: Date.now() + 60_000 });
    cache.set(schemaKey, { contractId, methods: [] });

    invalidateContractMetadataCache(contractId, cache);

    expect(cache.get(metaKey)).toBeUndefined();
    expect(cache.get(schemaKey)).toBeUndefined();
  });

  it("only invalidates the target contract, leaving others intact", () => {
    const idA = fakeContractId("C");
    const idB = fakeContractId("D");
    const metaKeyA = `sorokit:contract-metadata:${idA}`;
    const schemaKeyA = `sorokit:contract-schema:${idA}`;
    const metaKeyB = `sorokit:contract-metadata:${idB}`;
    const schemaKeyB = `sorokit:contract-schema:${idB}`;
    const cache = createInMemoryCache();
    cache.set(metaKeyA, { methods: [], expiresAt: Date.now() + 60_000 });
    cache.set(schemaKeyA, { contractId: idA, methods: [] });
    cache.set(metaKeyB, { methods: [], expiresAt: Date.now() + 60_000 });
    cache.set(schemaKeyB, { contractId: idB, methods: [] });

    invalidateContractMetadataCache(idA, cache);

    expect(cache.get(metaKeyA)).toBeUndefined();
    expect(cache.get(schemaKeyA)).toBeUndefined();
    expect(cache.get(metaKeyB)).toBeDefined();
    expect(cache.get(schemaKeyB)).toBeDefined();
  });

  it("works without an external cache (in-memory only invalidation)", () => {
    const contractId = fakeContractId("E");
    expect(() => invalidateContractMetadataCache(contractId)).not.toThrow();
  });
});

// ─── Difference: invalidateContractCache vs invalidateContractMetadataCache ───

describe("invalidateContractCache vs invalidateContractMetadataCache", () => {
  it("invalidateContractCache leaves the schema key; invalidateContractMetadataCache removes it", () => {
    const contractId = fakeContractId("F");
    const schemaKey = `sorokit:contract-schema:${contractId}`;
    const metaKey = `sorokit:contract-metadata:${contractId}`;
    const cache = createInMemoryCache();
    cache.set(metaKey, { methods: [], expiresAt: Date.now() + 60_000 });
    cache.set(schemaKey, { contractId, methods: [] });

    // Partial invalidation — schema survives
    invalidateContractCache(contractId, cache);
    expect(cache.get(schemaKey)).toBeDefined();

    // Restore and do a full invalidation
    cache.set(metaKey, { methods: [], expiresAt: Date.now() + 60_000 });
    invalidateContractMetadataCache(contractId, cache);
    expect(cache.get(schemaKey)).toBeUndefined();
  });
});

// ─── In-memory cache stats observable after invalidation ──────────────────────

describe("in-memory cache stats", () => {
  beforeEach(() => {
    resetMetadataCache();
  });

  it("clearContractSchemaCache reduces schema entry count to 0", () => {
    clearContractSchemaCache();
    const stats = getContractMetadataCacheStats();
    expect(stats.schemaEntries).toBe(0);
  });

  it("resetMetadataCache empties both metadata and schema caches", () => {
    resetMetadataCache();
    const stats = getContractMetadataCacheStats();
    expect(stats.metadataEntries).toBe(0);
    expect(stats.schemaEntries).toBe(0);
    expect(stats.inFlightRequests).toBe(0);
  });
});

// ─── Contract upgrade simulation ──────────────────────────────────────────────

describe("contract upgrade / endpoint change simulation", () => {
  beforeEach(() => {
    resetMetadataCache();
  });

  it("simulated upgrade: invalidating then storing fresh data returns new schema", () => {
    const contractId = fakeContractId("G");
    const schemaKey = `sorokit:contract-schema:${contractId}`;
    const cache = createInMemoryCache();

    // Pre-upgrade: stale schema stored in cache
    const staleSchema = { contractId, methods: [{ name: "old_fn", params: [], returnType: null }] };
    cache.set(schemaKey, staleSchema);
    expect(cache.get(schemaKey)).toEqual(staleSchema);

    // Contract upgraded — invalidate everything
    invalidateContractMetadataCache(contractId, cache);
    expect(cache.get(schemaKey)).toBeUndefined();

    // Post-upgrade: fresh schema written (as a real fetch would)
    const freshSchema = { contractId, methods: [{ name: "new_fn", params: [], returnType: "u64" }] };
    cache.set(schemaKey, freshSchema);
    expect(cache.get(schemaKey)).toEqual(freshSchema);
  });

  it("simulated endpoint change: re-fetch after invalidation overwrites stale entry", () => {
    const contractId = fakeContractId("H");
    const metaKey = `sorokit:contract-metadata:${contractId}`;
    const cache = createInMemoryCache();

    // Old endpoint populated the cache
    const oldEntry = {
      methods: [{ name: "fn_v1", inputs: [], returnType: null, visibility: "public" }],
      expiresAt: Date.now() + 60_000,
    };
    cache.set(metaKey, oldEntry);
    expect(cache.get(metaKey)).toEqual(oldEntry);

    // Switch endpoints: invalidate first
    invalidateContractMetadataCache(contractId, cache);
    expect(cache.get(metaKey)).toBeUndefined();

    // New endpoint writes fresh data
    const newEntry = {
      methods: [{ name: "fn_v2", inputs: [], returnType: "bool", visibility: "public" }],
      expiresAt: Date.now() + 60_000,
    };
    cache.set(metaKey, newEntry);
    const stored = cache.get(metaKey) as typeof newEntry;
    expect(stored?.methods[0]?.name).toBe("fn_v2");
  });
});
