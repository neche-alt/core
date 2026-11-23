/**
 * React wallet-connect example — UI layer (#react-wallet-connect).
 *
 * Renders connect/disconnect, a balance list, a payment form, and — after the
 * transaction is built — a confirmation summary the user must review before
 * the wallet prompt opens (#105).
 *
 * All sorokit-core calls are in useSorokit.ts — this file only reads state
 * and calls the callbacks the hook exposes.
 */

import React, { useState } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { useSorokit } from "./useSorokit";
import { TransactionConfirmationSummary } from "./TransactionConfirmationSummary";

// Initialise SWK once outside the component so it isn't recreated on renders.
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
    pendingSummary,
    connect,
    disconnect,
    refreshBalances,
    sendPayment,
    confirmPayment,
    cancelPayment,
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
          {loading ? "Connecting…" : "Connect Freighter"}
        </button>
      ) : (
        <div>
          <p>
            <strong>Connected:</strong>{" "}
            <code style={{ wordBreak: "break-all" }}>{walletState.publicKey}</code>
          </p>
          <button onClick={disconnect} disabled={loading} style={{ marginRight: 8 }}>
            Disconnect
          </button>
          <button onClick={refreshBalances} disabled={loading}>
            Refresh balances
          </button>
        </div>
      )}

      {/* Balances */}
      {balances.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Balances</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Asset</th>
                <th style={{ textAlign: "right" }}>Balance</th>
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
          <h2>Send XLM</h2>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              Destination
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="G..."
                required
                style={{ display: "block", width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              Amount (XLM)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10"
                required
                style={{ display: "block", width: "100%", marginTop: 4 }}
              />
            </label>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? "Building transaction…" : "Review & send"}
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
