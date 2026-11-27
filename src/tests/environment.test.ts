import { describe, it, expect } from "vitest";
import {
  isBrowser,
  isNode,
  getEnvironment,
  getRuntimeCapabilities,
  assertBrowserEnvironment,
  timers,
  crypto as envCrypto,
  getStorage,
  MemoryStorage,
} from "../shared/environment";
import { SorokitErrorCode } from "../shared/response";

describe("environment abstraction", () => {
  it("correctly identifies Node.js runtime environment", () => {
    expect(isNode()).toBe(true);
    expect(isBrowser()).toBe(false);
    expect(getEnvironment()).toBe("node");
  });

  it("reports accurate runtime capabilities in Node.js", () => {
    const caps = getRuntimeCapabilities();
    expect(caps.environment).toBe("node");
    expect(caps.hasFetch).toBe(typeof globalThis.fetch === "function");
    expect(caps.hasAbortController).toBe(typeof globalThis.AbortController !== "undefined");
    expect(caps.hasCrypto).toBe(true);
    expect(caps.hasStorage).toBe(true);
    // Node environment does not have WebAuthn PublicKeyCredential by default
    expect(caps.hasWebAuthn).toBe(false);
  });

  it("assertBrowserEnvironment fails predictably in Node.js", () => {
    const res = assertBrowserEnvironment("FreighterAdapter.connect");
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.WALLET_BROWSER_ONLY);
      expect(res.error.message).toContain("FreighterAdapter.connect requires a browser environment");
      expect(res.error.message).toContain('Running in "node"');
    }
  });

  it("provides functional timer abstraction", async () => {
    let fired = false;
    const id = timers.setTimeout(() => {
      fired = true;
    }, 10);
    expect(id).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(true);

    let cancelFired = false;
    const cancelId = timers.setTimeout(() => {
      cancelFired = true;
    }, 50);
    timers.clearTimeout(cancelId);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(cancelFired).toBe(false);
  });

  it("provides crypto abstraction for random bytes", () => {
    const bytes = envCrypto.randomBytes(16);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(16);
  });

  it("provides storage abstraction with memory fallback", () => {
    const storage = getStorage();
    expect(storage).toBeDefined();

    storage.setItem("test-key", "test-val");
    expect(storage.getItem("test-key")).toBe("test-val");
    storage.removeItem("test-key");
    expect(storage.getItem("test-key")).toBeNull();

    const memStorage = new MemoryStorage();
    memStorage.setItem("a", "1");
    expect(memStorage.getItem("a")).toBe("1");
    memStorage.clear();
    expect(memStorage.getItem("a")).toBeNull();
  });
});
