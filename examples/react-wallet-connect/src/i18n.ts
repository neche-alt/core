/**
 * Localization-ready string dictionary for the react-wallet-connect example (#104).
 *
 * All user-visible strings live here so integrators can swap in their own
 * translations without touching component logic. Locale-aware formatting for
 * dates and amounts uses the built-in `Intl` APIs — no extra dependency added
 * to the core SDK.
 *
 * Usage:
 *   import { ui, formatAmount, formatDate } from "./i18n";
 *   // Then: ui.connectButton, formatAmount("12.5", "XLM", "en-US"), etc.
 *
 * To localise: replace the string values or load them from your own i18n
 * library (react-i18next, vue-i18n, fluent, …) and re-export the same shape.
 */

// ---------------------------------------------------------------------------
// String dictionary
// ---------------------------------------------------------------------------

export interface WalletUiStrings {
  // Connection
  connectButton: string;
  connectingLabel: string;
  disconnectButton: string;
  connectedLabel: string;
  refreshBalancesButton: string;

  // Balances table
  balancesHeading: string;
  assetColumnLabel: string;
  balanceColumnLabel: string;

  // Payment form
  sendHeading: string;
  destinationLabel: string;
  destinationPlaceholder: string;
  amountLabel: string;
  amountPlaceholder: string;
  sendButton: string;
  sendingLabel: string;

  // Feedback
  walletConnectedStatus: string;
  walletDisconnectedStatus: string;
  /** Receives the tx hash; use a function so the hash can be embedded. */
  paymentSentStatus: (txHash: string) => string;
  connectFirstError: string;
}

/** Default English strings. Replace or extend for other locales. */
export const ui: WalletUiStrings = {
  connectButton: "Connect Freighter",
  connectingLabel: "Connecting…",
  disconnectButton: "Disconnect",
  connectedLabel: "Connected:",
  refreshBalancesButton: "Refresh balances",

  balancesHeading: "Balances",
  assetColumnLabel: "Asset",
  balanceColumnLabel: "Balance",

  sendHeading: "Send XLM",
  destinationLabel: "Destination",
  destinationPlaceholder: "G…",
  amountLabel: "Amount (XLM)",
  amountPlaceholder: "10",
  sendButton: "Send",
  sendingLabel: "Sending…",

  walletConnectedStatus: "Wallet connected",
  walletDisconnectedStatus: "Wallet disconnected",
  paymentSentStatus: (txHash) => `Payment sent — tx ${txHash}`,
  connectFirstError: "Connect a wallet first",
};

// ---------------------------------------------------------------------------
// Locale-aware formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a Stellar amount string with locale-aware number formatting.
 * Uses `Intl.NumberFormat` — no extra dependency.
 *
 * @param amount  Raw amount string from the SDK (e.g. "12.5000000")
 * @param assetCode  Asset code to append (e.g. "XLM")
 * @param locale  BCP-47 locale tag (defaults to the runtime locale)
 *
 * @example
 * formatAmount("1234567.5000000", "XLM", "de-DE")
 * // → "1.234.567,5 XLM"
 */
export function formatAmount(
  amount: string,
  assetCode: string,
  locale?: string,
): string {
  const numeric = parseFloat(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${assetCode}`;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  }).format(numeric);
  return `${formatted} ${assetCode}`;
}

/**
 * Format an ISO-8601 date string in the user's locale.
 * Uses `Intl.DateTimeFormat` — no extra dependency.
 *
 * @param isoString  ISO-8601 date string (e.g. "2024-03-15T10:00:00Z")
 * @param locale  BCP-47 locale tag (defaults to the runtime locale)
 * @param options  `Intl.DateTimeFormatOptions` overrides
 *
 * @example
 * formatDate("2024-03-15T10:00:00Z", "fr-FR")
 * // → "15 mars 2024, 10:00"
 */
export function formatDate(
  isoString: string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}
