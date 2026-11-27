/**
 * React wallet-connect example — UI layer (#react-wallet-connect, #104).
 *
 * Renders connect/disconnect, a balance list, and a payment form.
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
import { ui, formatAmount } from "./i18n";

// A single i18n instance for the app.  Swap the locale to load a different
// language; add new locales via withTranslations().
const i18n = createI18n({ locale: "en" });

// Initialise SWK once outside the component so it isn't recreated on renders.
// In a real app this typically lives in a context provider or module-level singleton.
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
    pendingReconnect,
    connect,
    disconnect,
    refreshBalances,
    sendPayment,
    approveReconnect,
    rejectReconnect,
  } = useSorokit(kit, "testnet");

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  // Track OS/browser preference changes so the UI adapts without a reload.
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [highContrast, setHighContrast] = useState(prefersHighContrast);

  useEffect(() => {
    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const contrastMq = window.matchMedia("(prefers-contrast: more)");
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    const onContrast = (e: MediaQueryListEvent) => setHighContrast(e.matches);
    motionMq.addEventListener("change", onMotion);
    contrastMq.addEventListener("change", onContrast);
    return () => {
      motionMq.removeEventListener("change", onMotion);
      contrastMq.removeEventListener("change", onContrast);
    };
  }, []);

  const isConnected = walletState?.connected && walletState.publicKey;

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    sendPayment({ destination, amount });
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>{i18n.t("ui.app.title")}</h1>

      {/* Reconnect consent prompt — shown when a reload detects a saved session */}
      {pendingReconnect && (
        <div
          style={{
            border: "1px solid #d1a800",
            background: "#fefce8",
            padding: "1rem",
            borderRadius: 8,
            marginBottom: "1rem",
          }}
        >
          <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
            Reconnect saved session?
          </p>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.9em" }}>
            Account:{" "}
            <code style={{ wordBreak: "break-all" }}>
              {pendingReconnect.publicKey}
            </code>
          </p>
          {pendingReconnect.walletType && (
            <p style={{ margin: "0 0 0.25rem", fontSize: "0.9em" }}>
              Wallet: <strong>{pendingReconnect.walletType}</strong>
            </p>
          )}
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.9em" }}>
            Device trust:{" "}
            <strong>{pendingReconnect.trustEvaluation.reason}</strong> (score{" "}
            {pendingReconnect.trustEvaluation.score}/100
            {pendingReconnect.trustEvaluation.securityFlag
              ? " ⚠ unusual device"
              : ""}
            )
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={approveReconnect} disabled={loading}>
              Reconnect
            </button>
            <button onClick={rejectReconnect} disabled={loading}>
              Not now
            </button>
          </div>
        </div>
      )}

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

      {/* Payment form — only shown when connected */}
      {isConnected && (
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
          <button type="submit" disabled={loading}>
            {loading ? i18n.t("ui.payment.sending") : i18n.t("ui.payment.send_button")}
          </button>
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
