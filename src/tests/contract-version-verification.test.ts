import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordObservation,
  getContractVersionHistory,
  resetContractVersionTracking,
  invalidateContractVersionCache,
  type ContractUpgradeEvent,
  type ContractVersionOptions,
} from "../soroban/contractVersion";

const CONTRACT_A =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const CONTRACT_B =
  "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4";

describe("contract-version-verification – upgrade callback", () => {
  beforeEach(() => {
    resetContractVersionTracking(CONTRACT_A);
    resetContractVersionTracking(CONTRACT_B);
  });

  it("matching version does not fire onContractUpgrade", () => {
    const onUpgrade = vi.fn();
    const opts: ContractVersionOptions = { onContractUpgrade: onUpgrade };

    // Establish the first observation (no previous → no callback).
    recordObservation(CONTRACT_A, "v1.0.0", opts);
    // Same version again — no change.
    recordObservation(CONTRACT_A, "v1.0.0", opts);

    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("version change fires onContractUpgrade exactly once per change", () => {
    const events: ContractUpgradeEvent[] = [];
    const opts: ContractVersionOptions = {
      onContractUpgrade: (e) => events.push(e),
    };

    recordObservation(CONTRACT_A, "v1.0.0", opts); // initial — no callback
    recordObservation(CONTRACT_A, "v2.0.0", opts); // upgrade → callback

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      contractId: CONTRACT_A,
      previousVersion: "v1.0.0",
      currentVersion: "v2.0.0",
    });
  });

  it("fires onContractUpgrade for each distinct version change", () => {
    const onUpgrade = vi.fn();
    const opts: ContractVersionOptions = { onContractUpgrade: onUpgrade };

    recordObservation(CONTRACT_A, "v1.0.0", opts);
    recordObservation(CONTRACT_A, "v2.0.0", opts);
    recordObservation(CONTRACT_A, "v3.0.0", opts);

    expect(onUpgrade).toHaveBeenCalledTimes(2);
    expect(onUpgrade).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        previousVersion: "v1.0.0",
        currentVersion: "v2.0.0",
      }),
    );
    expect(onUpgrade).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousVersion: "v2.0.0",
        currentVersion: "v3.0.0",
      }),
    );
  });

  it("upgrade callbacks are independent per contract", () => {
    const onUpgradeA = vi.fn();
    const onUpgradeB = vi.fn();

    recordObservation(CONTRACT_A, "v1.0.0", { onContractUpgrade: onUpgradeA });
    recordObservation(CONTRACT_B, "u1.0.0", { onContractUpgrade: onUpgradeB });
    recordObservation(CONTRACT_A, "v2.0.0", { onContractUpgrade: onUpgradeA });

    expect(onUpgradeA).toHaveBeenCalledTimes(1);
    expect(onUpgradeB).not.toHaveBeenCalled();
  });
});

describe("contract-version-verification – null version safety", () => {
  beforeEach(() => {
    resetContractVersionTracking(CONTRACT_A);
  });

  it("null version never fires onContractUpgrade", () => {
    const onUpgrade = vi.fn();
    const opts: ContractVersionOptions = { onContractUpgrade: onUpgrade };

    recordObservation(CONTRACT_A, null, opts);
    recordObservation(CONTRACT_A, null, opts);

    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("null version after a real version does not fire upgrade callback", () => {
    const onUpgrade = vi.fn();
    const opts: ContractVersionOptions = { onContractUpgrade: onUpgrade };

    recordObservation(CONTRACT_A, "v1.0.0", opts);
    onUpgrade.mockClear();

    recordObservation(CONTRACT_A, null, opts); // metadata absent — ignore

    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("null version does not overwrite a prior non-null observation", () => {
    recordObservation(CONTRACT_A, "v1.0.0");
    recordObservation(CONTRACT_A, null);

    // The subsequent real version must still be treated as an upgrade,
    // proving the prior "v1.0.0" was retained.
    const onUpgrade = vi.fn();
    recordObservation(CONTRACT_A, "v2.0.0", { onContractUpgrade: onUpgrade });

    expect(onUpgrade).toHaveBeenCalledOnce();
    expect(onUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({
        previousVersion: "v1.0.0",
        currentVersion: "v2.0.0",
      }),
    );
  });

  it("null version produces no history entry", () => {
    recordObservation(CONTRACT_A, null);
    expect(getContractVersionHistory(CONTRACT_A)).toHaveLength(0);
  });
});

describe("contract-version-verification – cache invalidation", () => {
  beforeEach(() => {
    resetContractVersionTracking(CONTRACT_A);
  });

  it("invalidateContractVersionCache removes the cached version", () => {
    // Build a minimal SorokitCache stub.
    const store = new Map<string, unknown>();
    const mockCache = {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => { store.set(k, v); },
      invalidate: (k: string) => { store.delete(k); },
    };

    // Seed the cache with a version entry that has a far-future expiry.
    const key = `sorokit:contract-version:${CONTRACT_A}`;
    store.set(key, { version: "v1.0.0", expiresAt: Date.now() + 3_600_000 });

    expect(store.has(key)).toBe(true);

    invalidateContractVersionCache(CONTRACT_A, mockCache);

    expect(store.has(key)).toBe(false);
  });

  it("invalidateContractVersionCache does not throw for unknown contracts", () => {
    expect(() =>
      invalidateContractVersionCache("CUNKNOWNCONTRACT", undefined),
    ).not.toThrow();
  });
});

describe("contract-version-verification – resetContractVersionTracking", () => {
  beforeEach(() => {
    resetContractVersionTracking(CONTRACT_A);
  });

  it("resets to initial state: no history, no observed version", () => {
    recordObservation(CONTRACT_A, "v1.0.0");
    recordObservation(CONTRACT_A, "v2.0.0");

    expect(getContractVersionHistory(CONTRACT_A).length).toBeGreaterThan(0);

    resetContractVersionTracking(CONTRACT_A);

    expect(getContractVersionHistory(CONTRACT_A)).toHaveLength(0);
  });

  it("after reset the first observation is not treated as an upgrade", () => {
    recordObservation(CONTRACT_A, "v1.0.0");
    recordObservation(CONTRACT_A, "v2.0.0");
    resetContractVersionTracking(CONTRACT_A);

    const onUpgrade = vi.fn();
    recordObservation(CONTRACT_A, "v3.0.0", { onContractUpgrade: onUpgrade });

    expect(onUpgrade).not.toHaveBeenCalled();
    const history = getContractVersionHistory(CONTRACT_A);
    expect(history[0].isUpgrade).toBe(false);
  });

  it("reset does not affect a different contract", () => {
    recordObservation(CONTRACT_A, "v1.0.0");
    recordObservation(CONTRACT_B, "u1.0.0");

    resetContractVersionTracking(CONTRACT_A);

    expect(getContractVersionHistory(CONTRACT_A)).toHaveLength(0);
    expect(getContractVersionHistory(CONTRACT_B)).toHaveLength(1);
  });
});

describe("contract-version-verification – history ordering", () => {
  beforeEach(() => {
    resetContractVersionTracking(CONTRACT_A);
  });

  it("returns entries in chronological order (oldest first)", () => {
    recordObservation(CONTRACT_A, "v1.0.0");
    recordObservation(CONTRACT_A, "v2.0.0");
    recordObservation(CONTRACT_A, "v3.0.0");

    const history = getContractVersionHistory(CONTRACT_A);

    expect(history.map((e) => e.version)).toEqual([
      "v1.0.0",
      "v2.0.0",
      "v3.0.0",
    ]);
  });

  it("timestamps are non-decreasing", () => {
    for (let i = 1; i <= 5; i++) {
      recordObservation(CONTRACT_A, `v${i}.0.0`);
    }

    const history = getContractVersionHistory(CONTRACT_A);

    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1].observedAt).getTime();
      const curr = new Date(history[i].observedAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("first entry has isUpgrade false, subsequent entries have isUpgrade true", () => {
    recordObservation(CONTRACT_A, "v1.0.0");
    recordObservation(CONTRACT_A, "v2.0.0");
    recordObservation(CONTRACT_A, "v3.0.0");

    const history = getContractVersionHistory(CONTRACT_A);

    expect(history[0].isUpgrade).toBe(false);
    expect(history[1].isUpgrade).toBe(true);
    expect(history[2].isUpgrade).toBe(true);
  });
});

describe("contract-version-verification – version mismatch detection", () => {
  beforeEach(() => {
    resetContractVersionTracking(CONTRACT_A);
  });

  it("matches when observed version equals expected version", () => {
    recordObservation(CONTRACT_A, "v1.2.3");

    const history = getContractVersionHistory(CONTRACT_A);
    const observed = history[history.length - 1]?.version ?? null;

    const expectedVersion = "v1.2.3";
    const isMismatch = observed !== expectedVersion;

    expect(isMismatch).toBe(false);
  });

  it("detects mismatch when observed version differs from expected", () => {
    recordObservation(CONTRACT_A, "v2.0.0");

    const history = getContractVersionHistory(CONTRACT_A);
    const observed = history[history.length - 1]?.version ?? null;

    const expectedVersion = "v1.2.3";
    const isMismatch = observed !== expectedVersion;

    expect(isMismatch).toBe(true);
  });

  it("treats no history (unobserved) as a mismatch against a known expected version", () => {
    // No observation recorded — history is empty.
    const history = getContractVersionHistory(CONTRACT_A);
    const observed = history[history.length - 1]?.version ?? null;

    const expectedVersion = "v1.0.0";
    const isMismatch = observed !== expectedVersion;

    expect(observed).toBeNull();
    expect(isMismatch).toBe(true);
  });

  it("upgrade callback can be used to block sensitive operations on mismatch", () => {
    let callBlocked = false;

    const opts: ContractVersionOptions = {
      onContractUpgrade: (event) => {
        // Application logic: block calls if the version is not the pinned one.
        if (event.currentVersion !== "v1.0.0") {
          callBlocked = true;
        }
      },
    };

    recordObservation(CONTRACT_A, "v1.0.0", opts); // initial — no callback
    recordObservation(CONTRACT_A, "v2.0.0", opts); // upgrade detected

    expect(callBlocked).toBe(true);
  });
});
