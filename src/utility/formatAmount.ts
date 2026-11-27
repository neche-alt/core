/**
 * Precision-safe amount and asset presentation helpers for Sorokit.
 *
 * These helpers format Stellar balances for display WITHOUT lossy numeric
 * conversion. Amounts are parsed and formatted as decimal strings, so values
 * that exceed `Number.MAX_SAFE_INTEGER` (or carry many decimal places) are
 * preserved exactly. Asset presentation exposes the asset code together with
 * issuer context, with an explicit fallback for unknown assets.
 *
 * They are intentionally distinct from the stroop-based
 * `formatAmount` (`src/shared/amountFormatter.ts`, which returns a
 * `SorokitResult`): these are defensive *display* helpers — they never throw on
 * display input and return a safe fallback string for missing or unparseable
 * values.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DisplayAmountOptions {
  /** Maximum decimal places to display. Excess fractional digits are truncated (not rounded). Defaults to 7 (Stellar). */
  decimals?: number;
  /** Group the integer part with thousands separators (e.g. `1,234.5`). Defaults to `false`. */
  group?: boolean;
  /** Trim trailing fractional zeros (e.g. `1.500` → `1.5`, `1.000` → `1`). Defaults to `false`. */
  trim?: boolean;
}

export interface DisplayAssetOptions {
  /** Number of leading characters of the issuer to show before the ellipsis. Defaults to `4`. */
  issuerPrefix?: number;
  /** Show the full issuer instead of an abbreviated form. Defaults to `false`. */
  fullIssuer?: boolean;
}

export interface DisplayAssetInput {
  /** Horizon asset type: `"native"`, `"credit_alphanum4"`, `"credit_alphanum12"`, `"liquidity_pool_shares"`, or any other/unknown string. */
  assetType?: string;
  /** Asset code (e.g. `"USDC"`). Empty or absent for the native asset. */
  assetCode?: string;
  /** Issuing account (`G...`). `null` for the native asset. */
  assetIssuer?: string | null;
}

export interface FormattedDisplayAsset {
  /** Display code: `"XLM"` for native, the code for issued assets, or a fallback label for unknown assets. */
  code: string;
  /** Whether the asset could be positively identified. */
  known: boolean;
  /** Short label including issuer context, e.g. `"USDC · GABC…WXYZ"` or `"XLM (native)"`. */
  label: string;
  /** The full issuer when known and present, otherwise `null`. */
  issuer: string | null;
  /** Asset type as provided (or `"unknown"` when absent). */
  type: string;
}

// ─── Amount formatting ─────────────────────────────────────────────────────────

const STELLAR_DEFAULT_DECIMALS = 7;
const GROUP_SEPARATOR = ",";

/** Matches a plain decimal number string (no scientific notation, no hex). */
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * Insert thousands separators into a digit-only integer string.
 * Operates on the string directly (no `Number` conversion) to stay lossless.
 */
function groupInteger(intPart: string): string {
  let out = "";
  const len = intPart.length;
  for (let i = 0; i < len; i++) {
    const ch = intPart.charAt(i);
    if (i > 0 && (len - i) % 3 === 0) out += GROUP_SEPARATOR;
    out += ch;
  }
  return out;
}

/**
 * Format a Stellar amount for display without lossy numeric conversion.
 *
 * Accepts a decimal string, number, or bigint. The value is parsed and
 * formatted entirely as decimal strings — it is never routed through
 * JavaScript `Number` (IEEE-754 double), so balances that exceed
 * `Number.MAX_SAFE_INTEGER` or carry many decimal places are preserved.
 *
 * Missing or unparseable input returns a safe fallback string and never throws:
 * - `null` / `undefined` / empty / whitespace → `""`
 * - non-numeric strings → returned unchanged
 *
 * @param value - The amount as a decimal string (preferred), number, or bigint.
 * @param options - Formatting options (decimals, grouping, trimming).
 * @returns A precision-safe, display-ready string.
 */
export function formatDisplayAmount(
  value: string | number | bigint | null | undefined,
  options?: DisplayAmountOptions,
): string {
  if (value === null || value === undefined) return "";

  let raw: string;
  if (typeof value === "bigint") {
    raw = value.toString();
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value.trim();
  } else {
    return "";
  }

  if (raw === "") return "";
  if (!DECIMAL_PATTERN.test(raw)) return raw; // safe fallback: no throw, no lossy conversion

  const maxDecimals = Math.max(0, options?.decimals ?? STELLAR_DEFAULT_DECIMALS);
  const useGroup = options?.group ?? false;
  const useTrim = options?.trim ?? false;

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;

  const dotIndex = unsigned.indexOf(".");
  let intPart: string;
  let fracPart: string;
  if (dotIndex === -1) {
    intPart = unsigned;
    fracPart = "";
  } else {
    intPart = unsigned.slice(0, dotIndex);
    fracPart = unsigned.slice(dotIndex + 1);
  }

  // Truncate (not round) excess fractional digits to avoid any arithmetic
  // that could introduce precision loss.
  if (fracPart.length > maxDecimals) fracPart = fracPart.slice(0, maxDecimals);
  if (useTrim) fracPart = fracPart.replace(/0+$/, "");

  const formattedInt = useGroup ? groupInteger(intPart) : intPart;
  let result = formattedInt;
  if (fracPart.length > 0) result += "." + fracPart;
  if (negative) result = "-" + result;
  return result;
}

// ─── Asset formatting ──────────────────────────────────────────────────────────

/**
 * Abbreviate an issuer key as `PREFIX…SUFFIX`, or return it in full when it is
 * short enough (or when the full form is requested).
 */
function abbreviateIssuer(issuer: string, prefix: number, full: boolean): string {
  if (full || issuer.length <= prefix * 2) return issuer;
  return `${issuer.slice(0, prefix)}…${issuer.slice(-prefix)}`;
}

/**
 * Format a Stellar asset for display, exposing the asset code together with
 * issuer context and providing a fallback for unknown assets.
 *
 * - Native asset → `{ code: "XLM", label: "XLM (native)", known: true }`.
 * - Issued assets (`credit_alphanum4` / `credit_alphanum12`) → the code plus an
 *   abbreviated issuer, e.g. `"USDC · GABC…WXYZ"` (use `fullIssuer` for the full key).
 * - Liquidity-pool shares → a labelled `"Liquidity pool shares"` entry.
 * - Unknown asset types, or issued assets missing a code → a labelled
 *   `"Unknown asset"` fallback (issuer context still shown when available).
 *
 * Never throws: missing/absent input is treated as an unknown asset.
 *
 * @param asset - The asset to present.
 * @param options - Presentation options (issuer abbreviation).
 * @returns A display-ready asset descriptor.
 */
export function formatDisplayAsset(
  asset: DisplayAssetInput | null | undefined,
  options?: DisplayAssetOptions,
): FormattedDisplayAsset {
  const prefix = Math.max(0, options?.issuerPrefix ?? 4);
  const fullIssuer = options?.fullIssuer ?? false;

  const type = asset?.assetType ?? "unknown";
  const code = asset?.assetCode ?? "";
  const issuer = asset?.assetIssuer ?? null;

  const issuerContext = (label: string): string =>
    issuer ? `${label} · ${abbreviateIssuer(issuer, prefix, fullIssuer)}` : label;

  if (type === "native") {
    return { code: "XLM", known: true, label: "XLM (native)", issuer: null, type };
  }

  if (type === "credit_alphanum4" || type === "credit_alphanum12") {
    if (!code) {
      return { code: "Unknown asset", known: false, label: issuerContext("Unknown asset"), issuer, type };
    }
    return { code, known: true, label: issuerContext(code), issuer, type };
  }

  if (type === "liquidity_pool_shares") {
    return { code: "LP shares", known: true, label: "Liquidity pool shares", issuer: null, type };
  }

  // Unknown asset type — preserve any issuer context we have.
  return { code: "Unknown asset", known: false, label: issuerContext("Unknown asset"), issuer, type };
}
