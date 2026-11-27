/**
 * DevTools bridge (#617)
 *
 * A `LogTransport` that forwards every structured log record sorokit-core
 * already produces (see `withLogging` in `logger.ts`) to a `window` event,
 * so a browser extension can observe SDK operations in real time without
 * the SDK needing any extension-specific code beyond this transport.
 *
 * This only forwards what already flows through the logger: operation
 * start/success/error for wallet, account, transaction, and Soroban calls,
 * each carrying whatever metadata the call site passed to `withLogging`
 * (public keys, transaction hashes, error codes, etc.). Registering this
 * transport does not by itself enable logging — the client's `logLevel`
 * (or `debug: true`) still gates whether `withLogging` calls the logger at
 * all, same as any other transport.
 *
 * Dual-instance guard (#130):
 * When the same application bundle loads both the ESM and CJS builds of
 * sorokit-core (e.g. a dependency uses `require()` while the app uses
 * `import`), two module instances are created and each registers its own
 * logger, connection pool, and event listeners.  This file installs a
 * shared symbol on `globalThis` so the second instance can detect the
 * duplication and emit a warning via the devtools bridge.
 */

import { registerLogTransport } from "./logger";
import type { LogTransport, StructuredLogRecord } from "./logger";

// ─── Dual-instance detection (#130) ──────────────────────────────────────────

/**
 * Symbol key placed on `globalThis` by the first SDK instance to load.
 * Public so type tests can assert it exists on the global surface.
 */
export const SOROKIT_INSTANCE_SYMBOL: unique symbol = Symbol.for(
  "sorokit-core/instance",
);

/** Metadata stored under the shared symbol. */
export interface SorokitInstanceMeta {
  version: string;
  loadedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var [SOROKIT_INSTANCE_SYMBOL]: SorokitInstanceMeta | undefined;
}

/**
 * Register this module instance on `globalThis`.
 *
 * Returns `true` when this is the first instance (normal case).
 * Returns `false` and emits a console warning when a second instance is
 * detected — which means the ESM and CJS builds are both loaded.
 *
 * Called automatically when this module is imported for the first time.
 */
export function registerSdkInstance(version = "unknown"): boolean {
  if (typeof globalThis === "undefined") return true;

  const existing = (globalThis as Record<symbol, unknown>)[
    SOROKIT_INSTANCE_SYMBOL
  ] as SorokitInstanceMeta | undefined;

  if (existing) {
    // Second instance detected — warn in every environment.
    const message =
      `[sorokit-core] Duplicate SDK instance detected. ` +
      `Both the ESM (import) and CJS (require) builds are loaded in the same ` +
      `runtime. Singletons such as the connection pool and wallet-status tracker ` +
      `will not be shared, which can cause split event listeners and doubled ` +
      `network connections. Configure your bundler to deduplicate sorokit-core ` +
      `(see docs/browser-compatibility.md).`;

    if (typeof console !== "undefined") {
      console.warn(message);
    }

    // Also surface through the devtools bridge if a window event bus exists.
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent("sorokit:duplicate-instance", {
          detail: { existing, message },
        }),
      );
    }

    return false;
  }

  (globalThis as Record<symbol, unknown>)[SOROKIT_INSTANCE_SYMBOL] = {
    version,
    loadedAt: Date.now(),
  };
  return true;
}

// Register this instance on module load.
registerSdkInstance();

// ─── DevTools log bridge ──────────────────────────────────────────────────────

/** Name of the `window` CustomEvent dispatched for every forwarded log record. */
export const SOROKIT_DEVTOOLS_EVENT = "sorokit:devtools";

export interface SorokitDevtoolsEventDetail {
  /** Monotonically increasing per-process sequence number, for ordering in the panel. */
  seq: number;
  record: StructuredLogRecord;
}

let sequence = 0;

function createDevtoolsTransport(): LogTransport {
  return {
    write(record: StructuredLogRecord): void {
      if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
        return;
      }
      sequence += 1;
      const detail: SorokitDevtoolsEventDetail = { seq: sequence, record };
      window.dispatchEvent(new CustomEvent<SorokitDevtoolsEventDetail>(SOROKIT_DEVTOOLS_EVENT, { detail }));
    },
  };
}

/**
 * Register the DevTools bridge transport. Call this once, before creating a
 * client with `debug: true` (or an explicit non-"off" `logLevel`), so the
 * sorokit-core browser extension can pick up operations as they happen.
 *
 * No-ops outside a browser environment (`window` undefined), so it's safe
 * to call unconditionally from an app's entry point.
 *
 * @returns A function that unregisters the transport.
 *
 * @example
 * import { enableDevtoolsBridge } from "sorokit-core/shared";
 * import { createSorokitClient } from "sorokit-core";
 *
 * if (process.env.NODE_ENV !== "production") {
 *   enableDevtoolsBridge();
 * }
 * const client = createSorokitClient({ network: "testnet", debug: true });
 */
export function enableDevtoolsBridge(): () => void {
  return registerLogTransport(createDevtoolsTransport());
}
