/**
 * CopyAddress — accessible copy-to-clipboard control for Stellar account addresses.
 *
 * Requirements addressed (issue #98):
 *   - Full address is copied without truncation
 *   - Button has an accessible label via aria-label
 *   - Visible confirmation feedback ("Copied!") after a successful copy
 *   - Visible error feedback ("Copy failed") when the Clipboard API is unavailable
 *   - Keyboard accessible — focus-visible styling and Enter/Space activation
 */

import React, { useState, useRef } from "react";

export interface CopyAddressProps {
  /** Full Stellar G-address to copy. Never truncated in the copied value. */
  address: string;
  /**
   * How long to show the confirmation/error label before reverting to the
   * default label. Defaults to 2000 ms.
   */
  feedbackDurationMs?: number;
}

type CopyState = "idle" | "copied" | "failed";

const LABEL: Record<CopyState, string> = {
  idle: "Copy address",
  copied: "Copied!",
  failed: "Copy failed",
};

/**
 * Renders the full address in a read-only text node alongside an accessible
 * copy button. The copied value is always the untruncated address.
 *
 * @example
 * <CopyAddress address={publicKey} />
 */
export function CopyAddress({ address, feedbackDurationMs = 2000 }: CopyAddressProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function handleCopy() {
    // Clear any pending reset so rapid clicks don't stack timers.
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);

    if (!navigator?.clipboard?.writeText) {
      // Clipboard API unavailable (non-secure context or unsupported browser).
      setCopyState("failed");
      timeoutRef.current = setTimeout(() => setCopyState("idle"), feedbackDurationMs);
      return;
    }

    try {
      // Always write the full, untruncated address.
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    timeoutRef.current = setTimeout(() => setCopyState("idle"), feedbackDurationMs);
  }

  const isCopied = copyState === "copied";
  const isFailed = copyState === "failed";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      {/* Full address — readable by screen readers, never truncated */}
      <code
        style={{ wordBreak: "break-all", fontSize: "0.85em" }}
        aria-label={`Account address: ${address}`}
      >
        {address}
      </code>

      <button
        type="button"
        onClick={handleCopy}
        aria-label={LABEL[copyState]}
        aria-live="polite"
        style={{
          cursor: "pointer",
          padding: "0.2rem 0.6rem",
          fontSize: "0.8em",
          borderRadius: 4,
          border: "1px solid currentColor",
          background: isCopied ? "#d4edda" : isFailed ? "#f8d7da" : "transparent",
          color: isCopied ? "#155724" : isFailed ? "#721c24" : "inherit",
          // Ensure focus is visually distinct for keyboard users.
          outline: "2px solid transparent",
          outlineOffset: 2,
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.outline = "2px solid #0066cc";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.outline = "2px solid transparent";
        }}
      >
        {LABEL[copyState]}
      </button>
    </span>
  );
}
