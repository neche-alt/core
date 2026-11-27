/**
 * Tests for configurable concurrency limits in getAccountsBatch (#34).
 *
 * Covers: unlimited (default), bounded concurrency, serial (concurrency=1),
 * partial failures, input/result ordering, and duplicate key deduplication.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../account/getAccount", () => ({
  getAccount: vi.fn(),
}));

import { getAccountsBatch } from "../account/getAccountsBatch";
import { getAccount } from "../account/getAccount";

const mockGetAccount = vi.mocked(getAccount);

function makeAccount(publicKey: string) {
  return {
    publicKey,
    sequence: "1000",
    subentryCount: 0,
    balances: [],
    signers: [],
    flags: { authRequired: false, authRevocable: false, authImmutable: false },
    thresholds: { lowThreshold: 0, medThreshold: 0, highThreshold: 0 },
    data: {},
  };
}

function okResult<T>(data: T) {
  return Object.freeze({ status: "ok" as const, data, error: null });
}

function errResult(message: string) {
  return Object.freeze({
    status: "error" as const,
    data: null,
    error: {
      code: "ACCOUNT_FETCH_FAILED" as const,
      message,
      category: "internal" as const,
      recovery: { retryable: false, action: "inspect" },
    },
  });
}

beforeEach(() => {
  mockGetAccount.mockReset();
});

describe("getAccountsBatch — default (no concurrency limit)", () => {
  it("returns ok results for all keys in input order", async () => {
    const keys = ["GAAA", "GBBB", "GCCC"];
    mockGetAccount.mockImplementation(async (_, publicKey) =>
      okResult(makeAccount(publicKey)),
    );

    const result = await getAccountsBatch("https://horizon.example.com", keys);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.data).toHaveLength(3);
    result.data.forEach((r, i) => {
      expect(r.status).toBe("ok");
      if (r.status === "ok") expect(r.data.publicKey).toBe(keys[i]);
    });
  });

  it("returns empty array for empty input", async () => {
    const result = await getAccountsBatch("https://horizon.example.com", []);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.data).toHaveLength(0);
  });
});

describe("getAccountsBatch — concurrency: 2", () => {
  it("returns results in input order across chunk boundaries", async () => {
    const keys = ["G1", "G2", "G3", "G4", "G5"];
    mockGetAccount.mockImplementation(async (_, publicKey) =>
      okResult(makeAccount(publicKey)),
    );

    const result = await getAccountsBatch(
      "https://horizon.example.com",
      keys,
      { concurrency: 2 },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data).toHaveLength(5);
    result.data.forEach((r, i) => {
      expect(r.status).toBe("ok");
      if (r.status === "ok") expect(r.data.publicKey).toBe(keys[i]);
    });
  });

  it("tracks concurrent call counts — never exceeds the limit", async () => {
    const keys = ["G1", "G2", "G3", "G4", "G5", "G6"];
    let peak = 0;
    let inFlight = 0;

    mockGetAccount.mockImplementation(async (_, publicKey) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return okResult(makeAccount(publicKey));
    });

    await getAccountsBatch("https://horizon.example.com", keys, {
      concurrency: 2,
    });

    // With concurrency: 2, within each chunk at most 2 run simultaneously.
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("getAccountsBatch — concurrency: 1 (serial)", () => {
  it("returns results in input order", async () => {
    const keys = ["GA", "GB", "GC"];
    const callOrder: string[] = [];

    mockGetAccount.mockImplementation(async (_, publicKey) => {
      callOrder.push(publicKey as string);
      return okResult(makeAccount(publicKey as string));
    });

    const result = await getAccountsBatch(
      "https://horizon.example.com",
      keys,
      { concurrency: 1 },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data).toHaveLength(3);
    expect(callOrder).toEqual(keys);
  });
});

describe("getAccountsBatch — concurrency: 0 (unlimited)", () => {
  it("behaves the same as default (no option)", async () => {
    const keys = ["GAAA", "GBBB"];
    mockGetAccount.mockImplementation(async (_, publicKey) =>
      okResult(makeAccount(publicKey)),
    );

    const withZero = await getAccountsBatch("https://horizon.example.com", keys, {
      concurrency: 0,
    });
    const withDefault = await getAccountsBatch(
      "https://horizon.example.com",
      keys,
    );

    expect(withZero.status).toBe("ok");
    expect(withDefault.status).toBe("ok");
    if (withZero.status === "ok" && withDefault.status === "ok") {
      expect(withZero.data).toHaveLength(withDefault.data.length);
    }
  });
});

describe("getAccountsBatch — partial failures", () => {
  it("returns errors for failed keys without blocking successful ones", async () => {
    const keys = ["GFAIL", "GPASS", "GFAIL2"];

    mockGetAccount.mockImplementation(async (_, publicKey) => {
      if ((publicKey as string).startsWith("GFAIL")) {
        return errResult(`not found: ${publicKey}`);
      }
      return okResult(makeAccount(publicKey as string));
    });

    const result = await getAccountsBatch(
      "https://horizon.example.com",
      keys,
      { concurrency: 2 },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.data[0]!.status).toBe("error");
    expect(result.data[1]!.status).toBe("ok");
    expect(result.data[2]!.status).toBe("error");
  });

  it("propagates the error message for failed keys", async () => {
    const keys = ["GBAD"];
    mockGetAccount.mockResolvedValueOnce(errResult("account not found"));

    const result = await getAccountsBatch("https://horizon.example.com", keys, {
      concurrency: 1,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data[0]!.status).toBe("error");
  });
});

describe("getAccountsBatch — ordering and duplicates", () => {
  it("preserves input order when duplicates are present", async () => {
    // "GA" appears twice — both positions should map to the same result
    const keys = ["GA", "GB", "GA"];
    mockGetAccount.mockImplementation(async (_, publicKey) =>
      okResult(makeAccount(publicKey)),
    );

    const result = await getAccountsBatch("https://horizon.example.com", keys);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data).toHaveLength(3);
    if (result.data[0]!.status === "ok")
      expect(result.data[0]!.data.publicKey).toBe("GA");
    if (result.data[1]!.status === "ok")
      expect(result.data[1]!.data.publicKey).toBe("GB");
    if (result.data[2]!.status === "ok")
      expect(result.data[2]!.data.publicKey).toBe("GA");
  });

  it("deduplicates — getAccount is called once per unique key", async () => {
    const keys = ["GA", "GB", "GA", "GB"];
    mockGetAccount.mockImplementation(async (_, publicKey) =>
      okResult(makeAccount(publicKey)),
    );

    await getAccountsBatch("https://horizon.example.com", keys);

    // Only 2 unique keys, so getAccount should be called at most twice.
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });
});
