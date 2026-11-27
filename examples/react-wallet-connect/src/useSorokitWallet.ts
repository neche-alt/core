/**
 * useSorokitWallet — React hook for wallet connection state machine (#128).
 *
 * Implements a seven-state machine backed by WalletStatusTracker:
 *
 *   idle ──► discovering ──► connecting ──► connected ──► signing
 *                                 │                           │
 *                                 ▼                           ▼
 *                               error                    connected
 *                                 │
 *                                 ▼
 *                           disconnected
 *
 * All sorokit-core calls are funnelled through WalletStatusTracker so the
 * hook reacts to adapter events rather than polling.  The tracker subscription
 * is cleaned up on unmount so there are no listener leaks.
 *
 * Usage:
 *   const { status, address, connect, disconnect, sign } = useSorokitWallet(adapter);
 *
 * To reuse this hook in another React app:
 *   1. Install sorokit-core and @creit.tech/stellar-wallets-kit.
 *   2. Create a WalletAdapter (e.g. FreighterAdapter) and pass it to the hook.
 *   3. Import and mount the hook; it handles the full lifecycle.
 *   See the README for a copy-paste example.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { WalletStatusTracker } from "../../../src/wallet/walletStatusTracker";
import type { WalletStatus } from "../../../src/wallet/walletStatusTracker";
import type { WalletAdapter, SignTransactionInput } from "../../../src/wallet/adapters/interface";
import type { SorokitResult } from "../../../src/shared/response";

// ── State machine ─────────────────────────────────────────────────────────────

/**
 * The seven observable states of the wallet lifecycle.
 *
 * | State         | Meaning                                              |
 * |---------------|------------------------------------------------------|
 * | idle          | Hook mounted, no connection attempt started          |
 * | discovering   | Checking adapter availability                        |
 * | connecting    | Waiting for the wallet extension to respond          |
 * | connected     | Public key resolved, wallet ready                    |
 * | signing       | A sign request is in flight                          |
 * | error         | Last operation failed; `errorMessage` holds the reason |
 * | disconnected  | Wallet was explicitly disconnected                   |
 */
export type WalletHookStatus =
  | "idle"
  | "discovering"
  | "connecting"
  | "connected"
  | "signing"
  | "error"
  | "disconnected";

export interface UseSorokitWalletReturn {
  /** Current state-machine state. */
  status: WalletHookStatus;
  /** Resolved public key when status === 'connected', null otherwise. */
  address: string | null;
  /** Error message when status === 'error', null otherwise. */
  errorMessage: string | null;
  /** Start a connection attempt.  No-op when already connecting/connected. */
  connect: () => Promise<void>;
  /** Disconnect and clean up the status tracker subscription. */
  disconnect: () => Promise<void>;
  /**
   * Sign a transaction XDR.  Only valid when status === 'connected'.
   * Returns the signed XDR on success or an error result.
   */
  sign: (input: SignTransactionInput) => Promise<SorokitResult<string>>;
}

// ── Mapping from WalletStatusTracker events to hook states ───────────────────

function trackerStatusToHookStatus(ts: WalletStatus["status"]): WalletHookStatus {
  switch (ts) {
    case "connecting":
    case "authenticating":
      return "connecting";
    case "connected":
      return "connected";
    case "failed":
    case "error":
      return "error";
    case "disconnected":
      return "disconnected";
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSorokitWallet(adapter: WalletAdapter): UseSorokitWalletReturn {
  const [status, setStatus] = useState<WalletHookStatus>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep one tracker per adapter instance for the lifetime of the hook.
  const trackerRef = useRef<WalletStatusTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = new WalletStatusTracker();
  }

  // Subscribe to tracker events and map them onto hook state.
  useEffect(() => {
    const tracker = trackerRef.current!;
    const unsubscribe = tracker.subscribe((ts: WalletStatus) => {
      const next = trackerStatusToHookStatus(ts.status);
      setStatus(next);
      setAddress(ts.publicKey);
      setErrorMessage(ts.error);
    });
    // Cleanup: remove the listener so SPAs don't leak subscriptions.
    return () => {
      unsubscribe();
    };
  }, []); // tracker ref is stable — empty deps is correct

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;
    const tracker = trackerRef.current!;
    // discovering → connecting transitions are emitted by the tracker itself.
    setStatus("discovering");
    await tracker.connect(adapter);
  }, [adapter, status]);

  const disconnect = useCallback(async () => {
    const tracker = trackerRef.current!;
    await tracker.disconnect(adapter);
    // tracker.disconnect resets status to disconnected and emits to listeners,
    // but we also set local state directly for deterministic test expectations.
    setStatus("disconnected");
    setAddress(null);
    setErrorMessage(null);
  }, [adapter]);

  const sign = useCallback(
    async (input: SignTransactionInput): Promise<SorokitResult<string>> => {
      setStatus("signing");
      try {
        const result = await adapter.signTransaction(input);
        // Restore to connected whether sign succeeded or failed.
        setStatus(result.status === "ok" ? "connected" : "error");
        if (result.status === "error") {
          setErrorMessage(result.error.message);
        }
        return result;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        setStatus("error");
        setErrorMessage(msg);
        // Return a consistent error shape by re-using the response helpers.
        const { err, SorokitErrorCode } = await import("../../../src/shared/response");
        return err(SorokitErrorCode.WALLET_SIGN_REJECTED, msg, cause);
      }
    },
    [adapter],
  );

  return { status, address, errorMessage, connect, disconnect, sign };
}
