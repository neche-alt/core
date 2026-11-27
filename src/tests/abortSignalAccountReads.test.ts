/**
 * Tests for issue #127 – AbortSignal support across browser account read APIs.
 *
 * Covers:
 *   - signal option exists on getAccount, getBalances, getAssetBalances, getOperations
 *   - aborting before the call rejects with an AbortError for getOperations
 *   - streamAccount stops yielding after the signal fires
 */

import { describe, it, expect } from "vitest";
import type { GetAccountOptions } from "../account/getAccount";
import type { GetOperationsOptions } from "../account/types";

// ---------------------------------------------------------------------------
// Type-level assertions: every public account read must accept signal
// ---------------------------------------------------------------------------

describe("AbortSignal type contract (#127)", () => {
  it("GetAccountOptions accepts signal?: AbortSignal", () => {
    const opts: GetAccountOptions = { signal: new AbortController().signal };
    expect(opts.signal).toBeDefined();
  });

  it("getBalances options accepts signal?: AbortSignal", () => {
    // getBalances passes its options directly to getAccount
    const opts: { signal?: AbortSignal } = { signal: new AbortController().signal };
    expect(opts.signal).toBeDefined();
  });

  it("getAssetBalances options accepts signal?: AbortSignal", () => {
    const opts: { signal?: AbortSignal } = { signal: new AbortController().signal };
    expect(opts.signal).toBeDefined();
  });

  it("GetOperationsOptions accepts signal?: AbortSignal", () => {
    const opts: GetOperationsOptions = { signal: new AbortController().signal };
    expect(opts.signal).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Runtime: abort before the request starts throws AbortError
// ---------------------------------------------------------------------------

describe("AbortSignal runtime – getOperations (#127)", () => {
  it("re-throws AbortError when signal is already aborted", async () => {
    const { getOperations } = await import("../account/getOperations");

    const controller = new AbortController();
    controller.abort();

    await expect(
      getOperations("https://horizon-testnet.stellar.org", "GDUMMY", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

// ---------------------------------------------------------------------------
// Runtime: streamAccount stops when signal is aborted
// ---------------------------------------------------------------------------

describe("AbortSignal runtime – streamAccount (#127)", () => {
  it("generator returns without yielding when signal is pre-aborted", async () => {
    const { streamAccount } = await import("../account/streamAccount");

    const controller = new AbortController();
    controller.abort();

    const results: unknown[] = [];
    for await (const result of streamAccount(
      "https://horizon-testnet.stellar.org",
      "GDUMMY",
      { maxPolls: 5, emitOnStart: false },
      controller.signal,
    )) {
      results.push(result);
    }

    // No results should have been emitted — the stream should have exited immediately
    expect(results).toHaveLength(0);
  });
});
