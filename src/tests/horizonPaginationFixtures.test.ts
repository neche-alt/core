import { describe, it, expect, vi, beforeEach } from "vitest";
import * as serverFactory from "../shared/serverFactory";
import {
  exportTransactionHistory,
  HORIZON_PAGE_LIMIT,
  HORIZON_MAX_PAGES,
} from "../transaction/exportTransactionHistory";
import { queryTransactionHistory } from "../transaction/queryTransactionHistory";

/**
 * Deterministic fixtures and bounded-iteration coverage for Horizon
 * pagination (#84).
 *
 * The auto-paginating history functions (`exportTransactionHistory`,
 * `queryTransactionHistory`) walk Horizon pages by advancing a cursor to the
 * last record's `paging_token`. These fixtures script the page sequence a real
 * Horizon endpoint would return and assert that traversal terminates for every
 * link/cursor shape — including ones (empty, malformed-link, repeated-cursor)
 * that would otherwise lose data or loop forever.
 */

const horizonUrl = "https://horizon-testnet.stellar.org";
const publicKey = "GTESTPAGINATIONSOURCE";

/** A deterministic Horizon transaction record. `envelope_xdr` is intentionally
 *  invalid so `extractOperationsFromXdr` falls back to a single `transaction`
 *  operation per record (one exported row per record). */
function makeRecord(index: number, pagingToken: string): Record<string, unknown> {
  return {
    hash: `h${index}`,
    created_at: "2026-01-15T10:00:00Z",
    ledger_attr: 1000 + index,
    successful: true,
    fee_charged: 100,
    source_account: publicKey,
    memo: `m${index}`,
    envelope_xdr: "AAAAA...",
    paging_token: pagingToken,
  };
}

/** Build `count` records with distinct, ordered `paging_token`s. */
function makeRecords(
  count: number,
  startIndex: number,
  tokenPrefix: string,
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, k) => {
    const i = startIndex + k;
    return makeRecord(i, `${tokenPrefix}${i}`);
  });
}

/**
 * Build a full page whose last record's `paging_token` is fixed at
 * `stuckToken`. Repeating this page never advances the cursor, which is the
 * repeated-cursor regression case.
 */
function makeStuckPage(
  count: number,
  stuckToken: string,
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, k) => {
    const isLast = k === count - 1;
    return makeRecord(10_000 + k, isLast ? stuckToken : `pre${k}`);
  });
}

interface ScriptedServer {
  callMock: ReturnType<typeof vi.fn>;
  /** Cursors passed to `builder.cursor(...)`, in call order. */
  cursors: string[];
}

/**
 * Mock `createHorizonServer` so each `builder.call()` returns the next scripted
 * page in order, then `fallback` (default empty) once the scripts are
 * exhausted. Exhausting to an empty page keeps the tests from hanging if a
 * bound is ever removed. Cursors passed to `builder.cursor(...)` are captured.
 */
function createScriptedServer(
  pages: Record<string, unknown>[][],
  fallback: Record<string, unknown>[] = [],
): ScriptedServer {
  const cursors: string[] = [];
  let callIndex = 0;
  const callMock = vi.fn(() => {
    const records = callIndex < pages.length ? pages[callIndex] : fallback;
    callIndex += 1;
    return { records };
  });
  const builder = {
    forAccount: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    cursor: vi.fn((c: string) => {
      cursors.push(c);
      return builder;
    }),
    call: callMock,
  };
  vi.spyOn(serverFactory, "createHorizonServer").mockReturnValue({
    transactions: vi.fn().mockReturnValue(builder),
  } as any);
  return { callMock, cursors };
}

describe("pagination constants", () => {
  it("exposes a sane page limit and a bounded max-pages safety cap", () => {
    expect(HORIZON_PAGE_LIMIT).toBe(200);
    expect(HORIZON_MAX_PAGES).toBeGreaterThan(0);
    expect(Number.isFinite(HORIZON_MAX_PAGES)).toBe(true);
  });
});

describe("exportTransactionHistory — Horizon pagination fixtures (#84)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("walks first → middle → final pages and aggregates every record", async () => {
    const first = makeRecords(HORIZON_PAGE_LIMIT, 0, "pt"); // pt0..pt199 (full)
    const middle = makeRecords(HORIZON_PAGE_LIMIT, 200, "pt"); // pt200..pt399 (full)
    const final = makeRecords(50, 400, "pt"); // pt400..pt449 (partial final)
    const { callMock, cursors } = createScriptedServer([first, middle, final]);

    const result = await exportTransactionHistory(horizonUrl, publicKey, {
      format: "json",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.parse(result.data)).toHaveLength(HORIZON_PAGE_LIMIT * 2 + 50);
    }
    // Exactly three page fetches: first, middle, then the partial final page.
    expect(callMock).toHaveBeenCalledTimes(3);
    // The cursor advanced across the two full pages; the partial final page
    // sets no cursor because traversal stops there.
    expect(cursors).toEqual(["pt199", "pt399"]);
  });

  it("stops at an empty first page and exports nothing", async () => {
    const { callMock, cursors } = createScriptedServer([[]]);

    const result = await exportTransactionHistory(horizonUrl, publicKey, {
      format: "json",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.parse(result.data)).toEqual([]);
    }
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(cursors).toEqual([]);
  });

  it("does not follow a malformed next link (missing paging_token on a full page)", async () => {
    const broken = makeRecords(HORIZON_PAGE_LIMIT, 0, "pt");
    // The last record carries no usable cursor — a broken "next" link.
    broken[broken.length - 1].paging_token = "";
    const { callMock, cursors } = createScriptedServer([broken, []]);

    const result = await exportTransactionHistory(horizonUrl, publicKey, {
      format: "json",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // The fetched page's records are preserved (no data loss); traversal
      // just refuses to follow the broken link.
      expect(JSON.parse(result.data)).toHaveLength(HORIZON_PAGE_LIMIT);
    }
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(cursors).toEqual([]);
  });

  it("bounds iteration on a repeated cursor and does not loop forever", async () => {
    const stuck = makeStuckPage(HORIZON_PAGE_LIMIT, "stuck");
    // Repeated full pages whose last paging_token never advances.
    const { callMock, cursors } = createScriptedServer(
      [stuck, stuck, stuck, stuck, stuck],
      [],
    );

    const result = await exportTransactionHistory(horizonUrl, publicKey, {
      format: "json",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Two pages are fetched before the repeated-cursor guard fires; without
      // the guard this sequence would loop until the scripts exhausted.
      expect(JSON.parse(result.data)).toHaveLength(HORIZON_PAGE_LIMIT * 2);
    }
    expect(callMock).toHaveBeenCalledTimes(2);
    expect(cursors).toEqual(["stuck"]);
  });
});

describe("queryTransactionHistory — Horizon pagination fixtures (#84)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("walks first → final pages and aggregates records across pages", async () => {
    const first = makeRecords(HORIZON_PAGE_LIMIT, 0, "pt"); // full
    const final = makeRecords(50, 200, "pt"); // partial final
    const { callMock } = createScriptedServer([first, final]);

    // Request enough records to require a second page fetch.
    const result = await queryTransactionHistory(horizonUrl, publicKey, {
      perPage: HORIZON_PAGE_LIMIT,
      page: 2,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.total).toBe(HORIZON_PAGE_LIMIT + 50);
    }
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("bounds iteration on a repeated cursor when no records match the filter", async () => {
    const stuck = makeStuckPage(HORIZON_PAGE_LIMIT, "stuck");
    const { callMock } = createScriptedServer(
      [stuck, stuck, stuck, stuck, stuck],
      [],
    );

    // A type filter that matches nothing keeps the accumulated set empty, so
    // the recordsNeeded bound alone could never stop a repeated cursor.
    const result = await queryTransactionHistory(horizonUrl, publicKey, {
      perPage: 20,
      page: 1,
      type: "nonexistent_type",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.transactions).toHaveLength(0);
    }
    // Bounded: the repeated-cursor guard stops traversal after two fetches.
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("stops at an empty first page", async () => {
    const { callMock } = createScriptedServer([[]]);

    const result = await queryTransactionHistory(horizonUrl, publicKey);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.transactions).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
    expect(callMock).toHaveBeenCalledTimes(1);
  });
});
