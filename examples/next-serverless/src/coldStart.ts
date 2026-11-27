/**
 * Cold-start-aware serverless helpers (#35).
 *
 * Serverless containers are recycled between deployments and after periods of
 * inactivity. Each fresh container pays a one-time initialisation cost (the
 * "cold start"). Warm invocations re-use the same process, so module-level
 * state persists across requests within the same container lifetime.
 *
 * This module demonstrates three patterns that reduce cold-start impact:
 *
 *  1. Lazy singleton client — created once on first use, reused on subsequent
 *     warm invocations. Avoids re-paying SDK initialisation on every request.
 *
 *  2. Per-request deadline — AbortController with a timeout guards each
 *     outbound call. Prevents a stalled upstream from holding the Lambda open
 *     past its billing window or Vercel function timeout.
 *
 *  3. Safe cleanup — SIGTERM handler resets the singleton so a graceful
 *     shutdown does not leave stale state if the container is reused.
 *
 * In your own app the SDK imports below become:
 *   import { createSorokitClient } from "sorokit-core";
 */

import { createSorokitClient } from "../../../src/client/createSorokitClient";
import type { SorokitClient } from "../../../src/client/createSorokitClient";
import type { NetworkType } from "../../../src/network/config";
import { serverSendPayment } from "./sorokitServer";
import type { SendPaymentParams } from "./sorokitServer";
import type { SorokitResult } from "../../../src/shared/response";
import type { TransactionResult } from "../../../src/transaction/types";

// ── Lazy singleton client ─────────────────────────────────────────────────────
//
// Module-level variable — survives across warm invocations in the same
// container. null until the first request arrives, so the cold-start cost is
// paid only once per container lifetime.

let _client: SorokitClient | null = null;

/**
 * Return the shared client, creating it on first call.
 *
 * Network is read from the STELLAR_NETWORK environment variable; defaults to
 * "testnet". A misconfigured network throws immediately so the deployment
 * error surfaces in logs before the first request is served.
 */
export function lazyGetClient(): SorokitClient {
  if (_client) return _client;

  const network = (process.env["STELLAR_NETWORK"] ?? "testnet") as NetworkType;
  const result = createSorokitClient({ network });

  if (result.status === "error") {
    throw new Error(
      `sorokit-core client init failed: ${result.error.message}`,
    );
  }

  _client = result.data;
  return _client;
}

/**
 * Reset the singleton — sets the module-level reference to null so the next
 * call to `lazyGetClient` creates a fresh instance.
 *
 * Call this in tests (via `beforeEach`) and in graceful shutdown handlers.
 */
export function resetClient(): void {
  _client = null;
}

// ── Per-request deadline ──────────────────────────────────────────────────────

export interface Deadline {
  /** AbortSignal to pass to any fetch / SDK call that accepts one. */
  signal: AbortSignal;
  /**
   * Cancel the deadline timer and abort the signal immediately.
   * Always call this after the operation completes to free the timer handle.
   */
  cancel: () => void;
}

/**
 * Create a deadline that fires after `timeoutMs` milliseconds.
 *
 * ```ts
 * const { signal, cancel } = withDeadline(8_000);
 * try {
 *   const result = await client.account.getAccountsBatch(keys, { signal });
 *   return result;
 * } finally {
 *   cancel(); // always release the timer
 * }
 * ```
 */
export function withDeadline(timeoutMs: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      // Abort in case the caller calls cancel() before the timer fires.
      // AbortController.abort() is idempotent — safe to call multiple times.
      controller.abort();
    },
  };
}

// ── Cold-start payment helper ─────────────────────────────────────────────────

export interface ColdStartPaymentParams extends SendPaymentParams {
  /**
   * Milliseconds before the payment operation is aborted.
   * Defaults to 10 000 ms (10 seconds).
   */
  deadlineMs?: number;
}

/**
 * Send a payment using the lazy singleton client and a per-request deadline.
 *
 * Uses `lazyGetClient()` — no client is constructed on warm invocations.
 * Always cancels the deadline timer when the operation completes, whether
 * it succeeds or fails.
 */
export async function coldStartSendPayment(
  params: ColdStartPaymentParams,
): Promise<SorokitResult<TransactionResult>> {
  const client = lazyGetClient();
  const { deadlineMs = 10_000, ...paymentParams } = params;
  const { signal, cancel } = withDeadline(deadlineMs);

  try {
    return await serverSendPayment(client, { ...paymentParams, signal });
  } finally {
    cancel();
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let _shutdownRegistered = false;

/**
 * Register a SIGTERM handler that resets the singleton client.
 *
 * Call this once at module load time (or at the top of your handler file).
 * Guarded against double-registration — safe to call multiple times.
 *
 * ```ts
 * import { registerShutdown } from "./coldStart";
 * registerShutdown();
 * ```
 */
export function registerShutdown(): void {
  if (_shutdownRegistered) return;
  _shutdownRegistered = true;

  process.on("SIGTERM", () => {
    console.log("[sorokit] SIGTERM received — resetting client singleton.");
    resetClient();
    _shutdownRegistered = false;
  });
}

export default {
  lazyGetClient,
  resetClient,
  withDeadline,
  coldStartSendPayment,
  registerShutdown,
};
