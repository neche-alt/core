/**
 * Unified runtime environment abstraction layer for browser and Node.js.
 * Centralizes runtime detection, timers, crypto, and storage.
 */

import { err, ok, SorokitErrorCode } from "./response";
import type { SorokitResult } from "./response";

export type RuntimeEnvironment = "browser" | "node" | "unknown";

/**
 * Finer-grained runtime context classification used by the SSR config guard.
 *
 * - "browser"  — real browser (window + document present)
 * - "server"   — Node.js or Deno without window
 * - "edge"     — edge runtime (no window, no process.versions.node, but fetch present)
 * - "unknown"  — none of the above
 */
export type RuntimeContext = "browser" | "server" | "edge" | "unknown";

/**
 * Globals that must only be read on the server.
 * Reading these in a browser build leaks secrets to the client.
 */
export const SERVER_ONLY_GLOBALS: readonly string[] = [
  "process",
  "__dirname",
  "__filename",
  "Buffer",
] as const;

/**
 * Globals that exist only in the browser.
 * Accessing these on the server results in a ReferenceError.
 */
export const BROWSER_ONLY_GLOBALS: readonly string[] = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "location",
] as const;

/**
 * Safely detect whether the current runtime environment is a browser.
 */
export function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.document !== "undefined"
  );
}

/**
 * Safely detect whether the current runtime environment is Node.js.
 */
export function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions !== undefined &&
    process.versions.node !== undefined
  );
}

/**
 * Detect edge runtimes (Cloudflare Workers, Vercel Edge, etc.) — no window,
 * no process.versions.node, but global fetch is present.
 */
export function isEdge(): boolean {
  return (
    !isBrowser() &&
    !isNode() &&
    typeof (globalThis as Record<string, unknown>).fetch === "function"
  );
}

/**
 * Get the current runtime environment type (coarse, backward-compatible).
 */
export function getEnvironment(): RuntimeEnvironment {
  if (isBrowser()) return "browser";
  if (isNode()) return "node";
  return "unknown";
}

/**
 * Get the fine-grained runtime context used by the SSR config guard.
 */
export function getRuntimeContext(): RuntimeContext {
  if (isBrowser()) return "browser";
  if (isNode()) return "server";
  if (isEdge()) return "edge";
  return "unknown";
}

/**
 * Assert that a server-only global is not being accessed in a browser context.
 *
 * Returns err(INVALID_CONFIG, …) when called from a browser environment.
 * Returns ok(undefined) in server or edge contexts.
 *
 * @example
 * const guard = assertNotBrowser("process");
 * if (guard.status === "error") return guard;
 * const val = process.env.SECRET_KEY;
 */
export function assertNotBrowser(globalName: string): SorokitResult<void> {
  if (isBrowser()) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Server-only global "${globalName}" must not be accessed in a browser context. ` +
        `Move this configuration to a server-side initializer or use environment-safe ` +
        `config inputs instead.`,
    );
  }
  return ok(undefined);
}

/**
 * Assert that a browser-only global is not being accessed in a server context.
 *
 * Returns err(INVALID_CONFIG, …) when called from a Node.js / edge context.
 * Returns ok(undefined) in browser contexts.
 *
 * @example
 * const guard = assertNotServer("window");
 * if (guard.status === "error") return guard;
 * const origin = window.location.origin;
 */
export function assertNotServer(globalName: string): SorokitResult<void> {
  if (isNode() || isEdge()) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Browser-only global "${globalName}" must not be accessed in a server or edge context. ` +
        `Use environment-safe alternatives (e.g. explicit URL config) instead.`,
    );
  }
  return ok(undefined);
}

/**
 * Validate that the provided config object does not contain references to
 * server-only globals when running in a browser context.
 *
 * Checks string values in the config for patterns that suggest they were
 * derived from process.env, __dirname, or similar server-only sources
 * (e.g. a value that is literally the string "process.env.SECRET").
 *
 * This is a best-effort surface check — it cannot prevent all leakage but
 * will catch accidental template-literal interpolation of server globals.
 */
export function assertConfigSafe(
  config: Record<string, unknown>,
  context: RuntimeContext = getRuntimeContext(),
): SorokitResult<void> {
  if (context !== "browser") {
    // Only meaningful to guard in browser context
    return ok(undefined);
  }

  const serverGlobalPattern = /\bprocess\.env\.\w+|\b__dirname\b|\b__filename\b/;

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && serverGlobalPattern.test(value)) {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        `Config field "${key}" contains a server-only global reference ("${value}"). ` +
          `Do not interpolate process.env or __dirname into client-side config. ` +
          `Pass explicit values or use a build-time replacement instead.`,
      );
    }
  }

  return ok(undefined);
}

/**
 * Unified Timers Interface
 */
export interface EnvironmentTimers {
  setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): any;
  clearTimeout(timeoutId: any): void;
  setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): any;
  clearInterval(intervalId: any): void;
}

export const timers: EnvironmentTimers = {
  setTimeout: (cb, ms, ...args) => globalThis.setTimeout(cb, ms, ...args),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (cb, ms, ...args) => globalThis.setInterval(cb, ms, ...args),
  clearInterval: (id) => globalThis.clearInterval(id),
};

/**
 * Unified Crypto Interface
 */
export interface EnvironmentCrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomBytes(length: number): Uint8Array;
}

export const crypto: EnvironmentCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T {
    if (
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.getRandomValues === "function"
    ) {
      return globalThis.crypto.getRandomValues(array);
    }
    if (isNode()) {
      try {
        const nodeCrypto = require("crypto");
        if (nodeCrypto.webcrypto && typeof nodeCrypto.webcrypto.getRandomValues === "function") {
          return nodeCrypto.webcrypto.getRandomValues(array);
        }
        if (typeof nodeCrypto.randomBytes === "function") {
          const bytes: Buffer = nodeCrypto.randomBytes(array.byteLength);
          const uint8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
          uint8.set(bytes);
          return array;
        }
      } catch {
        // Fallback
      }
    }
    throw new Error("No secure random value generator available in this environment.");
  },
  randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    return this.getRandomValues(bytes);
  },
};

/**
 * Key-Value Storage Interface
 */
export interface EnvironmentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export class MemoryStorage implements EnvironmentStorage {
  private _store = new Map<string, string>();

  getItem(key: string): string | null {
    return this._store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this._store.set(key, String(value));
  }
  removeItem(key: string): void {
    this._store.delete(key);
  }
  clear(): void {
    this._store.clear();
  }
}

/**
 * Retrieve the active storage abstraction (localStorage if supported, else memory storage fallback).
 */
export function getStorage(): EnvironmentStorage {
  if (isBrowser()) {
    try {
      if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
        return window.localStorage;
      }
    } catch {
      // In sandboxed iframe localStorage may throw
    }
  }
  return new MemoryStorage();
}
