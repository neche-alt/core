/**
 * Contract event cursor recovery and resume (#45).
 *
 * Event consumers must resume from a durable position after a restart without
 * losing events or replaying an unbounded history. `subscribeContractEvents`
 * and `streamContractEvents` accept a `startLedger` option (the last ledger a
 * consumer has already processed, persisted across restarts); on the first poll
 * they recover the events after it, bounded by `recoveryWindowMs`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  subscribeContractEvents,
  streamContractEvents,
  type ContractEvent,
} from "../soroban/subscribeContractEvents";

function makeEvent(
  id: string,
  contractId: string,
  name: string,
  ledger: number,
): ContractEvent {
  return { id, contractId, name, topics: [], value: {}, ledger };
}

/** /ledgers?order=desc&limit=1 list response, optionally carrying events. */
function ledgerListResponse(sequence: number, events: ContractEvent[] = []) {
  const records =
    events.length > 0
      ? events.map((e) => ({
          sequence,
          id: e.id,
          contractId: e.contractId,
          name: e.name,
          topics: e.topics ?? [],
          value: e.value ?? {},
          ledger: e.ledger ?? sequence,
          ...e,
        }))
      : [{ sequence }];
  return { _embedded: { records } };
}

/** /ledgers/{seq} detail response used by recovery. */
function ledgerDetailResponse(sequence: number, events: ContractEvent[] = []) {
  return {
    _embedded: {
      records: events.map((e) => ({
        sequence,
        id: e.id,
        contractId: e.contractId,
        name: e.name,
        topics: e.topics ?? [],
        value: e.value ?? {},
        ledger: e.ledger ?? sequence,
        ...e,
      })),
    },
  };
}

const allDelivered = (cb: ReturnType<typeof vi.fn>): ContractEvent[] =>
  cb.mock.calls
    .flat(2)
    .filter(
      (e): e is ContractEvent =>
        e !== null && typeof e === "object" && "id" in (e as Record<string, unknown>),
    );

describe("subscribeContractEvents — cursor resume (#45)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumes from a saved cursor, recovering the events after it", async () => {
    const callback = vi.fn();

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      // Recovery: individual ledger endpoints.
      if (/\/ledgers\/\d+$/.test(url)) {
        if (url.includes("/101")) {
          return { ok: true, json: async () => ledgerDetailResponse(101, [makeEvent("e101", "C1", "transfer", 101)]) };
        }
        if (url.includes("/102")) {
          return { ok: true, json: async () => ledgerDetailResponse(102, [makeEvent("e102", "C1", "transfer", 102)]) };
        }
        if (url.includes("/103")) {
          return { ok: true, json: async () => ledgerDetailResponse(103, [makeEvent("e103", "C1", "transfer", 103)]) };
        }
        return { ok: true, json: async () => ledgerDetailResponse(0) };
      }
      // List endpoint: current tip is 103.
      return { ok: true, json: async () => ledgerListResponse(103, [makeEvent("e103", "C1", "transfer", 103)]) };
    });

    const unsub = subscribeContractEvents("C1", undefined, callback, {
      horizonUrl: "http://localhost",
      intervalMs: 1,
      fetch: fetchMock,
      startLedger: 100,
    });

    await vi.advanceTimersByTimeAsync(1);

    const ids = allDelivered(callback).map((e) => e.id);
    // Events after the cursor (101, 102, 103) are recovered in ledger order;
    // the ledger-103 event from the list endpoint is deduplicated.
    expect(ids).toEqual(["e101", "e102", "e103"]);

    unsub();
  });

  it("does not replay an unbounded history when the cursor is far behind the tip", async () => {
    const callback = vi.fn();

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (/\/ledgers\/\d+$/.test(url)) {
        if (url.includes("/199")) {
          return { ok: true, json: async () => ledgerDetailResponse(199, [makeEvent("e199", "C1", "transfer", 199)]) };
        }
        if (url.includes("/200")) {
          return { ok: true, json: async () => ledgerDetailResponse(200, [makeEvent("e200", "C1", "transfer", 200)]) };
        }
        return { ok: true, json: async () => ledgerDetailResponse(0) };
      }
      // Current tip is 200; the persisted cursor is 100 (far behind).
      return { ok: true, json: async () => ledgerListResponse(200, [makeEvent("e200", "C1", "transfer", 200)]) };
    });

    const unsub = subscribeContractEvents("C1", undefined, callback, {
      horizonUrl: "http://localhost",
      intervalMs: 1,
      fetch: fetchMock,
      startLedger: 100,
      // Small window => at most ~2 ledgers recovered (ceil(11000 / 5500) = 2).
      recoveryWindowMs: 11000,
    });

    await vi.advanceTimersByTimeAsync(1);

    const ids = allDelivered(callback).map((e) => e.id);
    // Only the bounded window (199, 200) is replayed — not ledgers 101..197.
    expect(ids).toEqual(["e199", "e200"]);

    const recoveredSeqs = fetchMock.mock.calls
      .map((call: [string, ...unknown[]]) => (typeof call[0] === "string" ? call[0] : ""))
      .filter((u) => /\/ledgers\/\d+$/.test(u))
      .map((u) => Number(u.match(/\/ledgers\/(\d+)$/)![1]));
    expect(recoveredSeqs).toEqual([199, 200]);

    unsub();
  });

  it("does not replay the cursor ledger when the tip has not advanced past it", async () => {
    const callback = vi.fn();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ledgerListResponse(100, [makeEvent("e100", "C1", "transfer", 100)]),
    });

    const unsub = subscribeContractEvents("C1", undefined, callback, {
      horizonUrl: "http://localhost",
      intervalMs: 1,
      fetch: fetchMock,
      startLedger: 100,
    });

    await vi.advanceTimersByTimeAsync(1);

    // The tip equals the cursor; the ledger-100 event was already processed
    // before the restart, so it must not be replayed.
    expect(callback).not.toHaveBeenCalled();

    unsub();
  });

  it("does not replay stale events when the cursor is ahead of the tip", async () => {
    const callback = vi.fn();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      // Tip (95) is behind the persisted cursor (100).
      json: async () => ledgerListResponse(95, [makeEvent("e95", "C1", "transfer", 95)]),
    });

    const unsub = subscribeContractEvents("C1", undefined, callback, {
      horizonUrl: "http://localhost",
      intervalMs: 1,
      fetch: fetchMock,
      startLedger: 100,
    });

    await vi.advanceTimersByTimeAsync(1);

    // Nothing new since the cursor; events before it are not replayed.
    expect(callback).not.toHaveBeenCalled();

    unsub();
  });
});

describe("streamContractEvents — cursor resume (#45)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("resumes from a saved cursor in the stream", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (/\/ledgers\/\d+$/.test(url)) {
        if (url.includes("/101")) {
          return { ok: true, json: async () => ledgerDetailResponse(101, [makeEvent("e101", "C1", "transfer", 101)]) };
        }
        if (url.includes("/102")) {
          return { ok: true, json: async () => ledgerDetailResponse(102, [makeEvent("e102", "C1", "transfer", 102)]) };
        }
        if (url.includes("/103")) {
          return { ok: true, json: async () => ledgerDetailResponse(103, [makeEvent("e103", "C1", "transfer", 103)]) };
        }
        return { ok: true, json: async () => ledgerDetailResponse(0) };
      }
      return { ok: true, json: async () => ledgerListResponse(103, [makeEvent("e103", "C1", "transfer", 103)]) };
    });

    const ac = new AbortController();
    const gen = streamContractEvents(
      "C1",
      undefined,
      { horizonUrl: "http://localhost", intervalMs: 10, fetch: fetchMock, startLedger: 100 },
      ac.signal,
    );

    const r1 = await gen.next();
    expect(r1.done).toBe(false);
    const ids = r1.value.map((e: ContractEvent) => e.id);
    // Recovered events after the cursor, in ledger order; the current
    // ledger-103 event is deduplicated.
    expect(ids).toEqual(["e101", "e102", "e103"]);

    ac.abort();
  });
});
