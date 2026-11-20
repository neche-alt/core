/**
 * React wallet-connect example — custom hook (#react-wallet-connect).
 *
 * All sorokit-core calls live here: wallet connection, balance fetching, and
 * payment submission. The hook returns plain values and callbacks so App.tsx
 * stays purely presentational and easy to swap for another UI framework.
 *
 * In your own app the SDK imports below become:
 *   import { createSorokitClient, FreighterAdapter, ... } from "sorokit-core";
 */

import { useState, useEffect, useCallback } from "react";
import { createSorokitClient } from "../../../src/client/createSorokitClient";
import { FreighterAdapter } from "../../../src/wallet/adapters/freighter";
import {
  reconnectWithConsent,
  type ReconnectConsentContext,
} from "../../../src/wallet/reconnectWithConsent";
import { saveSession, clearSession } from "../../../src/wallet/sessionPersistence";
import type { SorokitClient } from "../../../src/client/createSorokitClient";
import type { WalletState, SWKInstance } from "../../../src/wallet/types";
import type { AssetBalance } from "../../../src/account/types";
import type { NetworkType } from "../../../src/network/config";

export interface PaymentParams {
  destination: string;
  amount: string;
  /** Asset code — defaults to native XLM */
  assetCode?: string;
  assetIssuer?: string;
}

export interface UseSorokitReturn {
  /** null until the client is ready */
  client: SorokitClient | null;
  walletState: WalletState | null;
  balances: AssetBalance[];
  /** True while any async op is in flight */
  loading: boolean;
  /** Last error message to show in the UI */
  error: string | null;
  /** Last success message */
  status: string | null;
  /**
   * Pending reconnect consent context — present when a reload detected a
   * persisted session. The UI should show this to the user and call either
   * approveReconnect() or rejectReconnect().
   */
  pendingReconnect: ReconnectConsentContext | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  sendPayment: (params: PaymentParams) => Promise<void>;
  /** Approve the pending reconnect and re-establish the wallet connection. */
  approveReconnect: () => Promise<void>;
  /** Reject the pending reconnect, clearing the session and returning to idle. */
  rejectReconnect: () => void;
}

export function useSorokit(
  swkInstance: SWKInstance,
  network: NetworkType = "testnet",
): UseSorokitReturn {
  const [client, setClient] = useState<SorokitClient | null>(null);
  const [adapter] = useState(() => new FreighterAdapter(swkInstance));
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingReconnect, setPendingReconnect] =
    useState<ReconnectConsentContext | null>(null);
  // Store the approve callback set by the reconnect flow so approveReconnect()
  // can resolve the prompt's promise.
  const [reconnectResolve, setReconnectResolve] =
    useState<((approved: boolean) => void) | null>(null);

  // Build the client once on mount. createSorokitClient is synchronous and
  // cheap — it just validates config and resolves the network endpoints.
  useEffect(() => {
    const result = createSorokitClient({ network });
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    setClient(result.data);
  }, [network]);

  // ── Reconnect-on-reload flow ────────────────────────────────────────────────
  // On mount, attempt to restore a persisted session. If one exists, surface
  // the consent prompt data via `pendingReconnect` so the UI can show it.
  // The actual reconnect only happens when the user calls approveReconnect().
  useEffect(() => {
    let cancelled = false;

    async function tryReconnect() {
      const outcome = await reconnectWithConsent(
        adapter,
        (ctx) =>
          new Promise<boolean>((resolve) => {
            if (cancelled) {
              resolve(false);
              return;
            }
            // Surface the context to the UI and store the resolver so the
            // approve/reject callbacks can resolve this promise.
            setPendingReconnect(ctx);
            setReconnectResolve(() => resolve);
          }),
      );

      if (cancelled) return;

      if (outcome.outcome === "connected") {
        setWalletState(outcome.state);
        setStatus("Session restored");
        setPendingReconnect(null);
        if (outcome.state.publicKey) {
          const balResult = await (
            await (async () => {
              // client may not be initialised yet — wait a tick
              return client;
            })()
          )?.account.getBalances(outcome.state.publicKey);
          if (balResult?.status === "ok") setBalances(balResult.data);
        }
      } else if (outcome.outcome === "rejected") {
        setPendingReconnect(null);
        setStatus(null);
      }
      // "no_session" and "error" are silent — no banner needed.
    }

    tryReconnect().catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run only on mount (adapter is stable across renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  const connect = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);

    const result = await client.wallet.connect(adapter);
    if (result.status === "error") {
      setError(result.error.message);
    } else {
      setWalletState(result.data);
      setStatus("Wallet connected");

      // Persist the session so a reload can offer a reconnect prompt.
      await saveSession({
        publicKey: result.data.publicKey ?? "",
        walletType: result.data.walletType ?? undefined,
        network,
      });

      // Fetch balances right after connecting so the UI populates immediately.
      if (result.data.publicKey) {
        const balResult = await client.account.getBalances(result.data.publicKey);
        if (balResult.status === "ok") setBalances(balResult.data);
      }
    }
    setLoading(false);
  }, [client, adapter, network]);

  const disconnect = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const result = await client.wallet.disconnect(adapter);
    if (result.status === "ok") {
      setWalletState(null);
      setBalances([]);
      setStatus("Wallet disconnected");
      // Clear persisted session so reload does not offer a stale reconnect.
      clearSession();
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [client, adapter]);

  const refreshBalances = useCallback(async () => {
    if (!client || !walletState?.publicKey) return;
    setLoading(true);
    setError(null);

    const result = await client.account.getBalances(walletState.publicKey);
    if (result.status === "ok") {
      setBalances(result.data);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [client, walletState]);

  const sendPayment = useCallback(
    async (params: PaymentParams) => {
      if (!client || !walletState?.publicKey) {
        setError("Connect a wallet first");
        return;
      }
      setLoading(true);
      setError(null);
      setStatus(null);

      // 1. Build the unsigned transaction XDR
      const built = await client.transaction.buildPayment(walletState.publicKey, {
        destination: params.destination,
        amount: params.amount,
        ...(params.assetCode && params.assetCode !== "XLM"
          ? { assetCode: params.assetCode, assetIssuer: params.assetIssuer }
          : {}),
      });
      if (built.status === "error") {
        setError(built.error.message);
        setLoading(false);
        return;
      }

      // 2. Prompt the wallet to sign
      const signed = await client.wallet.signTransaction(adapter, {
        transactionXdr: built.data,
        networkPassphrase: client.networkConfig.networkPassphrase,
      });
      if (signed.status === "error") {
        // WALLET_SIGN_REJECTED means the user clicked "Reject" — not a crash.
        setError(signed.error.message);
        setLoading(false);
        return;
      }

      // 3. Submit to Horizon
      const submitted = await client.transaction.submit(signed.data);
      if (submitted.status === "error") {
        setError(submitted.error.message);
      } else {
        setStatus(`Payment sent — tx ${submitted.data.hash}`);
        // Refresh so the balance reflects the outgoing amount.
        const balResult = await client.account.getBalances(walletState.publicKey);
        if (balResult.status === "ok") setBalances(balResult.data);
      }
      setLoading(false);
    },
    [client, adapter, walletState],
  );

  return {
    client,
    walletState,
    balances,
    loading,
    error,
    status,
    pendingReconnect,
    connect,
    disconnect,
    refreshBalances,
    sendPayment,
    approveReconnect: useCallback(async () => {
      if (reconnectResolve) {
        reconnectResolve(true);
        setReconnectResolve(null);
      }
    }, [reconnectResolve]),
    rejectReconnect: useCallback(() => {
      if (reconnectResolve) {
        reconnectResolve(false);
        setReconnectResolve(null);
        setPendingReconnect(null);
      }
    }, [reconnectResolve]),
  };
}
