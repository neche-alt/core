/**
 * React wallet-connect example — UI layer (#react-wallet-connect, #104).
 *
 * Renders connect/disconnect, a balance list, and a payment form.
 * All sorokit-core calls are in useSorokit.ts — this file only reads state
 * and calls the callbacks the hook exposes.
 *
 * Localization (#104): every user-visible string comes from `ui` in i18n.ts,
 * and amounts are formatted with `formatAmount` (Intl.NumberFormat). No
 * localization dependency is added to the core SDK.
 */

import React, { useState } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { useSorokit } from "./useSorokit";
import { ui, formatAmount } from "./i18n";

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
      <h1>sorokit-core — React wallet</h1>

      {/* Connection */}
      {!isConnected ? (
        <button onClick={connect} disabled={loading}>
          {loading ? ui.connectingLabel : ui.connectButton}
        </button>
      ) : (
        <div>
          <p>
            <strong>{ui.connectedLabel}</strong>{" "}
            <code style={{ wordBreak: "break-all" }}>{walletState.publicKey}</code>
          </p>
          <button onClick={disconnect} disabled={loading} style={{ marginRight: 8 }}>
            {ui.disconnectButton}
          </button>
          <button onClick={refreshBalances} disabled={loading}>
            {ui.refreshBalancesButton}
          </button>
        </div>
      )}

      {/* Balances */}
      {balances.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>{ui.balancesHeading}</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{ui.assetColumnLabel}</th>
                <th style={{ textAlign: "right" }}>{ui.balanceColumnLabel}</th>
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
          <h2>{ui.sendHeading}</h2>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              {ui.destinationLabel}
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={ui.destinationPlaceholder}
                required
                style={{ display: "block", width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              {ui.amountLabel}
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={ui.amountPlaceholder}
                required
                style={{ display: "block", width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? ui.sendingLabel : ui.sendButton}
          </button>
        </form>
      )}

      {/* Feedback */}
      {error && (
        <p style={{ marginTop: "1rem", color: "#8a1c1c", background: "#fdecec", padding: "0.75rem", borderRadius: 6 }}>
          {error}
        </p>
      )}
      {status && !error && (
        <p style={{ marginTop: "1rem", background: "#eef6ff", padding: "0.75rem", borderRadius: 6 }}>
          {status}
        </p>
      )}
    </div>
  );
}
