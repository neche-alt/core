/**
 * Utility helpers for the SDK diagnostics panel (react-wallet-connect example).
 *
 * These are pure functions so they can be unit-tested without React.
 * Nothing here reads private keys, secrets, seeds, or mnemonics.
 */

import type { DiagnosticHealthStatus, DiagnosticCheckResult } from "../../../src/shared/diagnostics";

/** Symbol shown next to each check status in the panel. */
export const STATUS_SYMBOL: Record<DiagnosticHealthStatus, string> = {
  healthy: "✓",
  degraded: "⚠",
  unavailable: "✗",
  skipped: "—",
};

/** CSS colour token for each status. */
export const STATUS_COLOR: Record<DiagnosticHealthStatus, string> = {
  healthy: "#1a7f4b",
  degraded: "#b45309",
  unavailable: "#8a1c1c",
  skipped: "#6b7280",
};

/** Returns the display symbol for a given diagnostic status. */
export function formatCheckStatus(status: DiagnosticHealthStatus): string {
  return STATUS_SYMBOL[status];
}

/** Returns the display colour for a given diagnostic status. */
export function statusColor(status: DiagnosticHealthStatus): string {
  return STATUS_COLOR[status];
}

/**
 * Scrubs a serialised value for any secret-looking keys.
 *
 * The diagnostics API is already designed to never include secrets, but this
 * provides a defence-in-depth check before the panel renders anything.
 */
const SECRET_PATTERNS = /secret|privatekey|private_key|seed|mnemonic/i;

export function containsSecret(value: string): boolean {
  return SECRET_PATTERNS.test(value);
}

/**
 * Formats a check result into a one-line summary suitable for the panel.
 * Returns `"[SYMBOL] Name — message"`.
 */
export function formatCheckSummary(check: DiagnosticCheckResult): string {
  return `${formatCheckStatus(check.status)} ${check.name} — ${check.message}`;
}

/**
 * Formats latency for display.
 * Returns `"Xms"` for a measured value, or `"—"` when not applicable.
 */
export function formatLatency(latencyMs: number | null): string {
  return latencyMs === null ? "—" : `${latencyMs}ms`;
}
