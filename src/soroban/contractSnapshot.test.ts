import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  snapshotContractState,
  compareSnapshots,
  listSnapshots,
  clearSnapshots,
  setContractSnapshotRetention,
  pruneContractSnapshots,
  getContractSnapshotCount,
  MAX_SNAPSHOT_STATE_BYTES,
} from "./contractSnapshot";

// Mock the stellar-sdk and serverFactory
const { mockGetLedgerEntries } = vi.hoisted(() => ({
  mockGetLedgerEntries: vi.fn(),
}));

vi.mock("../shared/serverFactory", () => ({
  createSorobanServer: vi.fn(() => ({
    getLedgerEntries: mockGetLedgerEntries,
  })),
  createHorizonServer: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      getFootprint: vi.fn().mockReturnValue({}),
    })),
  };
});

const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function makeLedgerEntry(wasmHash?: string) {
  return {
    entries: wasmHash ? [{
      val: {
        contractData: () => ({
          val: () => ({
            instance: () => ({
              executable: () => ({
                switch: () => ({ name: "contractExecutableWasm" }),
                wasmHash: () => Buffer.from(wasmHash, "hex"),
              }),
            }),
          }),
        }),
      },
    }] : [],
  };
}

beforeEach(() => {
  clearSnapshots();
  mockGetLedgerEntries.mockReset();
  setContractSnapshotRetention({ maxSnapshots: 200 });
});

describe("snapshotContractState", () => {
  it("captures and stores a snapshot", async () => {
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("deadbeef"));
    const result = await snapshotContractState(RPC_URL, CONTRACT_ID, "test-snap");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.contractId).toBe(CONTRACT_ID);
      expect(result.data.label).toBe("test-snap");
    }
  });

  it("stores snapshot in the registry", async () => {
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("deadbeef"));
    await snapshotContractState(RPC_URL, CONTRACT_ID, "reg-snap");
    expect(getContractSnapshotCount()).toBe(1);
  });

  it("redacts specified keys from state before storing", async () => {
    // We'll force a state with known keys by injecting via mock.
    // The extractState function in contractSnapshot runs on the entry.
    // Since we can't easily get custom keys via the existing extractState,
    // we test redaction works when keys are provided.
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("aabbccdd"));
    const result = await snapshotContractState(RPC_URL, CONTRACT_ID, "redacted", {
      redactKeys: ["executable"],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.state["executable"]).toBeUndefined();
    }
  });

  it("returns error when state exceeds maxStateBytesPerSnapshot", async () => {
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("aabbccdd"));
    // maxStateBytesPerSnapshot of 1 byte will always be exceeded
    const result = await snapshotContractState(RPC_URL, CONTRACT_ID, "oversized", {
      maxStateBytesPerSnapshot: 1,
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toMatch(/size limit/i);
    }
  });

  it("does not store oversized snapshot", async () => {
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("aabbccdd"));
    await snapshotContractState(RPC_URL, CONTRACT_ID, "overflow", {
      maxStateBytesPerSnapshot: 1,
    });
    expect(getContractSnapshotCount()).toBe(0);
  });
});

describe("retention policy", () => {
  it("prunes snapshots exceeding maxSnapshots", async () => {
    setContractSnapshotRetention({ maxSnapshots: 2 });
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("deadbeef"));
    for (let i = 0; i < 5; i++) {
      await snapshotContractState(RPC_URL, CONTRACT_ID, `snap-${i}`);
    }
    expect(getContractSnapshotCount()).toBeLessThanOrEqual(2);
  });

  it("pruneContractSnapshots evicts aged snapshots", async () => {
    setContractSnapshotRetention({ maxSnapshots: 200, maxAgeMs: 1000 });
    mockGetLedgerEntries.mockResolvedValue(makeLedgerEntry("deadbeef"));
    await snapshotContractState(RPC_URL, CONTRACT_ID, "old-snap");
    expect(getContractSnapshotCount()).toBe(1);
    // Prune with a future timestamp so the snapshot appears old
    const evicted = pruneContractSnapshots(Date.now() + 2000);
    expect(evicted).toBe(1);
    expect(getContractSnapshotCount()).toBe(0);
  });
});

describe("compareSnapshots", () => {
  it("returns error for missing snapshot", () => {
    const result = compareSnapshots("nonexistent-a", "nonexistent-b");
    expect(result.status).toBe("error");
  });
});

describe("MAX_SNAPSHOT_STATE_BYTES", () => {
  it("is a positive number", () => {
    expect(MAX_SNAPSHOT_STATE_BYTES).toBeGreaterThan(0);
  });
});
