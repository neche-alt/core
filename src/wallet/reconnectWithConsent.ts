/**
 * Reconnect-on-reload with explicit consent (#135)
 *
 * On page reload, if a persisted session exists the app must ask the user
 * before re-establishing the wallet connection. This module orchestrates
 * that flow:
 *
 *   1. Load the persisted session via sessionPersistence.ts
 *   2. Read device-trust level via deviceTrust.ts
 *   3. Invoke the caller's consent prompt with session details + trust level
 *   4a. User approves  → connect via connect.ts, return the new WalletState
 *   4b. User rejects   → clear the session via clearSession, return idle
 *
 * The consent prompt is entirely caller-supplied so this module has no DOM
 * or React dependency and is testable with mockClient.ts.
 */

import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import {
  restoreSession,
  clearSession,
  isSessionValid,
} from "./sessionPersistence";
import type { SessionData, SessionPersistenceOptions } from "./sessionPersistence";
import {
  generateDeviceFingerprint,
  evaluateDeviceTrust,
} from "./deviceTrust";
import type { TrustEvaluation } from "./deviceTrust";
import { connectWallet } from "./connect";
import { disconnectWallet } from "./disconnect";
import type { WalletAdapter, WalletState } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Data passed to the caller's consent prompt so the UI can present meaningful
 * context to the user before they decide whether to reconnect.
 */
export interface ReconnectConsentContext {
  /** The public key stored in the persisted session. */
  publicKey: string;
  /** Wallet type string (e.g. "FREIGHTER"), if recorded in the session. */
  walletType?: string;
  /** Network the session was recorded on (e.g. "testnet"). */
  network?: string;
  /** ISO timestamp of when the original connection was made. */
  connectedAt: string;
  /** Trust evaluation for the current device from deviceTrust.ts. */
  trustEvaluation: TrustEvaluation;
}

/**
 * Caller-supplied prompt function.
 *
 * Returns `true` when the user approves reconnection, `false` when they reject.
 * May be async (e.g. a modal dialog).
 */
export type ReconnectConsentPrompt = (
  context: ReconnectConsentContext,
) => boolean | Promise<boolean>;

export interface ReconnectWithConsentOptions {
  /** Options forwarded to sessionPersistence (storage, TTL, etc.). */
  session?: SessionPersistenceOptions;
  /**
   * Trust history to pass to evaluateDeviceTrust.
   * In a real app this would be loaded from storage alongside the session.
   * Defaults to an empty array (first-time device).
   */
  trustHistory?: Parameters<typeof evaluateDeviceTrust>[1];
  /**
   * Options forwarded to connectWallet (timeout, retries, etc.).
   */
  connect?: Parameters<typeof connectWallet>[2];
}

/** Discriminated result for the reconnect flow. */
export type ReconnectOutcome =
  | { outcome: "connected"; state: WalletState }
  | { outcome: "rejected" }
  | { outcome: "no_session" }
  | { outcome: "error"; error: string };

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Attempt to reconnect the wallet on reload, gating the reconnection behind
 * an explicit user consent prompt.
 *
 * @param adapter  - The wallet adapter to reconnect through.
 * @param prompt   - Caller-supplied async function that shows the consent UI.
 * @param options  - Optional session persistence and connect options.
 *
 * @returns A `ReconnectOutcome` describing what happened.
 *
 * @example
 * const outcome = await reconnectWithConsent(
 *   freighterAdapter,
 *   async (ctx) => {
 *     return window.confirm(
 *       `Reconnect ${ctx.publicKey.slice(0,8)}…?\n` +
 *       `Trust: ${ctx.trustEvaluation.reason} (${ctx.trustEvaluation.score}/100)`
 *     );
 *   },
 * );
 * if (outcome.outcome === "connected") setWalletState(outcome.state);
 * if (outcome.outcome === "rejected")  setWalletState(null);
 */
export async function reconnectWithConsent(
  adapter: WalletAdapter,
  prompt: ReconnectConsentPrompt,
  options?: ReconnectWithConsentOptions,
): Promise<ReconnectOutcome> {
  // 1. Try to restore a persisted session
  const sessionResult = await restoreSession(options?.session);
  if (sessionResult.status === "error" || !isSessionValid(sessionResult.data)) {
    return { outcome: "no_session" };
  }
  const session: SessionData = sessionResult.data;

  // 2. Evaluate device trust
  const fingerprint = generateDeviceFingerprint();
  const trustEvaluation = evaluateDeviceTrust(
    fingerprint,
    options?.trustHistory ?? [],
  );

  // 3. Build consent context and invoke the caller's prompt
  const context: ReconnectConsentContext = {
    publicKey: session.publicKey,
    ...(session.walletType !== undefined ? { walletType: String(session.walletType) } : {}),
    ...(session.network !== undefined ? { network: session.network } : {}),
    connectedAt: new Date(session.connectedAt).toISOString(),
    trustEvaluation,
  };

  let approved: boolean;
  try {
    approved = await prompt(context);
  } catch (cause) {
    // A thrown prompt is treated as rejection to avoid accidental reconnect.
    clearSession(options?.session);
    return {
      outcome: "error",
      error:
        cause instanceof Error
          ? cause.message
          : "Consent prompt threw an unexpected error",
    };
  }

  // 4b. Rejected → clear session and return idle
  if (!approved) {
    clearSession(options?.session);
    return { outcome: "rejected" };
  }

  // 4a. Approved → reconnect via connect.ts
  const connectResult = await connectWallet(adapter, undefined, options?.connect);
  if (connectResult.status === "error") {
    // Clear the session so the next reload doesn't loop — the wallet may be
    // unavailable (locked, extension removed, etc.).
    clearSession(options?.session);
    return { outcome: "error", error: connectResult.error.message };
  }

  return { outcome: "connected", state: connectResult.data };
}

/**
 * Convenience wrapper for the rejection path: disconnect the adapter (if
 * available) and clear the persisted session.
 *
 * Call this when the user dismisses the consent prompt without an adapter
 * still connected from a previous session.
 */
export async function clearAndDisconnect(
  adapter: WalletAdapter,
  sessionOptions?: SessionPersistenceOptions,
): Promise<SorokitResult<void>> {
  clearSession(sessionOptions);
  if (!adapter.isAvailable()) {
    // Adapter not available — session already cleared, that is enough.
    return ok(undefined);
  }
  const disconnectResult = await disconnectWallet(adapter);
  if (disconnectResult.status === "error") {
    return err(
      SorokitErrorCode.WALLET_CONNECT_FAILED,
      `Session cleared but adapter disconnect failed: ${disconnectResult.error.message}`,
      disconnectResult.error,
    );
  }
  return ok(undefined);
}
