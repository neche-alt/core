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
import { DiagnosticsPanel } from "./DiagnosticsPanel";

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
      {isConnected && (
        <section
          aria-label="Account activity"
          aria-live="polite"
          aria-busy={loading}
          style={{ marginTop: "1.5rem" }}
        >
          <h2>Balances</h2>
          {(() => {
            const state = deriveActivityState(loading, balances, error, !!isConnected, refreshBalances);
            if (state.kind === "loading") {
              return (
                <p aria-label="Loading account activity" role="status">
                  Loading…
                </p>
              );
            }
            if (state.kind === "empty") {
              return (
                <p aria-label="No account activity" role="status">
                  No activity yet
                </p>
              );
            }
            if (state.kind === "error") {
              return (
                <div>
                  <p style={{ color: "#8a1c1c" }}>{state.message}</p>
                  <button
                    aria-label="Retry loading activity"
                    onClick={state.retry}
                  >
                    Retry
                  </button>
                </div>
              );
            }
            return (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Asset</th>
                    <th style={{ textAlign: "right" }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {state.balances.map((b) => (
                    <tr key={`${b.assetCode}-${b.assetIssuer ?? "native"}`}>
                      <td>{b.assetCode}</td>
                      <td style={{ textAlign: "right" }}>{b.balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </section>
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
