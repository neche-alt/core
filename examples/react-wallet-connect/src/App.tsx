/**
 * React wallet-connect example — UI layer (#react-wallet-connect, #104).
 *
 * Renders connect/disconnect, a balance list, a payment form, and — after the
 * transaction is built — a confirmation summary the user must review before
 * the wallet prompt opens (#105).
 *
 * Renders connect/disconnect, network identity badge, a balance list, and a
 * payment form. Mainnet actions require explicit confirmation.
 * All sorokit-core calls are in useSorokit.ts — this file only reads state
 * and calls the callbacks the hook exposes.
 *
 * User-facing strings are routed through src/shared/i18n.ts so translators
 * and extraction tooling can discover every message key in one place.
 */

import React, { useState, useEffect } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { createI18n } from "../../../src/shared/i18n";
import { useSorokit } from "./useSorokit";
import { NetworkBadge, MainnetConfirmDialog, useMainnetGuard } from "./NetworkBadge";
import type { NetworkType } from "../../../src/network/config";

// Active network — change to "mainnet" to see the mainnet confirmation guard.
const ACTIVE_NETWORK: NetworkType = "testnet";

// Initialise SWK once outside the component so it isn't recreated on renders.
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

export type ActivityState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string; retry: () => void }
  | { kind: "populated"; balances: AssetBalance[] };

export function deriveActivityState(
  loading: boolean,
  balances: AssetBalance[],
  error: string | null,
  connected: boolean,
  retry: () => void,
): ActivityState {
  if (loading && balances.length === 0) return { kind: "loading" };
  if (error) return { kind: "error", message: error, retry };
  if (connected && balances.length === 0 && !loading) return { kind: "empty" };
  if (balances.length > 0) return { kind: "populated", balances };
  return { kind: "loading" };
}

export default function App() {
  const {
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
  } = useSorokit(kit, ACTIVE_NETWORK);

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  // Mainnet guard — no-op on testnet/futurenet, requires confirmation on mainnet
  const guard = useMainnetGuard(ACTIVE_NETWORK);

  const isConnected = walletState?.connected && walletState.publicKey;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    // Gate mainnet sends behind an explicit confirmation prompt
    const confirmed = await guard.requestConfirmation();
    if (!confirmed) return;
    sendPayment({ destination, amount });
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>sorokit-core — React wallet</h1>
        {/* Network identity badge — always visible, updates on network switch */}
        <NetworkBadge network={ACTIVE_NETWORK} />
      </div>

      {/* Connection */}
      {!isConnected ? (
        <button onClick={connect} disabled={loading}>
          {loading ? i18n.t("ui.wallet.connecting") : i18n.t("ui.wallet.connect_button")}
        </button>
      ) : (
        <div>
          <p>
            <strong>{i18n.t("ui.wallet.connected_label")}</strong>{" "}
            <code style={{ wordBreak: "break-all" }}>{walletState.publicKey}</code>
          </p>
          <button onClick={disconnect} disabled={loading} style={{ marginRight: 8 }}>
            {i18n.t("ui.wallet.disconnect_button")}
          </button>
          <button onClick={refreshBalances} disabled={loading}>
            {i18n.t("ui.wallet.refresh_balances")}
          </button>
        </div>
      )}

      {/* Balances */}
      {balances.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>{i18n.t("ui.balances.heading")}</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{i18n.t("ui.balances.asset_column")}</th>
                <th style={{ textAlign: "right" }}>{i18n.t("ui.balances.balance_column")}</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={`${b.assetCode}-${b.assetIssuer ?? "native"}`}>
                  <td>{b.assetCode}</td>
                  {/* formatAmount uses Intl.NumberFormat for locale-aware rendering */}
                  <td style={{ textAlign: "right" }}>
                    {formatAmount(b.balance, b.assetCode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Confirmation summary — rendered after the transaction is built but
        before the wallet prompt opens. The user must click "Confirm & open
        wallet" to proceed, or "Cancel" to discard.
      */}
      {pendingSummary && (
        <div style={{ marginTop: "1.5rem" }}>
          <TransactionConfirmationSummary
            summary={pendingSummary}
            onConfirm={confirmPayment}
            onCancel={cancelPayment}
          />
        </div>
      )}

      {/* Payment form — only shown when connected and no pending confirmation */}
      {isConnected && !pendingSummary && (
        <form onSubmit={handleSend} style={{ marginTop: "1.5rem" }}>
          <h2>{i18n.t("ui.payment.heading")}</h2>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              {i18n.t("ui.payment.destination_label")}
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={i18n.t("ui.payment.destination_placeholder")}
                required
                style={{ display: "block", width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              {i18n.t("ui.payment.amount_label")}
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={i18n.t("ui.payment.amount_placeholder")}
                required
                style={{ display: "block", width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <button type="submit" disabled={loading || guard.isPending}>
            {loading ? "Sending…" : "Send"}
          </button>

          {/* Mainnet confirmation dialog — renders inline when guard.isPending */}
          {guard.isPending && (
            <MainnetConfirmDialog
              actionDescription={`Send ${amount} XLM to ${destination || "…"}`}
              onConfirm={guard.confirm}
              onCancel={guard.cancel}
            />
          )}
        </form>
      )}

      {/* Feedback — status colors respect high-contrast preferences */}
      {error && (
        <p
          role="alert"
          aria-label="Error"
          style={{
            marginTop: "1rem",
            color: resolveStatusColor("error", highContrast),
            background: highContrast ? "transparent" : "#fdecec",
            padding: "0.75rem",
            borderRadius: 6,
            border: highContrast ? "2px solid currentColor" : "none",
          }}
        >
          {error}
        </p>
      )}
      {status && !error && (
        <p
          role="status"
          aria-label="Status"
          style={{
            marginTop: "1rem",
            color: resolveStatusColor("neutral", highContrast),
            background: highContrast ? "transparent" : "#eef6ff",
            padding: "0.75rem",
            borderRadius: 6,
            border: highContrast ? "2px solid currentColor" : "none",
          }}
        >
          {status}
        </p>
      )}

      {/*
        Opt-in SDK diagnostics panel — debug only.
        Hidden in production: set show={process.env.NODE_ENV === "development"}
        or remove the prop to hide it entirely. Never shows secrets.
      */}
      <DiagnosticsPanel show={true} network="testnet" />
    </div>
  );
}
