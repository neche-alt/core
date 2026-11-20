/**
 * React wallet-connect example — UI layer (#react-wallet-connect).
 *
 * Renders connect/disconnect, network identity badge, a balance list, and a
 * payment form. Mainnet actions require explicit confirmation.
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
