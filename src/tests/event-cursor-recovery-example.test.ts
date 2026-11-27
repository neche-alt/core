/**
 * Restartable consumer example — cursor persistence and resume (#45).
 *
 * Verifies the example under examples/event-cursor-recovery the same way a
 * consumer would experience it: the real SDK subscription runs with only the
 * Horizon fetch faked, the cursor store persists across a simulated restart,
 * and the second consumer resumes from the saved ledger without losing the
 * events in between or replaying the ledger it already processed.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ContractEvent } from "../soroban/subscribeContractEvents";
import {
  createRestartableConsumer,
  InMemoryCursorStore,
} from "../../examples/event-cursor-recovery/src/restartableConsumer";

function makeEvent(
  id: string,
  contractId: string,
  name: string,
  ledger: number,
): ContractEvent {
  return { id, contractId, name, topics: [], value: {}, ledger };
}

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

describe("restartable consumer example (#45)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists the cursor and resumes from it after a restart", async () => {
    const store = new InMemoryCursorStore();
    const received: ContractEvent[] = [];
    const onEvents = (events: ContractEvent[]): void => {
      received.push(...events);
    };

    // First list call serves the first consumer (tip 100); every later list
    // call serves the restarted consumer (tip 103). Recovery serves an event
    // per ledger at /ledgers/{seq}.
    let listCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (/\/ledgers\/\d+$/.test(url)) {
        const seq = Number(url.match(/\/ledgers\/(\d+)$/)![1]);
        return {
          ok: true,
          json: async () =>
            ledgerDetailResponse(seq, [makeEvent(`e${seq}`, "C1", "transfer", seq)]),
        };
      }
      listCalls += 1;
      if (listCalls === 1) {
        return {
          ok: true,
          json: async () =>
            ledgerListResponse(100, [makeEvent("e100", "C1", "transfer", 100)]),
        };
      }
      return {
        ok: true,
        json: async () =>
          ledgerListResponse(103, [makeEvent("e103", "C1", "transfer", 103)]),
      };
    });

    // Phase 1 — first run, no cursor yet: starts at the tip and persists it.
    const first = createRestartableConsumer("C1", {
      horizonUrl: "http://localhost",
      store,
      intervalMs: 1,
      fetch: fetchMock,
      onEvents,
    });
    first.start();
    await vi.advanceTimersByTimeAsync(1);

    expect(received.map((e) => e.id)).toEqual(["e100"]);
    expect(store.load()).toBe(100);
    first.stop();

    // Phase 2 — restart with the SAME store: resumes from ledger 100 and
    // recovers the events after it (101, 102, 103) without re-delivering e100.
    const restarted = createRestartableConsumer("C1", {
      horizonUrl: "http://localhost",
      store,
      intervalMs: 1,
      fetch: fetchMock,
      onEvents,
    });
    restarted.start();
    await vi.advanceTimersByTimeAsync(1);

    expect(received.map((e) => e.id)).toEqual(["e100", "e101", "e102", "e103"]);
    expect(store.load()).toBe(103);

    restarted.stop();
  });
});
