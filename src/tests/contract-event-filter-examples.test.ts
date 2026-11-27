import { describe, expect, it } from "vitest";
import {
  andEventFilters,
  filterContractEvents,
  orEventFilters,
  type ContractEvent,
  type ContractEventFilter,
} from "../soroban/subscribeContractEvents";

// ---------------------------------------------------------------------------
// Realistic test fixtures
// ---------------------------------------------------------------------------

const CONTRACT_AMM = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const CONTRACT_TOKEN = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5UZQDTQNQZJW";

/** Representative events using XDR symbol strings as topics. */
const events: ContractEvent[] = [
  {
    id: "0000000012884901888-0000000001",
    contractId: CONTRACT_AMM,
    eventType: "swap",
    name: "swap",
    emitter: CONTRACT_AMM,
    topics: ["AAAADQAAAAZzd2FwAAA=", "AAAADQAAAAV0b2tlbgA="],
    timestamp: "2026-01-15T10:00:00.000Z",
    ledger: 3000000,
  },
  {
    id: "0000000012884901888-0000000002",
    contractId: CONTRACT_TOKEN,
    eventType: "transfer",
    name: "transfer",
    emitter: CONTRACT_TOKEN,
    topics: ["AAAADQAAAAh0cmFuc2Zlcg==", "AAAADQAAAAV0b2tlbgA="],
    timestamp: "2026-01-15T10:00:01.000Z",
    ledger: 3000000,
  },
  {
    id: "0000000012884902144-0000000001",
    contractId: CONTRACT_AMM,
    eventType: "liquidity_add",
    name: "liquidity_add",
    emitter: CONTRACT_AMM,
    topics: ["AAAADQAAAAtsaXF1aWRpdHk="],
    timestamp: "2026-01-15T10:00:02.000Z",
    ledger: 3000001,
  },
  {
    id: "0000000012884902144-0000000002",
    contractId: CONTRACT_TOKEN,
    eventType: "mint",
    name: "mint",
    emitter: "GDQERENWDDSQZS7R7WQTZYVSWQEAARHKSPYGS5PU5CXGXMJ3ACFYMQK",
    topics: ["AAAADQAAAARtaW50"],
    timestamp: "2026-01-15T10:00:03.000Z",
    ledger: 3000001,
  },
  {
    // Event without an id field — used to verify pagination boundary handling
    contractId: CONTRACT_AMM,
    eventType: "fee_collected",
    name: "fee_collected",
    emitter: CONTRACT_AMM,
    topics: ["AAAADQAAAANmZWU="],
    timestamp: "2026-01-15T10:00:04.000Z",
    ledger: 3000002,
  },
];

// ---------------------------------------------------------------------------
// 1. Empty filter — no criteria passes all events
// ---------------------------------------------------------------------------

describe("empty filter", () => {
  it("returns every event when no filter is supplied", () => {
    expect(filterContractEvents(events)).toHaveLength(events.length);
  });

  it("returns every event when an empty filter object is supplied", () => {
    expect(filterContractEvents(events, {})).toHaveLength(events.length);
  });

  it("preserves original references", () => {
    const result = filterContractEvents(events, {});
    result.forEach((evt, i) => expect(evt).toBe(events[i]));
  });
});

// ---------------------------------------------------------------------------
// 2. Single topic filter — exact string match
// ---------------------------------------------------------------------------

describe("single topic filter", () => {
  it("returns only events whose topics array contains the exact string", () => {
    const result = filterContractEvents(events, {
      topics: ["AAAADQAAAAZzd2FwAAA="],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.eventType).toBe("swap");
  });

  it("matches events that share a topic with another event type", () => {
    // Both swap and transfer contain the "token" topic pattern
    const result = filterContractEvents(events, {
      topics: ["AAAADQAAAAV0b2tlbgA="],
    });
    expect(result.map((e) => e.eventType)).toEqual(["swap", "transfer"]);
  });

  it("returns empty array when no event carries the topic", () => {
    const result = filterContractEvents(events, {
      topics: ["AAAADQAAAAdub19tYXRjaA=="],
    });
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Multiple topic patterns — any pattern matching any topic wins (OR)
// ---------------------------------------------------------------------------

describe("multiple topic patterns", () => {
  it("matches events where any topic matches any string pattern", () => {
    const result = filterContractEvents(events, {
      topics: ["AAAADQAAAAZzd2FwAAA=", "AAAADQAAAARtaW50"],
    });
    // swap and mint events each have one of these topics
    expect(result.map((e) => e.eventType)).toEqual(["swap", "mint"]);
  });

  it("matches events where any topic matches a RegExp pattern", () => {
    // Base64 strings beginning with "AAAADQAAAAV" correspond to "token"
    const result = filterContractEvents(events, {
      topics: [/^AAAADQAAAAV/],
    });
    expect(result.map((e) => e.eventType)).toEqual(["swap", "transfer"]);
  });

  it("supports a mix of string and RegExp patterns in one filter", () => {
    const result = filterContractEvents(events, {
      topics: ["AAAADQAAAARtaW50", /^AAAADQAAAANmZWU=/],
    });
    expect(result.map((e) => e.eventType)).toEqual(["mint", "fee_collected"]);
  });
});

// ---------------------------------------------------------------------------
// 4. contractId filter — exact string match only
// ---------------------------------------------------------------------------

describe("contractId filter", () => {
  it("returns only events from the specified contract", () => {
    const result = filterContractEvents(events, { contractId: CONTRACT_TOKEN });
    expect(result.every((e) => e.contractId === CONTRACT_TOKEN)).toBe(true);
    expect(result.map((e) => e.eventType)).toEqual(["transfer", "mint"]);
  });

  it("is case-sensitive and does not match a truncated contractId", () => {
    const result = filterContractEvents(events, {
      contractId: CONTRACT_AMM.slice(0, -1), // one char short
    });
    expect(result).toHaveLength(0);
  });

  it("returns all events for that contract regardless of event type", () => {
    const result = filterContractEvents(events, { contractId: CONTRACT_AMM });
    expect(result.map((e) => e.eventType)).toEqual([
      "swap",
      "liquidity_add",
      "fee_collected",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. Malformed / edge-case filters — graceful handling
// ---------------------------------------------------------------------------

describe("malformed and edge-case filters", () => {
  it("handles a topics array that is explicitly empty — no topic filtering", () => {
    const filter: ContractEventFilter = { topics: [] };
    expect(filterContractEvents(events, filter)).toHaveLength(events.length);
  });

  it("handles contractId set to undefined — no contractId filtering", () => {
    const filter: ContractEventFilter = { contractId: undefined };
    expect(filterContractEvents(events, filter)).toHaveLength(events.length);
  });

  it("handles events whose topics field is missing", () => {
    const bare: ContractEvent[] = [
      { id: "x", eventType: "noop", name: "noop" },
    ];
    // topic filter must not throw when topics is undefined on the event
    expect(() =>
      filterContractEvents(bare, { topics: ["AAAADQAAAAV0b2tlbgA="] }),
    ).not.toThrow();
    expect(filterContractEvents(bare, { topics: ["AAAADQAAAAV0b2tlbgA="] })).toHaveLength(0);
  });

  it("handles events whose topics contain null/undefined entries without throwing", () => {
    const noisy: ContractEvent[] = [
      {
        id: "y",
        eventType: "transfer",
        name: "transfer",
        topics: [null, undefined, "AAAADQAAAAh0cmFuc2Zlcg=="] as unknown as string[],
      },
    ];
    expect(() =>
      filterContractEvents(noisy, { topics: ["AAAADQAAAAh0cmFuc2Zlcg=="] }),
    ).not.toThrow();
    expect(filterContractEvents(noisy, { topics: ["AAAADQAAAAh0cmFuc2Zlcg=="] })).toHaveLength(1);
  });

  it("treats a filter with all undefined fields as a pass-all filter", () => {
    const filter: ContractEventFilter = {
      name: undefined,
      eventType: undefined,
      emitter: undefined,
      contractId: undefined,
      topics: undefined,
    };
    expect(filterContractEvents(events, filter)).toHaveLength(events.length);
  });
});

// ---------------------------------------------------------------------------
// 6. Combined AND + OR filter semantics
// ---------------------------------------------------------------------------

describe("combined AND + OR filter semantics", () => {
  it("andEventFilters: event must satisfy every sub-filter", () => {
    // Must be from CONTRACT_AMM AND have eventType "swap"
    const filter = andEventFilters(
      { contractId: CONTRACT_AMM },
      { eventType: "swap" },
    );
    const result = filterContractEvents(events, filter);
    expect(result).toHaveLength(1);
    expect(result[0]!.eventType).toBe("swap");
  });

  it("orEventFilters: event must satisfy at least one sub-filter", () => {
    // eventType mint OR eventType swap
    const filter = orEventFilters(
      { eventType: "mint" },
      { eventType: "swap" },
    );
    const result = filterContractEvents(events, filter);
    expect(result.map((e) => e.eventType)).toEqual(["swap", "mint"]);
  });

  it("nested and[] inside ContractEventFilter mirrors andEventFilters", () => {
    const filter: ContractEventFilter = {
      and: [{ contractId: CONTRACT_TOKEN }, { eventType: "transfer" }],
    };
    const result = filterContractEvents(events, filter);
    expect(result).toHaveLength(1);
    expect(result[0]!.eventType).toBe("transfer");
  });

  it("nested or[] inside ContractEventFilter mirrors orEventFilters", () => {
    const filter: ContractEventFilter = {
      or: [{ eventType: "liquidity_add" }, { eventType: "fee_collected" }],
    };
    const result = filterContractEvents(events, filter);
    expect(result.map((e) => e.eventType)).toEqual([
      "liquidity_add",
      "fee_collected",
    ]);
  });

  it("combines top-level fields with or[] for precise narrowing", () => {
    // contractId === CONTRACT_AMM AND (eventType === swap OR eventType === fee_collected)
    const filter: ContractEventFilter = {
      contractId: CONTRACT_AMM,
      or: [{ eventType: "swap" }, { eventType: "fee_collected" }],
    };
    const result = filterContractEvents(events, filter);
    expect(result.map((e) => e.eventType)).toEqual(["swap", "fee_collected"]);
  });

  it("andEventFilters composed with orEventFilters", () => {
    // (mint from CONTRACT_TOKEN) OR (swap from CONTRACT_AMM)
    const filter = orEventFilters(
      andEventFilters({ contractId: CONTRACT_TOKEN }, { eventType: "mint" }),
      andEventFilters({ contractId: CONTRACT_AMM }, { eventType: "swap" }),
    );
    const result = filterContractEvents(events, filter);
    expect(result.map((e) => e.eventType)).toEqual(["swap", "mint"]);
  });
});

// ---------------------------------------------------------------------------
// 7. Cursor / pagination boundary
// ---------------------------------------------------------------------------

describe("cursor and pagination boundary", () => {
  it("events without an id field are still returned by a matching filter", () => {
    // fee_collected event has no id — it should still pass a matching filter
    const result = filterContractEvents(events, { eventType: "fee_collected" });
    expect(result).toHaveLength(1);
    expect(result[0]!.eventType).toBe("fee_collected");
    expect(result[0]!.id).toBeUndefined();
  });

  it("can derive a cursor from the last event's id for the next page", () => {
    // Simulate receiving a page and reading the next cursor
    const page = filterContractEvents(events, { contractId: CONTRACT_AMM });
    const lastId = page.at(-1)?.id;
    // The last AMM event (fee_collected) has no id, so cursor is undefined
    expect(lastId).toBeUndefined();
  });

  it("cursor from a fully identified page points to the last paging_token", () => {
    // Events that all have ids — cursor should be the last id in the page
    const identifiedEvents = events.filter((e) => e.id !== undefined);
    const page = filterContractEvents(identifiedEvents, { contractId: CONTRACT_AMM });
    // swap and liquidity_add both have ids
    expect(page.map((e) => e.id)).toEqual([
      "0000000012884901888-0000000001",
      "0000000012884902144-0000000001",
    ]);
    const cursor = page.at(-1)?.id;
    expect(cursor).toBe("0000000012884902144-0000000001");
  });

  it("filtering with a ledger boundary returns only events from that ledger", () => {
    // Simulate cursor-based pagination by filtering on ledger number
    const result = filterContractEvents(events, (evt) => (evt.ledger ?? 0) >= 3000001);
    expect(result.map((e) => e.eventType)).toEqual([
      "liquidity_add",
      "mint",
      "fee_collected",
    ]);
  });
});
