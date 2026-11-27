/**
 * Unit tests for the SSR config guard in src/shared/environment.ts
 *
 * Tests use globalThis manipulation to simulate browser vs. server contexts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isBrowser,
  isNode,
  isEdge,
  getRuntimeContext,
  assertNotBrowser,
  assertNotServer,
  assertConfigSafe,
  SERVER_ONLY_GLOBALS,
  BROWSER_ONLY_GLOBALS,
} from "./environment";

// ── Helpers ───────────────────────────────────────────────────────────────────

type G = Record<string, unknown>;

let savedWindow: unknown;
let savedDocument: unknown;
let savedProcess: unknown;
let savedFetch: unknown;

function saveGlobals() {
  savedWindow = (globalThis as G).window;
  savedDocument = (globalThis as G).document;
  savedProcess = (globalThis as G).process;
  savedFetch = (globalThis as G).fetch;
}

function restoreGlobals() {
  if (savedWindow === undefined) delete (globalThis as G).window;
  else (globalThis as G).window = savedWindow;

  if (savedDocument === undefined) delete (globalThis as G).document;
  else (globalThis as G).document = savedDocument;

  if (savedProcess === undefined) delete (globalThis as G).process;
  else (globalThis as G).process = savedProcess;

  if (savedFetch === undefined) delete (globalThis as G).fetch;
  else (globalThis as G).fetch = savedFetch;
}

function simulateBrowser() {
  (globalThis as G).window = { document: {} };
  (globalThis as G).document = {};
  delete (globalThis as G).process;
}

function simulateServer() {
  delete (globalThis as G).window;
  delete (globalThis as G).document;
  (globalThis as G).process = {
    versions: { node: "20.0.0" },
    env: {},
  };
}

function simulateEdge() {
  delete (globalThis as G).window;
  delete (globalThis as G).document;
  delete (globalThis as G).process;
  (globalThis as G).fetch = () => Promise.resolve(new Response());
}

// ── getRuntimeContext ─────────────────────────────────────────────────────────

describe("getRuntimeContext", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("returns 'browser' when window and document are present", () => {
    simulateBrowser();
    expect(getRuntimeContext()).toBe("browser");
  });

  it("returns 'server' when process.versions.node is present", () => {
    simulateServer();
    expect(getRuntimeContext()).toBe("server");
  });

  it("returns 'edge' when fetch is present but window and process are absent", () => {
    simulateEdge();
    expect(getRuntimeContext()).toBe("edge");
  });
});

// ── assertNotBrowser ──────────────────────────────────────────────────────────

describe("assertNotBrowser", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("returns error in browser context", () => {
    simulateBrowser();
    const result = assertNotBrowser("process");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("process");
      expect(result.error.message).toContain("browser");
      expect(result.error.code).toBe("INVALID_CONFIG");
    }
  });

  it("returns ok in server context", () => {
    simulateServer();
    expect(assertNotBrowser("process").status).toBe("ok");
  });

  it("returns ok in edge context", () => {
    simulateEdge();
    expect(assertNotBrowser("process").status).toBe("ok");
  });
});

// ── assertNotServer ───────────────────────────────────────────────────────────

describe("assertNotServer", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("returns error in Node.js (server) context", () => {
    simulateServer();
    const result = assertNotServer("window");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("window");
      expect(result.error.code).toBe("INVALID_CONFIG");
    }
  });

  it("returns error in edge context", () => {
    simulateEdge();
    const result = assertNotServer("localStorage");
    expect(result.status).toBe("error");
  });

  it("returns ok in browser context", () => {
    simulateBrowser();
    expect(assertNotServer("window").status).toBe("ok");
  });
});

// ── assertConfigSafe ──────────────────────────────────────────────────────────

describe("assertConfigSafe", () => {
  it("returns ok for a clean config in browser context", () => {
    const result = assertConfigSafe(
      { network: "testnet", horizonUrl: "https://horizon-testnet.stellar.org" },
      "browser",
    );
    expect(result.status).toBe("ok");
  });

  it("detects process.env.* interpolation in browser context", () => {
    const result = assertConfigSafe(
      { network: "testnet", horizonUrl: "process.env.HORIZON_URL" },
      "browser",
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("horizonUrl");
      expect(result.error.message).toContain("process.env.HORIZON_URL");
      expect(result.error.code).toBe("INVALID_CONFIG");
    }
  });

  it("detects __dirname in browser context", () => {
    const result = assertConfigSafe(
      { filePath: "__dirname/config.json" },
      "browser",
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("filePath");
    }
  });

  it("allows process.env.* references on the server", () => {
    // On server, these are intentional — no violation
    const result = assertConfigSafe(
      { horizonUrl: "process.env.HORIZON_URL" },
      "server",
    );
    expect(result.status).toBe("ok");
  });

  it("allows process.env.* references on the edge", () => {
    const result = assertConfigSafe(
      { horizonUrl: "process.env.HORIZON_URL" },
      "edge",
    );
    expect(result.status).toBe("ok");
  });

  it("ignores non-string config values", () => {
    const result = assertConfigSafe(
      { timeoutMs: 5000, enabled: true, tags: ["a", "b"] },
      "browser",
    );
    expect(result.status).toBe("ok");
  });
});

// ── Constant lists ────────────────────────────────────────────────────────────

describe("SERVER_ONLY_GLOBALS / BROWSER_ONLY_GLOBALS", () => {
  it("SERVER_ONLY_GLOBALS includes process and Buffer", () => {
    expect(SERVER_ONLY_GLOBALS).toContain("process");
    expect(SERVER_ONLY_GLOBALS).toContain("Buffer");
  });

  it("BROWSER_ONLY_GLOBALS includes window, document, localStorage", () => {
    expect(BROWSER_ONLY_GLOBALS).toContain("window");
    expect(BROWSER_ONLY_GLOBALS).toContain("document");
    expect(BROWSER_ONLY_GLOBALS).toContain("localStorage");
  });
});

// ── isBrowser / isNode / isEdge remain correct ───────────────────────────────

describe("environment detection helpers", () => {
  beforeEach(saveGlobals);
  afterEach(restoreGlobals);

  it("isBrowser returns true with window + document", () => {
    simulateBrowser();
    expect(isBrowser()).toBe(true);
  });

  it("isNode returns true with process.versions.node", () => {
    simulateServer();
    expect(isNode()).toBe(true);
  });

  it("isEdge returns true with fetch but no window/process", () => {
    simulateEdge();
    expect(isEdge()).toBe(true);
  });
});
