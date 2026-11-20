/**
 * NetworkBadge — shows the active Stellar network with a clear testnet/mainnet
 * distinction so users never approve an action on the wrong network.
 *
 * Requirements addressed (issue #95):
 *   - Displays both the network name and a testnet/mainnet distinction
 *   - Updates immediately when the network prop changes
 *   - Requires explicit confirmation for risky mainnet actions via
 *     the companion `useMainnetGuard` hook
 */

import React, { useState } from "react";
import type { NetworkType } from "../../../src/network/config";

// ---------------------------------------------------------------------------
// Visual style helpers
// ---------------------------------------------------------------------------

const NETWORK_LABEL: Record<NetworkType, string> = {
  mainnet: "Mainnet",
  testnet: "Testnet",
  futurenet: "Futurenet",
};

/** Human-readable distinction shown beneath the network name. */
const NETWORK_DISTINCTION: Record<NetworkType, string> = {
  mainnet: "Real assets — transactions are irreversible",
  testnet: "Test network — no real assets",
  futurenet: "Pre-release test network — no real assets",
};

const BADGE_STYLE: Record<NetworkType, React.CSSProperties> = {
  mainnet: {
    background: "#fff3cd",
    color: "#856404",
    border: "1px solid #ffc107",
    fontWeight: 700,
  },
  testnet: {
    background: "#d1ecf1",
    color: "#0c5460",
    border: "1px solid #17a2b8",
    fontWeight: 600,
  },
  futurenet: {
    background: "#e2d9f3",
    color: "#4a235a",
    border: "1px solid #9b59b6",
    fontWeight: 600,
  },
};

// ---------------------------------------------------------------------------
// NetworkBadge component
// ---------------------------------------------------------------------------

export interface NetworkBadgeProps {
  /** Current active network. The badge updates whenever this prop changes. */
  network: NetworkType;
}

/**
 * Renders the network name and a testnet/mainnet distinction label.
 * Mainnet is styled with an amber warning so it is immediately recognisable.
 *
 * @example
 * <NetworkBadge network="testnet" />
 * <NetworkBadge network="mainnet" />
 */
export function NetworkBadge({ network }: NetworkBadgeProps) {
  return (
    <span
      role="status"
      aria-label={`Active network: ${NETWORK_LABEL[network]}. ${NETWORK_DISTINCTION[network]}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 2,
        padding: "0.25rem 0.6rem",
        borderRadius: 4,
        fontSize: "0.85em",
        ...BADGE_STYLE[network],
      }}
    >
      <span>{NETWORK_LABEL[network]}</span>
      <span style={{ fontWeight: 400, fontSize: "0.9em", opacity: 0.85 }}>
        {NETWORK_DISTINCTION[network]}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// useMainnetGuard — confirmation hook for risky mainnet actions
// ---------------------------------------------------------------------------

export interface MainnetGuardState {
  /** True while waiting for the user to confirm or cancel. */
  isPending: boolean;
  /**
   * Call before any mainnet action that moves real assets.
   * Returns true when the user confirms, false when they cancel.
   * On non-mainnet networks always returns true immediately (no prompt).
   */
  requestConfirmation: () => Promise<boolean>;
  /** Programmatically confirm (used in tests). */
  confirm: () => void;
  /** Programmatically cancel (used in tests). */
  cancel: () => void;
}

/**
 * Hook that gates risky mainnet actions behind an explicit confirmation step.
 *
 * On testnet or futurenet, `requestConfirmation` resolves immediately with
 * `true` — no dialog is shown. On mainnet a pending state is set and the
 * promise waits until `confirm()` or `cancel()` is called (typically by a
 * modal or inline confirmation UI).
 *
 * @example
 * const guard = useMainnetGuard(network);
 *
 * async function handleSend() {
 *   const ok = await guard.requestConfirmation();
 *   if (!ok) return; // user cancelled
 *   await sendPayment(...);
 * }
 *
 * // Render the confirmation prompt while guard.isPending is true
 */
export function useMainnetGuard(network: NetworkType): MainnetGuardState {
  const [isPending, setIsPending] = useState(false);
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const requestConfirmation = (): Promise<boolean> => {
    // Non-mainnet: bypass the prompt entirely
    if (network !== "mainnet") return Promise.resolve(true);

    setIsPending(true);
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  };

  const confirm = () => {
    resolver?.(true);
    setResolver(null);
    setIsPending(false);
  };

  const cancel = () => {
    resolver?.(false);
    setResolver(null);
    setIsPending(false);
  };

  return { isPending, requestConfirmation, confirm, cancel };
}

// ---------------------------------------------------------------------------
// MainnetConfirmDialog — inline confirmation UI for mainnet actions
// ---------------------------------------------------------------------------

export interface MainnetConfirmDialogProps {
  /** Text describing the action being confirmed. */
  actionDescription: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Inline dialog shown when a mainnet action requires explicit confirmation.
 * Keyboard accessible — focused automatically, dismissible with Escape.
 *
 * @example
 * {guard.isPending && (
 *   <MainnetConfirmDialog
 *     actionDescription="Send 10 XLM to GDEST…"
 *     onConfirm={guard.confirm}
 *     onCancel={guard.cancel}
 *   />
 * )}
 */
export function MainnetConfirmDialog({
  actionDescription,
  onConfirm,
  onCancel,
}: MainnetConfirmDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mainnet-confirm-title"
      aria-describedby="mainnet-confirm-desc"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      style={{
        marginTop: "1rem",
        padding: "1rem",
        border: "2px solid #ffc107",
        borderRadius: 6,
        background: "#fff8e1",
        color: "#5c3d00",
      }}
    >
      <strong id="mainnet-confirm-title">⚠ Mainnet action — confirm before proceeding</strong>
      <p id="mainnet-confirm-desc" style={{ margin: "0.5rem 0" }}>
        {actionDescription}
        <br />
        <small>This action uses real assets and cannot be reversed.</small>
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={onConfirm}
          autoFocus
          style={{ background: "#ffc107", border: "none", padding: "0.4rem 1rem", borderRadius: 4, cursor: "pointer", fontWeight: 700 }}
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: "transparent", border: "1px solid currentColor", padding: "0.4rem 1rem", borderRadius: 4, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
