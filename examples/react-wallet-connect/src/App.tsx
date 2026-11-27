/**
 * React wallet-connect example — UI layer (#react-wallet-connect).
 *
 * Renders connect/disconnect, a balance list, and a payment form.
 * All sorokit-core calls are in useSorokit.ts — this file only reads state
 * and calls the callbacks the hook exposes.
 *
 * User-facing strings are routed through src/shared/i18n.ts so translators
 * and extraction tooling can discover every message key in one place.
 */

import React, { useState } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { createI18n } from "../../../src/shared/i18n";
import { useSorokit } from "./useSorokit";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

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

export default function App() {
  const {
    walletState,
    balances,
    loading,
    error,
    status,
    connect,
    disconnect,
    refreshBalances,
    sendPayment,
  } = useSorokit(kit, "testnet");

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  const isConnected = walletState?.connected && walletState.publicKey;

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    sendPayment({ destination, amount });
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>{i18n.t("ui.app.title")}</h1>

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
                  <td style={{ textAlign: "right" }}>{b.balance}</td>
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

      {/* Feedback */}
      {error && (
        <p
          role="alert"
          style={{
            marginTop: "1rem",
            color: error.startsWith("You declined") || error.startsWith("Connection declined")
              ? "#7a4f00"
              : "#8a1c1c",
            background: error.startsWith("You declined") || error.startsWith("Connection declined")
              ? "#fff8e1"
              : "#fdecec",
            padding: "0.75rem",
            borderRadius: 6,
          }}
        >
          {error}
        </p>
      )}
      {status && !error && (
        <p style={{ marginTop: "1rem", background: "#eef6ff", padding: "0.75rem", borderRadius: 6 }}>
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
