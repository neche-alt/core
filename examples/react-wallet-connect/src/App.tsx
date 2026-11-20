/**
 * React wallet-connect example — UI layer (#react-wallet-connect).
 *
 * Renders connect/disconnect, a balance list, and a payment form.
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

  const isConnected = walletState?.connected && walletState.publicKey;

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    sendPayment({ destination, amount });
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>sorokit-core — React wallet</h1>

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

      {/* Payment form — only shown when connected */}
      {isConnected && (
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
            {loading ? "Sending…" : "Send"}
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
