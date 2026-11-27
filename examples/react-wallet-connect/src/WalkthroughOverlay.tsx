/**
 * First-run guided walkthrough overlay (#108).
 *
 * Demonstrates createWalkthroughManager from sorokit-core in a React
 * component. The overlay is dismissible, navigable by keyboard, and persists
 * its completion state to localStorage. It degrades gracefully when storage
 * is unavailable (SSR, private browsing).
 *
 * Usage:
 *   import { WalkthroughOverlay } from "./WalkthroughOverlay";
 *   // Mount it once at the app root; it auto-hides when complete or dismissed.
 *   <WalkthroughOverlay />
 */

import { useEffect, useRef, useState } from "react";
import { createWalkthroughManager } from "../../../src/shared/walkthroughManager";
import type { WalkthroughState } from "../../../src/shared/walkthroughManager";

// ─── Walkthrough steps for the demo application ───────────────────────────────

const DEMO_STEPS = [
  {
    id: "welcome",
    title: "Welcome to Sorokit",
    description:
      "This demo walks you through wallet setup, network selection, and " +
      "Soroban contract interaction. Use the arrow keys or buttons below to navigate.",
  },
  {
    id: "wallet",
    title: "Connect Your Wallet",
    description:
      'Click "Connect wallet" to link Freighter or any other supported wallet ' +
      "adapter. Your public key will appear once connected.",
    target: "#connect-wallet-button",
  },
  {
    id: "network",
    title: "Select a Network",
    description:
      'Switch between Testnet and Mainnet in the network selector. The SDK ' +
      "will route all requests to the chosen Horizon endpoint automatically.",
    target: "#network-selector",
  },
  {
    id: "contracts",
    title: "Explore Contract Examples",
    description:
      "The examples/ directory contains Soroban contract interaction patterns: " +
      "invoke, simulate, deploy, and event subscription. See examples/vue-soroban " +
      "and examples/router-swap for real-world usage.",
  },
];

// ─── Shared manager instance (created once; storage auto-detected) ────────────

function createManager() {
  return createWalkthroughManager({
    id: "sorokit-demo-app",
    steps: DEMO_STEPS,
    // storage: undefined → auto-detects localStorage; falls back to no-op
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WalkthroughOverlay() {
  const managerRef = useRef(createManager());
  const manager = managerRef.current;

  // Don't show if the user already completed the walkthrough in a prior session.
  const [state, setState] = useState<WalkthroughState>(() => manager.getState());
  const [visible, setVisible] = useState(() => !manager.wasCompleted());

  useEffect(() => {
    const unsubscribe = manager.subscribe((next) => {
      setState(next);
      if (next.isDismissed || next.isComplete) setVisible(false);
    });

    // Attach keyboard handler while the overlay is visible.
    const onKey = (e: KeyboardEvent) => manager.handleKeyDown(e);
    if (visible) document.addEventListener("keydown", onKey);

    return () => {
      unsubscribe();
      document.removeEventListener("keydown", onKey);
    };
  }, [manager, visible]);

  if (!visible) return null;

  const { currentStepIndex, totalSteps, currentStep } = state;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === totalSteps - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started walkthrough"
      style={overlayStyle}
    >
      <div style={cardStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={stepCountStyle}>
            Step {currentStepIndex + 1} of {totalSteps}
          </span>
          <button
            aria-label="Dismiss walkthrough"
            onClick={() => manager.dismiss()}
            style={closeBtnStyle}
          >
            ✕
          </button>
        </div>

        {/* Step progress dots */}
        <div style={dotsStyle} aria-hidden="true">
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              style={{
                ...dotStyle,
                background: i === currentStepIndex ? "#6366f1" : "#d1d5db",
              }}
            />
          ))}
        </div>

        {/* Content */}
        <h2 style={titleStyle}>{currentStep.title}</h2>
        <p style={descStyle}>{currentStep.description}</p>
        {currentStep.target && (
          <p style={targetHintStyle}>
            👉 Look for: <code>{currentStep.target}</code>
          </p>
        )}

        {/* Navigation */}
        <div style={navStyle}>
          <button
            onClick={() => manager.previous()}
            disabled={isFirst}
            style={{ ...navBtnStyle, opacity: isFirst ? 0.4 : 1 }}
            aria-label="Previous step"
          >
            ← Back
          </button>

          {isLast ? (
            <button
              onClick={() => manager.complete()}
              style={{ ...navBtnStyle, background: "#6366f1", color: "#fff" }}
              aria-label="Complete walkthrough"
            >
              Done ✓
            </button>
          ) : (
            <button
              onClick={() => manager.next()}
              style={{ ...navBtnStyle, background: "#6366f1", color: "#fff" }}
              aria-label="Next step"
            >
              Next →
            </button>
          )}
        </div>

        <p style={keyboardHintStyle}>
          Keyboard: ← → to navigate · Enter to advance · Esc to dismiss
        </p>
      </div>
    </div>
  );
}

// ─── Inline styles (no external CSS dependency) ───────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: "12px",
  padding: "24px 28px",
  width: "min(480px, 90vw)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
  fontFamily: "system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
};

const stepCountStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#6b7280",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "16px",
  color: "#9ca3af",
  padding: "2px 6px",
  lineHeight: 1,
};

const dotsStyle: React.CSSProperties = {
  display: "flex",
  gap: "6px",
  marginBottom: "16px",
};

const dotStyle: React.CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  transition: "background 0.2s",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: "20px",
  fontWeight: 700,
  color: "#111827",
};

const descStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: "15px",
  lineHeight: 1.6,
  color: "#374151",
};

const targetHintStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  margin: "0 0 16px",
};

const navStyle: React.CSSProperties = {
  display: "flex",
  gap: "10px",
  justifyContent: "flex-end",
  marginTop: "20px",
};

const navBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  borderRadius: "7px",
  border: "1px solid #e5e7eb",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 600,
  background: "#f9fafb",
  color: "#374151",
};

const keyboardHintStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#9ca3af",
  textAlign: "center",
  margin: "14px 0 0",
};
