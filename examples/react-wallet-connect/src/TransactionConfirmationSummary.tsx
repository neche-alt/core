/**
 * TransactionConfirmationSummary — example component (#105).
 *
 * Displays a structured summary of the transaction the user is about to sign
 * so integrators teach users what they are approving before the wallet prompt
 * opens. Fields that cannot be determined are labelled "—" rather than hidden.
 *
 * Usage:
 *
 *   <TransactionConfirmationSummary
 *     summary={pendingSummary}
 *     onConfirm={handleConfirm}
 *     onCancel={handleCancel}
 *   />
 *
 * Render this component and wait for `onConfirm` before calling
 * `client.wallet.signTransaction`. If the user clicks Cancel, call `onCancel`
 * and do not open the wallet prompt.
 */

import React from "react";

export interface TransactionSummary {
  /** "mainnet" | "testnet" | "futurenet" or any custom label */
  network: string;
  /** Destination address or contract ID */
  destination: string;
  /** Short human-readable description of what the transaction does */
  operationSummary: string;
  /** Asset being sent, e.g. "XLM" or "USDC" */
  asset: string;
  /** Amount being sent as a formatted string, or null when unavailable */
  amount: string | null;
  /** Estimated fee in stroops as a formatted string, or null when unavailable */
  feeStroops: string | null;
}

export interface TransactionConfirmationSummaryProps {
  summary: TransactionSummary;
  /** Called when the user deliberately clicks "Confirm & open wallet" */
  onConfirm: () => void;
  /** Called when the user clicks "Cancel" */
  onCancel: () => void;
}

const fieldStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "0.4rem 0",
  borderBottom: "1px solid #e5e7eb",
};

const labelStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "0.875rem",
};

const valueStyle: React.CSSProperties = {
  fontWeight: 500,
  wordBreak: "break-all",
  textAlign: "right",
  maxWidth: "60%",
};

const unavailableStyle: React.CSSProperties = {
  ...valueStyle,
  color: "#9ca3af",
  fontStyle: "italic",
};

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {value !== null ? (
        <span style={valueStyle}>{value}</span>
      ) : (
        <span style={unavailableStyle}>—</span>
      )}
    </div>
  );
}

export function TransactionConfirmationSummary({
  summary,
  onConfirm,
  onCancel,
}: TransactionConfirmationSummaryProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-confirm-heading"
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        padding: "1.25rem",
        background: "#fff",
        maxWidth: 480,
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      <h3
        id="tx-confirm-heading"
        style={{ margin: "0 0 1rem", fontSize: "1rem" }}
      >
        Review transaction
      </h3>

      <div style={{ marginBottom: "1rem" }}>
        <Field label="Network" value={summary.network} />
        <Field label="Destination" value={summary.destination} />
        <Field label="Operation" value={summary.operationSummary} />
        <Field label="Asset" value={summary.asset} />
        <Field label="Amount" value={summary.amount} />
        <Field
          label="Estimated fee (stroops)"
          value={summary.feeStroops}
        />
      </div>

      <p
        style={{
          fontSize: "0.8rem",
          color: "#6b7280",
          marginBottom: "1rem",
        }}
      >
        Review the details above. Clicking &ldquo;Confirm &amp; open
        wallet&rdquo; will open your wallet extension to sign this
        transaction.
      </p>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          onClick={onConfirm}
          style={{
            flex: 1,
            padding: "0.6rem 1rem",
            background: "#1d4ed8",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Confirm &amp; open wallet
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "0.6rem 1rem",
            background: "#f3f4f6",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
