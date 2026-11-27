/**
 * Accessible wallet connection controls for integration examples (#94).
 *
 * All interactive elements are keyboard-operable:
 * - Buttons have explicit aria-label values describing their action and target.
 * - Focus is visible via outline styles (not suppressed by outline: none).
 * - Connection status is announced by an aria-live="polite" region so screen
 *   readers pick up every state change without a full-page reload.
 * - Disabled states use the HTML disabled attribute (not just visual styling)
 *   so assistive technology knows the control is unavailable.
 * - Public key is rendered in a <code> element with a full title for copy-paste
 *   and a truncated visible label to fit smaller viewports.
 *
 * Provider-specific limitations:
 * - Freighter (and most browser extension wallets) show their own permission
 *   popup in a separate window. The popup is not part of this document, so
 *   focus cannot be moved into it programmatically. After connect/disconnect
 *   the aria-live region announces the new state to cover this gap.
 * - WalletConnect uses a QR-code modal injected by the WalletConnect library.
 *   That modal manages its own focus trap. No additional focus management is
 *   needed from the SDK side.
 */

import React from "react";
import type { WalletStatus } from "../../../src/wallet/walletStatusTracker";
import { getAriaLabel, truncatePublicKey } from "../../../src/wallet/walletStatusTracker";

// ─── Shared focus-visible style ───────────────────────────────────────────────

const FOCUS_STYLE: React.CSSProperties = {
  outline: "2px solid #1d4ed8",
  outlineOffset: 2,
};

// ─── Accessible button ────────────────────────────────────────────────────────

interface WalletButtonProps {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
}

function WalletButton({
  onClick,
  disabled = false,
  label,
  children,
  variant = "primary",
}: WalletButtonProps) {
  const baseStyle: React.CSSProperties = {
    padding: "0.45rem 1.1rem",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid transparent",
    transition: "background 0.15s",
  };

  const variantStyle: Record<typeof variant, React.CSSProperties> = {
    primary: {
      background: disabled ? "#93c5fd" : "#1d4ed8",
      color: "#fff",
      border: "1px solid transparent",
    },
    secondary: {
      background: "transparent",
      color: "#1d4ed8",
      border: "1px solid #93c5fd",
    },
    danger: {
      background: "transparent",
      color: "#7f1d1d",
      border: "1px solid #fca5a5",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-disabled={disabled}
      style={{ ...baseStyle, ...variantStyle[variant] }}
      onFocus={(e) => Object.assign(e.currentTarget.style, FOCUS_STYLE)}
      onBlur={(e) => { e.currentTarget.style.outline = ""; e.currentTarget.style.outlineOffset = ""; }}
    >
      {children}
    </button>
  );
}

// ─── Status announcement region ───────────────────────────────────────────────

function StatusAnnouncement({ walletStatus }: { walletStatus: WalletStatus }) {
  const label = getAriaLabel(walletStatus);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // The region is visually present so sighted users also see the status.
      style={{
        fontSize: 13,
        color: "#374151",
        padding: "0.4rem 0.6rem",
        background: "#f3f4f6",
        borderRadius: 4,
        minHeight: "1.8rem",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span aria-hidden="true">
        {walletStatus.status === "connected" && "✅"}
        {walletStatus.status === "connecting" && "⏳"}
        {walletStatus.status === "authenticating" && "⏳"}
        {walletStatus.status === "disconnected" && "⬜"}
        {walletStatus.status === "failed" && "❌"}
        {walletStatus.status === "error" && "❌"}
      </span>
      {/* This text is what assistive technology reads aloud. */}
      <span>{label}</span>
    </div>
  );
}

// ─── Account display ──────────────────────────────────────────────────────────

function AccountDisplay({ publicKey }: { publicKey: string }) {
  return (
    <p style={{ margin: "0.4rem 0", fontSize: 13 }}>
      <span>Account: </span>
      <code
        title={publicKey}
        aria-label={`Account address: ${publicKey}`}
        style={{ fontSize: 11, wordBreak: "break-all" }}
      >
        {truncatePublicKey(publicKey)}
      </code>
    </p>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface AccessibleWalletControlsProps {
  walletStatus: WalletStatus;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  /**
   * When true, action buttons are disabled regardless of connection state.
   * Pass this during any in-progress async operation to prevent double-clicks.
   */
  busy?: boolean;
}

/**
 * Accessible wallet connection controls.
 *
 * Renders a status region (aria-live) and the appropriate action button(s)
 * for the current wallet state. All controls are keyboard-operable and have
 * explicit accessible names.
 *
 * @example
 * <AccessibleWalletControls
 *   walletStatus={tracker.status}
 *   onConnect={() => tracker.connect(adapter)}
 *   onDisconnect={() => tracker.disconnect(adapter)}
 *   busy={loading}
 * />
 */
export function AccessibleWalletControls({
  walletStatus,
  onConnect,
  onDisconnect,
  busy = false,
}: AccessibleWalletControlsProps) {
  const isConnected = walletStatus.status === "connected";
  const isConnecting =
    walletStatus.status === "connecting" ||
    walletStatus.status === "authenticating";
  const hasError =
    walletStatus.status === "failed" || walletStatus.status === "error";

  const walletName = walletStatus.adapterName ?? "wallet";

  return (
    <section
      aria-label="Wallet connection controls"
      style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
    >
      {/* Always-present live region: announces state to screen readers */}
      <StatusAnnouncement walletStatus={walletStatus} />

      {/* Account address — only shown when connected */}
      {isConnected && walletStatus.publicKey && (
        <AccountDisplay publicKey={walletStatus.publicKey} />
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {!isConnected && (
          <WalletButton
            onClick={onConnect}
            disabled={busy || isConnecting}
            label={
              isConnecting
                ? `Connecting to ${walletName}…`
                : `Connect ${walletName}`
            }
            variant="primary"
          >
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </WalletButton>
        )}

        {isConnected && (
          <WalletButton
            onClick={onDisconnect}
            disabled={busy}
            label={`Disconnect ${walletName}`}
            variant="danger"
          >
            Disconnect
          </WalletButton>
        )}

        {hasError && (
          <WalletButton
            onClick={onConnect}
            disabled={busy}
            label={`Retry connecting to ${walletName}`}
            variant="secondary"
          >
            Retry connection
          </WalletButton>
        )}
      </div>

      {/* Error message — associated with the control section, not a floating alert */}
      {hasError && walletStatus.error && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 12,
            color: "#b91c1c",
            background: "#fef2f2",
            padding: "0.4rem 0.6rem",
            borderRadius: 4,
          }}
        >
          {walletStatus.error}
        </p>
      )}

      {/*
        Provider-specific accessibility note:
        Extension wallets (Freighter, xBull, etc.) open a separate browser
        popup for approval. Focus cannot be moved into that popup from here.
        The aria-live region above announces the resulting state change once
        the popup resolves, which covers the transition for screen reader users.
      */}
    </section>
  );
}
