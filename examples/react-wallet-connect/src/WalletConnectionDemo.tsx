/**
 * Polished wallet connection demo flow (#91).
 *
 * Demonstrates all five connection states — empty, loading, connected,
 * rejected, and disconnected — using WalletStatusTracker from sorokit-core.
 *
 * All wallet logic lives in SDK calls; this component is purely presentational:
 * it reads state from the tracker and calls the callbacks the hook exposes.
 *
 * Run command (from your own CRA/Vite project):
 *   npm install sorokit-core @creit.tech/stellar-wallets-kit
 */

import React from "react";
import type { WalletConnectionStatus } from "../../../src/wallet/walletStatusTracker";
import {
  getAriaLabel,
  getStatusColorClass,
  truncatePublicKey,
} from "../../../src/wallet/walletStatusTracker";
import type { WalletStatus } from "../../../src/wallet/walletStatusTracker";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WalletDemoCallbacks {
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export interface WalletConnectionDemoProps {
  status: WalletStatus;
  callbacks: WalletDemoCallbacks;
}

// ─── Status indicator ──────────────────────────────────────────────────────

const STATUS_DOT_COLOR: Record<WalletConnectionStatus, string> = {
  connected: "#1a7f4b",
  connecting: "#b45309",
  authenticating: "#b45309",
  disconnected: "#9ca3af",
  failed: "#8a1c1c",
  error: "#8a1c1c",
};

const STATUS_LABEL: Record<WalletConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  authenticating: "Authenticating…",
  disconnected: "Disconnected",
  failed: "Connection failed",
  error: "Error",
};

function StatusDot({ status }: { status: WalletConnectionStatus }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: STATUS_DOT_COLOR[status],
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function StatusBar({ walletStatus }: { walletStatus: WalletStatus }) {
  const ariaLabel = getAriaLabel(walletStatus);
  const colorClass = getStatusColorClass(walletStatus.status);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={colorClass}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0.5rem 0.75rem",
        borderRadius: 6,
        background: "#f3f4f6",
        fontSize: 13,
        gap: 4,
      }}
    >
      <StatusDot status={walletStatus.status} />
      <span style={{ fontWeight: 500 }}>
        {STATUS_LABEL[walletStatus.status]}
      </span>
      {walletStatus.adapterName && (
        <span style={{ color: "#6b7280" }}>· {walletStatus.adapterName}</span>
      )}
      {walletStatus.truncatedAddress && (
        <code style={{ marginLeft: 4, fontSize: 11, color: "#374151" }}>
          {walletStatus.truncatedAddress}
        </code>
      )}
      {(walletStatus.isRetry || walletStatus.attempt !== undefined) &&
        walletStatus.maxRetries !== undefined &&
        walletStatus.status === "connecting" && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
            attempt {walletStatus.attempt}/{walletStatus.maxRetries}
          </span>
        )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "2rem 1rem",
        border: "2px dashed #e5e7eb",
        borderRadius: 8,
      }}
    >
      <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
        No wallet connected. Connect Freighter to get started.
      </p>
      <button
        onClick={onConnect}
        aria-label="Connect Freighter wallet"
        style={{
          padding: "0.5rem 1.5rem",
          background: "#1d4ed8",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 14,
        }}
      >
        Connect Wallet
      </button>
    </div>
  );
}

// ─── Loading state ────────────────────────────────────────────────────────

function LoadingState({ status }: { status: WalletStatus }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "2rem 1rem",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div
        aria-label="Connecting to wallet"
        role="status"
        style={{ fontSize: 24, marginBottom: "0.75rem" }}
      >
        ⏳
      </div>
      <p style={{ color: "#374151", fontWeight: 500, marginBottom: 4 }}>
        {status.status === "authenticating"
          ? "Waiting for wallet approval…"
          : "Opening wallet…"}
      </p>
      <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>
        Check your {status.adapterName ?? "wallet"} extension for a prompt.
      </p>
    </div>
  );
}

// ─── Connected state ──────────────────────────────────────────────────────

function ConnectedState({
  status,
  onDisconnect,
}: {
  status: WalletStatus;
  onDisconnect: () => void;
}) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #d1fae5",
        borderRadius: 8,
        background: "#f0fdf4",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" }}
      >
        <span aria-hidden="true" style={{ fontSize: 20 }}>✅</span>
        <span style={{ fontWeight: 600, color: "#065f46" }}>
          {status.adapterName ?? "Wallet"} connected
        </span>
      </div>
      {status.publicKey && (
        <p style={{ fontSize: 12, color: "#374151", margin: "0 0 0.75rem" }}>
          <strong>Address:</strong>{" "}
          <code title={status.publicKey}>{truncatePublicKey(status.publicKey)}</code>
        </p>
      )}
      <button
        onClick={onDisconnect}
        aria-label={`Disconnect ${status.adapterName ?? "wallet"}`}
        style={{
          padding: "0.4rem 1rem",
          background: "transparent",
          color: "#065f46",
          border: "1px solid #6ee7b7",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Disconnect
      </button>
    </div>
  );
}

// ─── Rejected / error state ───────────────────────────────────────────────

function RejectedState({
  status,
  onRetry,
}: {
  status: WalletStatus;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #fecaca",
        borderRadius: 8,
        background: "#fef2f2",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}
      >
        <span aria-hidden="true" style={{ fontSize: 20 }}>⚠️</span>
        <span style={{ fontWeight: 600, color: "#7f1d1d" }}>
          {status.status === "failed" ? "Connection failed" : "Connection error"}
        </span>
      </div>
      {status.error && (
        <p
          role="alert"
          style={{ fontSize: 12, color: "#b91c1c", margin: "0 0 0.75rem" }}
        >
          {status.error}
        </p>
      )}
      <button
        onClick={onRetry}
        aria-label="Retry wallet connection"
        style={{
          padding: "0.4rem 1rem",
          background: "transparent",
          color: "#7f1d1d",
          border: "1px solid #fca5a5",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Try again
      </button>
    </div>
  );
}

// ─── Disconnected state ───────────────────────────────────────────────────

function DisconnectedState({ onConnect }: { onConnect: () => void }) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: "#f9fafb",
      }}
    >
      <p
        role="status"
        aria-live="polite"
        style={{ color: "#6b7280", fontSize: 13, margin: "0 0 0.75rem" }}
      >
        Wallet disconnected.
      </p>
      <button
        onClick={onConnect}
        aria-label="Reconnect wallet"
        style={{
          padding: "0.4rem 1rem",
          background: "transparent",
          color: "#1d4ed8",
          border: "1px solid #93c5fd",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Reconnect
      </button>
    </div>
  );
}

// ─── Main demo component ──────────────────────────────────────────────────

/**
 * WalletConnectionDemo renders all five wallet connection states:
 *   empty → loading → connected → (rejected or) disconnected
 *
 * Pass a `WalletStatus` from `WalletStatusTracker` and the two callbacks.
 * The tracker drives state; this component renders it.
 */
export function WalletConnectionDemo({
  status,
  callbacks,
}: WalletConnectionDemoProps) {
  const isLoading =
    status.status === "connecting" || status.status === "authenticating";
  const isConnected = status.status === "connected";
  const isError =
    status.status === "failed" || status.status === "error";
  const isDisconnected = status.status === "disconnected";
  const isEmpty = isDisconnected && !status.adapterName;

  return (
    <div
      style={{ maxWidth: 480, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: "0.75rem" }}>
        Wallet Connection
      </h2>

      {/* Always-visible status bar */}
      <div style={{ marginBottom: "0.75rem" }}>
        <StatusBar walletStatus={status} />
      </div>

      {/* State panels */}
      {isEmpty && !isError && <EmptyState onConnect={callbacks.onConnect} />}

      {isLoading && <LoadingState status={status} />}

      {isConnected && (
        <ConnectedState status={status} onDisconnect={callbacks.onDisconnect} />
      )}

      {isError && (
        <RejectedState status={status} onRetry={callbacks.onConnect} />
      )}

      {!isEmpty && isDisconnected && (
        <DisconnectedState onConnect={callbacks.onConnect} />
      )}
    </div>
  );
}
