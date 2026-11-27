import { describe, it, expect } from "vitest";
import {
  filterContractEvents,
  groupByTime,
  countByType,
  calculateRate,
  type ContractEvent,
} from "../soroban/subscribeContractEvents";

describe("filterContractEvents — ordering and deduplication semantics", () => {
  it("preserves the original order of events (does not reorder)", () => {
    const events: ContractEvent[] = [
      { id: "evt-3", eventType: "transfer", ledger: 3 },
      { id: "evt-1", eventType: "transfer", ledger: 1 },
      { id: "evt-2", eventType: "transfer", ledger: 2 },
    ];

    const result = filterContractEvents(events, { eventType: "transfer" });

    expect(result.map((e) => e.id)).toEqual(["evt-3", "evt-1", "evt-2"]);
  });

  it("passes out-of-order ledger numbers through in input order (does not sort)", () => {
    const events: ContractEvent[] = [
      { id: "a", ledger: 100 },
      { id: "b", ledger: 50 },
      { id: "c", ledger: 200 },
      { id: "d", ledger: 75 },
    ];

    // No filter — all events should pass through in input order
    const result = filterContractEvents(events);

    expect(result.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.map((e) => e.ledger)).toEqual([100, 50, 200, 75]);
  });

  it("passes all events with identical ids through (no deduplication in filter)", () => {
    const events: ContractEvent[] = [
      { id: "dup-id", eventType: "mint", ledger: 10 },
      { id: "dup-id", eventType: "mint", ledger: 10 },
      { id: "dup-id", eventType: "mint", ledger: 10 },
    ];

    const result = filterContractEvents(events, { eventType: "mint" });

    // All three must appear — filterContractEvents never deduplicates
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.id === "dup-id")).toBe(true);
  });

  it("repeated events (same id, same content) both appear — filter does not deduplicate", () => {
    const event: ContractEvent = { id: "repeat", eventType: "swap", ledger: 5 };
    const events: ContractEvent[] = [event, { ...event }];

    const result = filterContractEvents(events, { eventType: "swap" });

    expect(result).toHaveLength(2);
  });

  it("returns an empty array when no events pass the filter", () => {
    const events: ContractEvent[] = [
      { id: "x", eventType: "transfer" },
      { id: "y", eventType: "transfer" },
    ];

    const result = filterContractEvents(events, { eventType: "burn" });

    expect(result).toHaveLength(0);
  });

  it("returns all events when no filter is provided", () => {
    const events: ContractEvent[] = [
      { id: "1", eventType: "a" },
      { id: "2", eventType: "b" },
    ];

    const result = filterContractEvents(events);

    expect(result).toHaveLength(2);
    expect(result).not.toBe(events); // must return a new array (slice)
  });
});

describe("groupByTime — bucket ordering", () => {
  const intervalMs = 1_000; // 1 second buckets

  it("buckets events by timestamp and preserves input order within each bucket", () => {
    const events: ContractEvent[] = [
      { id: "a", timestamp: 1000 },
      { id: "b", timestamp: 1500 }, // same bucket as "a"
      { id: "c", timestamp: 2000 },
      { id: "d", timestamp: 1200 }, // same bucket as "a" and "b"
    ];

    const groups = groupByTime(events, intervalMs);

    // Bucket starting at 1000 ms should contain a, b, d in input order
    const bucket1 = groups.get(1000);
    expect(bucket1?.map((e) => e.id)).toEqual(["a", "b", "d"]);

    // Bucket starting at 2000 ms should contain just c
    const bucket2 = groups.get(2000);
    expect(bucket2?.map((e) => e.id)).toEqual(["c"]);
  });

  it("excludes events without a timestamp (not silently reordered)", () => {
    const events: ContractEvent[] = [
      { id: "has-ts", timestamp: 5000 },
      { id: "no-ts" }, // no timestamp field
      { id: "also-has-ts", timestamp: 5500 },
    ];

    const groups = groupByTime(events, intervalMs);

    const allGrouped = [...groups.values()].flat();
    const ids = allGrouped.map((e) => e.id);

    expect(ids).toContain("has-ts");
    expect(ids).toContain("also-has-ts");
    expect(ids).not.toContain("no-ts");
  });

  it("throws RangeError for a non-positive intervalMs", () => {
    expect(() => groupByTime([], 0)).toThrow(RangeError);
    expect(() => groupByTime([], -1)).toThrow(RangeError);
  });
});

describe("countByType — event type tallying", () => {
  it("counts events with the same eventType correctly", () => {
    const events: ContractEvent[] = [
      { id: "1", eventType: "transfer" },
      { id: "2", eventType: "transfer" },
      { id: "3", eventType: "mint" },
      { id: "4", eventType: "transfer" },
    ];

    const counts = countByType(events);

    expect(counts["transfer"]).toBe(3);
    expect(counts["mint"]).toBe(1);
  });

  it("returns an empty record for an empty input", () => {
    expect(countByType([])).toEqual({});
  });
});

describe("calculateRate — edge cases", () => {
  it("returns 0 for a single event (no elapsed time)", () => {
    const events: ContractEvent[] = [{ id: "solo", timestamp: 1_000_000 }];

    expect(calculateRate(events)).toBe(0);
  });

  it("returns 0 for an empty array", () => {
    expect(calculateRate([])).toBe(0);
  });

  it("returns events-per-second using the provided windowMs", () => {
    const events: ContractEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      timestamp: i * 100,
    }));

    // 10 events over 10 seconds = 1 event/sec
    const rate = calculateRate(events, 10_000);
    expect(rate).toBeCloseTo(1, 5);
  });

  it("returns 0 when all events share the same timestamp (zero elapsed)", () => {
    const events: ContractEvent[] = [
      { id: "a", timestamp: 999 },
      { id: "b", timestamp: 999 },
    ];

    expect(calculateRate(events)).toBe(0);
  });
});
