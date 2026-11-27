/**
 * React wallet-connect example — custom hook (#react-wallet-connect).
 *
 * All sorokit-core calls live here: wallet connection, balance fetching, and
 * payment submission. The hook returns plain values and callbacks so App.tsx
 * stays purely presentational and easy to swap for another UI framework.
 *
 * In your own app the SDK imports below become:
 *   import { createSorokitClient, FreighterAdapter, ... } from "sorokit-core";
 *
 * ## Confirmation summary (#105)
 *
 * `sendPayment` no longer goes straight to the wallet prompt. Instead it
 * populates `pendingSummary` with the network, destination, operation
 * description, asset, and fee estimate. The UI renders
 * `TransactionConfirmationSummary` and waits for the user to click
 * "Confirm & open wallet" before the hook calls `signTransaction`.
 * If the user clicks Cancel the pending payment is discarded without opening
 * the wallet extension.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createSorokitClient } from "../../../src/client/createSorokitClient";
import { FreighterAdapter } from "../../../src/wallet/adapters/freighter";
import { walletErrorMessage } from "../../../src/wallet/rejectionMessaging";
import type { SorokitClient } from "../../../src/client/createSorokitClient";
import type { WalletState, SWKInstance } from "../../../src/wallet/types";
import type { AssetBalance } from "../../../src/account/types";
import type { NetworkType } from "../../../src/network/config";
import type { TransactionSummary } from "./TransactionConfirmationSummary";

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
   * Non-null when a payment has been built and is awaiting user confirmation.
   * Render `TransactionConfirmationSummary` with this value, then call
   * `confirmPayment` or `cancelPayment`.
   */
  pendingSummary: TransactionSummary | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  /**
   * Build the transaction and produce a confirmation summary.
   * The wallet is NOT opened until the user calls `confirmPayment`.
   */
  sendPayment: (params: PaymentParams) => Promise<void>;
  /** Sign and submit the pending transaction after the user confirms. */
  confirmPayment: () => Promise<void>;
  /** Discard the pending transaction without opening the wallet. */
  cancelPayment: () => void;
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
  const [pendingSummary, setPendingSummary] = useState<TransactionSummary | null>(null);

  // Holds the signed XDR that is ready to submit once the user confirms.
  const pendingXdrRef = useRef<string | null>(null);

  // Build the client once on mount.
  useEffect(() => {
    const result = createSorokitClient({ network });
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    setClient(result.data);
  }, [network]);

  const connect = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);

    const result = await client.wallet.connect(adapter);
    if (result.status === "error") {
      setError(walletErrorMessage(result.error));
    } else {
      setWalletState(result.data);
      setStatus("Wallet connected");

      if (result.data.publicKey) {
        const balResult = await client.account.getBalances(result.data.publicKey);
        if (balResult.status === "ok") setBalances(balResult.data);
      }
    }
    setLoading(false);
  }, [client, adapter]);

  const disconnect = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const result = await client.wallet.disconnect(adapter);
    if (result.status === "ok") {
      setWalletState(null);
      setBalances([]);
      setStatus("Wallet disconnected");
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

  /**
   * Build the transaction and populate `pendingSummary`.
   * Does NOT open the wallet — waits for `confirmPayment`.
   */
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
        // Show an actionable message; never suggest automatic resubmission.
        setError(walletErrorMessage(signed.error));
        setLoading(false);
        return;
      }

      // 3. Store the unsigned XDR for use in confirmPayment.
      pendingXdrRef.current = built.data;

      // 4. Populate the confirmation summary — this triggers the UI to render
      //    TransactionConfirmationSummary instead of proceeding to signing.
      const assetLabel =
        params.assetCode && params.assetCode !== "XLM"
          ? params.assetCode
          : "XLM";

      setPendingSummary({
        network,
        destination: params.destination,
        operationSummary: `Send ${params.amount} ${assetLabel} to ${params.destination.slice(0, 8)}…`,
        asset: assetLabel,
        amount: params.amount,
        feeStroops,
      });

      setLoading(false);
    },
    [client, adapter, walletState, network],
  );

  /**
   * Sign and submit the pending transaction.
   * Called after the user clicks "Confirm & open wallet" in the summary panel.
   */
  const confirmPayment = useCallback(async () => {
    if (!client || !walletState?.publicKey || !pendingXdrRef.current) return;
    setLoading(true);
    setError(null);
    setPendingSummary(null);

    const xdr = pendingXdrRef.current;
    pendingXdrRef.current = null;

    // 1. Sign
    const signed = await client.wallet.signTransaction(adapter, {
      transactionXdr: xdr,
      networkPassphrase: client.networkConfig.networkPassphrase,
    });
    if (signed.status === "error") {
      setError(signed.error.message);
      setLoading(false);
      return;
    }

    // 2. Submit
    const submitted = await client.transaction.submit(signed.data);
    if (submitted.status === "error") {
      setError(submitted.error.message);
    } else {
      setStatus(`Payment sent — tx ${submitted.data.hash}`);
      const balResult = await client.account.getBalances(walletState.publicKey);
      if (balResult.status === "ok") setBalances(balResult.data);
    }
    setLoading(false);
  }, [client, adapter, walletState]);

  /** Discard the pending payment without opening the wallet. */
  const cancelPayment = useCallback(() => {
    pendingXdrRef.current = null;
    setPendingSummary(null);
    setStatus("Transaction cancelled.");
  }, []);

  return {
    client,
    walletState,
    balances,
    loading,
    error,
    status,
    pendingSummary,
    connect,
    disconnect,
    refreshBalances,
    sendPayment,
    confirmPayment,
    cancelPayment,
  };
}
