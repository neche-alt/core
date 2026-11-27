/**
 * Compact SDK diagnostics panel — opt-in, debug-only UI (#101).
 *
 * Renders a collapsible "[DEBUG] SDK Diagnostics" section. It is intentionally
 * visually distinct from the main application UI: muted colours, smaller type,
 * and a prominent "[DEBUG]" label so it is never confused with user-facing UI.
 *
 * Usage:
 *   <DiagnosticsPanel show={process.env.NODE_ENV === "development"} network="testnet" />
 *
 * When `show` is false the component renders nothing — safe to leave in the
 * tree and toggled via an env variable or feature flag.
 *
 * Secrets are never rendered. The underlying diagnostics API is strictly
 * read-only: it never connects a wallet, signs anything, or reads private keys.
 */

import React, { useState, useCallback } from "react";
import { runDiagnostics } from "../../../src/shared/diagnostics";
import type {
  DiagnosticsReport,
  DiagnosticCheckResult,
  DiagnosticHealthStatus,
  SdkHealthOptions,
} from "../../../src/shared/diagnostics";
import {
  formatCheckStatus,
  statusColor,
  formatLatency,
  containsSecret,
} from "./diagnosticsUtils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiagnosticsPanelProps {
  /**
   * When false the panel is hidden entirely.
   * Defaults to false so it is opt-in.
   */
  show?: boolean;
  /** Network to run checks against. Defaults to "testnet". */
  network?: SdkHealthOptions["network"];
  /** Fetch override — required outside Node 18+ / browsers. */
  fetchFn?: SdkHealthOptions["fetchFn"];
  /** Wallet adapter to inspect. Omit to skip the wallet check. */
  walletAdapter?: SdkHealthOptions["walletAdapter"];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DiagnosticHealthStatus }) {
  return (
    <span
      style={{
        fontWeight: "bold",
        color: statusColor(status),
        marginRight: 4,
      }}
      aria-label={`Status: ${status}`}
    >
      {formatCheckStatus(status)}
    </span>
  );
}

function CheckRow({ check }: { check: DiagnosticCheckResult }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    check.issues.length > 0 || check.recommendations.length > 0;

  return (
    <div
      style={{
        padding: "4px 0",
        borderBottom: "1px solid #e5e7eb",
        fontSize: 12,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: hasDetail ? "pointer" : "default" }}
        onClick={() => hasDetail && setOpen((v) => !v)}
        role={hasDetail ? "button" : undefined}
        aria-expanded={hasDetail ? open : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        onKeyDown={(e) => {
          if (hasDetail && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <StatusBadge status={check.status} />
        <span style={{ flex: 1, color: "#374151" }}>{check.name}</span>
        <span style={{ color: "#6b7280" }}>{formatLatency(check.latencyMs)}</span>
        {hasDetail && (
          <span style={{ color: "#9ca3af", marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
        )}
      </div>

      {open && hasDetail && (
        <div style={{ marginTop: 4, paddingLeft: 20, fontSize: 11 }}>
          {check.message && (
            <p style={{ margin: "2px 0", color: "#4b5563" }}>{check.message}</p>
          )}
          {check.issues.map((issue, i) => (
            <p key={i} style={{ margin: "2px 0", color: statusColor("unavailable") }}>
              • {issue}
            </p>
          ))}
          {check.recommendations.map((rec, i) => (
            <p key={i} style={{ margin: "2px 0", color: statusColor("degraded") }}>
              → {rec}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function DiagnosticsPanel({
  show = false,
  network = "testnet",
  fetchFn,
  walletAdapter,
}: DiagnosticsPanelProps) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    try {
      const result = await runDiagnostics({
        network,
        ...(fetchFn ? { fetchFn } : {}),
        ...(walletAdapter ? { walletAdapter } : {}),
      });

      // Defence-in-depth: verify the report contains no secrets before rendering.
      const serialised = JSON.stringify(result).toLowerCase();
      if (containsSecret(serialised)) {
        setRunError("Diagnostic report contained a sensitive value and was suppressed.");
        return;
      }

      setReport(result);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Unknown error running diagnostics.");
    } finally {
      setRunning(false);
    }
  }, [network, fetchFn, walletAdapter]);

  if (!show) return null;

  return (
    <details
      style={{
        marginTop: "2rem",
        border: "1px dashed #9ca3af",
        borderRadius: 6,
        padding: "0.75rem 1rem",
        background: "#f9fafb",
        fontFamily: "monospace",
        fontSize: 13,
        color: "#374151",
      }}
    >
      <summary
        style={{ cursor: "pointer", fontWeight: "bold", userSelect: "none", color: "#6b7280" }}
      >
        [DEBUG] SDK Diagnostics
      </summary>

      <div style={{ marginTop: "0.75rem" }}>
        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "0.75rem" }}>
          <button
            onClick={run}
            disabled={running}
            aria-label="Run SDK diagnostics"
            style={{
              fontSize: 12,
              padding: "3px 10px",
              background: "#e5e7eb",
              border: "1px solid #9ca3af",
              borderRadius: 4,
              cursor: running ? "default" : "pointer",
            }}
          >
            {running ? "Running…" : "Run diagnostics"}
          </button>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            Network: {network} · Read-only, no wallet prompts
          </span>
        </div>

        {/* Error */}
        {runError && (
          <p style={{ color: statusColor("unavailable"), fontSize: 12 }}>{runError}</p>
        )}

        {/* Report */}
        {report && (
          <div>
            {/* Header row */}
            <div
              style={{
                display: "flex",
                gap: 12,
                fontSize: 11,
                color: "#6b7280",
                marginBottom: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <span>
                Overall:{" "}
                <strong style={{ color: statusColor(report.status) }}>
                  {report.status}
                </strong>
              </span>
              <span>SDK {report.version}</span>
              <span>{new Date(report.timestamp).toLocaleTimeString()}</span>
              <span>
                {report.summary.healthy}✓ {report.summary.degraded}⚠{" "}
                {report.summary.unavailable}✗ {report.summary.skipped}—
              </span>
            </div>

            {/* Individual checks */}
            {report.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}

            {/* Aggregated recommendations */}
            {report.recommendations.length > 0 && (
              <div style={{ marginTop: "0.5rem", fontSize: 11, color: statusColor("degraded") }}>
                <strong>Recommendations:</strong>
                {report.recommendations.map((rec, i) => (
                  <p key={i} style={{ margin: "2px 0" }}>→ {rec}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
