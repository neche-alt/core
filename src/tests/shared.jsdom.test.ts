// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isBrowser } from "../shared/utils";
import {
  getRuntimeCapabilities,
  assertBrowserEnvironment,
} from "../shared/environment";

describe("isBrowser in simulated browser environment", () => {
  it("returns true when window is defined", () => {
    expect(isBrowser()).toBe(true);
  });

  it("reports browser environment in getRuntimeCapabilities", () => {
    const caps = getRuntimeCapabilities();
    expect(caps.environment).toBe("browser");
    expect(caps.hasFetch).toBe(typeof globalThis.fetch === "function");
    expect(caps.hasStorage).toBe(true);
  });

  it("assertBrowserEnvironment succeeds in browser environment", () => {
    const result = assertBrowserEnvironment("WebWallet.connect");
    expect(result.status).toBe("ok");
  });
});
