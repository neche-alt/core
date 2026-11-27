/**
 * Browser compatibility guard.
 *
 * Probes the Web APIs that sorokit-core requires at runtime and returns a
 * structured report.  Call checkBrowserCompatibility() early in browser-only
 * code paths (e.g. wallet discovery, WebAuthn, streaming) to surface missing
 * APIs as a clear BrowserCompatibilityError instead of a cryptic TypeError
 * deep in the call stack.
 *
 * Required APIs
 * ─────────────
 * - AbortController  — request cancellation (fetch, streaming)
 * - crypto.subtle    — WebAuthn signature verification
 * - fetch            — Horizon / RPC calls
 * - BroadcastChannel — cross-tab wallet events
 */

import { err, ok, SorokitErrorCode } from "./response";
import type { SorokitResult } from "./response";

/** Identifiers for each probed Web API. */
export type RequiredWebAPI =
  | "AbortController"
  | "crypto.subtle"
  | "fetch"
  | "BroadcastChannel";

/** Result of probing a single Web API. */
export interface APIProbeResult {
  api: RequiredWebAPI;
  available: boolean;
}

/** Full compatibility report returned by checkBrowserCompatibility(). */
export interface BrowserCompatibilityReport {
  /** true only when every required API is available. */
  compatible: boolean;
  /** Per-API probe results. */
  probes: APIProbeResult[];
  /** Convenience list of APIs that are unavailable. */
  missing: RequiredWebAPI[];
}

/**
 * Probe a single Web API.
 *
 * Uses typeof guards so the function is safe to call in Node.js, edge
 * runtimes, and restricted browser contexts.
 */
function probeAPI(api: RequiredWebAPI): APIProbeResult {
  let available = false;

  switch (api) {
    case "AbortController":
      available =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as Record<string, unknown>).AbortController ===
          "function";
      break;

    case "crypto.subtle":
      available =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as Record<string, unknown>).crypto === "object" &&
        (globalThis as Record<string, unknown>).crypto !== null &&
        typeof (
          ((globalThis as Record<string, unknown>).crypto as Record<string, unknown>)
            ?.subtle
        ) === "object";
      break;

    case "fetch":
      available =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as Record<string, unknown>).fetch === "function";
      break;

    case "BroadcastChannel":
      available =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as Record<string, unknown>).BroadcastChannel ===
          "function";
      break;
  }

  return { api, available };
}

/**
 * Probe all required Web APIs and return a compatibility report.
 *
 * This function never throws.
 */
export function checkBrowserCompatibility(): BrowserCompatibilityReport {
  const apis: RequiredWebAPI[] = [
    "AbortController",
    "crypto.subtle",
    "fetch",
    "BroadcastChannel",
  ];

  const probes = apis.map(probeAPI);
  const missing = probes
    .filter((p) => !p.available)
    .map((p) => p.api);

  return {
    compatible: missing.length === 0,
    probes,
    missing,
  };
}

/**
 * Assert browser compatibility and return a SorokitResult.
 *
 * Returns ok(report) when all APIs are present.
 * Returns err(BROWSER_INCOMPATIBLE, …) naming every missing API when any
 * are absent, so callers surface a clear error instead of a later TypeError.
 *
 * @example
 * const compat = assertBrowserCompatibility();
 * if (compat.status === "error") {
 *   console.error(compat.error.message);
 *   return compat;
 * }
 */
export function assertBrowserCompatibility(): SorokitResult<BrowserCompatibilityReport> {
  const report = checkBrowserCompatibility();

  if (!report.compatible) {
    const list = report.missing.join(", ");
    return err(
      SorokitErrorCode.WALLET_BROWSER_ONLY,
      `Browser environment is missing required Web APIs: ${list}. ` +
        `sorokit-core requires AbortController, crypto.subtle, fetch, and ` +
        `BroadcastChannel. Upgrade your browser or run this code in a ` +
        `supported environment.`,
    );
  }

  return ok(report);
}

/**
 * Convenience guard for browser-only code paths.
 *
 * Returns a SorokitResult error (naming the missing APIs) when the current
 * environment lacks one or more required Web APIs; returns ok(undefined)
 * when everything is present.
 *
 * Usage:
 * ```ts
 * const guard = requireBrowserAPIs(["AbortController", "fetch"]);
 * if (guard.status === "error") return guard;
 * ```
 */
export function requireBrowserAPIs(
  apis: RequiredWebAPI[],
): SorokitResult<void> {
  const missing = apis
    .map(probeAPI)
    .filter((p) => !p.available)
    .map((p) => p.api);

  if (missing.length > 0) {
    const list = missing.join(", ");
    return err(
      SorokitErrorCode.WALLET_BROWSER_ONLY,
      `Missing required Web APIs: ${list}.`,
    );
  }

  return ok(undefined);
}
