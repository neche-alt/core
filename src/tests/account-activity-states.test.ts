import { describe, it, expect, vi } from "vitest";
import { deriveActivityState } from "../../examples/react-wallet-connect/src/App";
import type { AssetBalance } from "../account/types";

const mockBalance: AssetBalance = {
  assetCode: "XLM",
  assetIssuer: null,
  balance: "100.0",
  assetType: "native",
  balanceFloat: 100.0,
};

describe("deriveActivityState", () => {
  const noOp = vi.fn();

  it("returns loading when loading=true and no balances", () => {
    const state = deriveActivityState(true, [], null, true, noOp);
    expect(state.kind).toBe("loading");
  });

  it("returns empty when connected, not loading, no balances, no error", () => {
    const state = deriveActivityState(false, [], null, true, noOp);
    expect(state.kind).toBe("empty");
  });

  it("returns error state when error is set", () => {
    const retry = vi.fn();
    const state = deriveActivityState(false, [], "Network error", true, retry);
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.message).toBe("Network error");
      state.retry();
      expect(retry).toHaveBeenCalledOnce();
    }
  });

  it("returns populated when balances exist", () => {
    const state = deriveActivityState(false, [mockBalance], null, true, noOp);
    expect(state.kind).toBe("populated");
    if (state.kind === "populated") {
      expect(state.balances).toHaveLength(1);
      expect(state.balances[0].assetCode).toBe("XLM");
    }
  });

  it("returns populated even when loading if balances already exist", () => {
    const state = deriveActivityState(true, [mockBalance], null, true, noOp);
    expect(state.kind).toBe("populated");
  });
});
