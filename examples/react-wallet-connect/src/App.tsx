/**
 * React wallet-connect example — UI layer (#react-wallet-connect).
 *
 * Renders connect/disconnect, a balance list, and a payment form.
 * All sorokit-core calls are in useSorokit.ts — this file only reads state
 * and calls the callbacks the hook exposes.
 *
 * Accessibility (#107): respects prefers-reduced-motion and
 * prefers-contrast / forced-colors via the helpers in ./a11y.ts.
 */

import React, { useState, useEffect } from "react";
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
    <div
      data-reduced-motion={reducedMotion}
      data-high-contrast={highContrast}
      style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}
    >
      <h1>sorokit-core — React wallet</h1>

      {/* Connection */}
      {!isConnected ? (
        <button
          onClick={connect}
          disabled={loading}
          style={{ transition: reducedMotion ? "none" : "opacity 0.2s ease" }}
        >
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

      {/* Feedback — status colors respect high-contrast preferences */}
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
