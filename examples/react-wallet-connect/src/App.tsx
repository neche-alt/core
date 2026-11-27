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

import React, { useState, useEffect } from "react";
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
    <div
      data-reduced-motion={reducedMotion}
      data-high-contrast={highContrast}
      style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}
    >
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
