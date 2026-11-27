/**
 * Unified runtime environment abstraction layer for browser and Node.js.
 * Centralizes runtime detection, timers, crypto, and storage.
 */

import { ok, err, SorokitErrorCode } from "./response";
import type { SorokitResult } from "./response";

export type RuntimeEnvironment = "browser" | "node" | "unknown";

/**
 * Detailed capability profile for the active runtime environment.
 */
export interface RuntimeCapabilities {
  environment: RuntimeEnvironment;
  hasFetch: boolean;
  hasAbortController: boolean;
  hasCrypto: boolean;
  hasStorage: boolean;
  hasWebAuthn: boolean;
}

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
 * Get the current runtime environment type.
 */
export function getEnvironment(): RuntimeEnvironment {
  if (isBrowser()) return "browser";
  if (isNode()) return "node";
  return "unknown";
}

/**
 * Detect runtime capabilities available in the current environment.
 */
export function getRuntimeCapabilities(): RuntimeCapabilities {
  const env = getEnvironment();
  const hasFetch = typeof globalThis.fetch === "function";
  const hasAbortController = typeof globalThis.AbortController !== "undefined";
  let hasCrypto = false;
  try {
    const bytes = crypto.randomBytes(4);
    hasCrypto = bytes.length === 4;
  } catch {
    hasCrypto = false;
  }
  const storage = getStorage();
  const hasStorage = storage !== null && typeof storage.getItem === "function";
  const hasWebAuthn =
    typeof window !== "undefined" &&
    typeof (window as any).PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined";

  return {
    environment: env,
    hasFetch,
    hasAbortController,
    hasCrypto,
    hasStorage,
    hasWebAuthn,
  };
}

/**
 * Asserts that the current runtime environment is a browser.
 * Returns ok(undefined) in a browser, or err(WALLET_BROWSER_ONLY) with an actionable message.
 */
export function assertBrowserEnvironment(operationName: string): SorokitResult<void> {
  if (!isBrowser()) {
    return err(
      SorokitErrorCode.WALLET_BROWSER_ONLY,
      `${operationName} requires a browser environment. Running in "${getEnvironment()}" is not supported for browser-only operations.`,
    );
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
