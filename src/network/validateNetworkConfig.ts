/**
 * Browser-safe network configuration validator (#132).
 *
 * Validates URL shape, required fields, and network passphrase against
 * known constants before the first request is made. Entirely synchronous
 * and free of Node-only imports, so it runs in the browser without bundling
 * issues.
 */

import { NETWORK_DEFAULTS } from "./config";
import type { NetworkConfig } from "./config";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Identifies which field of the config is invalid. */
export type NetworkConfigField =
  | "network"
  | "horizonUrl"
  | "rpcUrl"
  | "networkPassphrase";

/** A single validation problem attached to a named config field. */
export interface NetworkConfigIssue {
  field: NetworkConfigField;
  message: string;
}

/** Returned by validateNetworkConfig — always check valid before using the config. */
export type NetworkConfigValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: NetworkConfigIssue[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Known passphrases keyed by network name. Built from NETWORK_DEFAULTS so
 *  there is a single source of truth and no magic strings here. */
const KNOWN_PASSPHRASES: ReadonlyMap<string, string> = new Map(
  Object.values(NETWORK_DEFAULTS).map((cfg) => [cfg.network, cfg.networkPassphrase]),
);

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Returns true for a valid HTTPS URL, or an HTTP URL whose host is localhost.
 * Uses the WHATWG URL API which is available in all modern browsers and
 * Node ≥ 10 without any import.
 */
function isValidNetworkUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:" && LOCALHOST_HOSTNAMES.has(parsed.hostname)) {
    return true;
  }
  return false;
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Synchronously validate a network configuration object.
 *
 * Checks performed:
 * - `network` must be a non-empty string.
 * - `horizonUrl` must be a valid HTTPS URL (or HTTP on localhost).
 * - `rpcUrl` must be a valid HTTPS URL (or HTTP on localhost).
 * - `networkPassphrase` must be a non-empty string.
 * - When the network name matches a known network (mainnet / testnet /
 *   futurenet), the passphrase must match exactly.
 *
 * No Node-only imports are used; safe to call in browser bundles.
 *
 * @example
 * const result = validateNetworkConfig({
 *   network: 'testnet',
 *   horizonUrl: 'https://horizon-testnet.stellar.org',
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 * });
 * if (!result.valid) console.error(result.issues);
 */
export function validateNetworkConfig(
  config: Partial<NetworkConfig>,
): NetworkConfigValidationResult {
  const issues: NetworkConfigIssue[] = [];

  // network field
  if (
    config.network === undefined ||
    config.network === null ||
    (typeof config.network === "string" && config.network.trim().length === 0)
  ) {
    issues.push({
      field: "network",
      message: "network is required and must be a non-empty string.",
    });
  } else if (typeof config.network !== "string") {
    issues.push({ field: "network", message: "network must be a string." });
  }

  // horizonUrl field
  if (
    config.horizonUrl === undefined ||
    config.horizonUrl === null ||
    (typeof config.horizonUrl === "string" && config.horizonUrl.trim().length === 0)
  ) {
    issues.push({
      field: "horizonUrl",
      message: "horizonUrl is required.",
    });
  } else if (
    typeof config.horizonUrl !== "string" ||
    !isValidNetworkUrl(config.horizonUrl)
  ) {
    issues.push({
      field: "horizonUrl",
      message:
        `Invalid horizonUrl "${String(config.horizonUrl)}". ` +
        "Must be a valid HTTPS URL, or an HTTP URL on localhost.",
    });
  }

  // rpcUrl field
  if (
    config.rpcUrl === undefined ||
    config.rpcUrl === null ||
    (typeof config.rpcUrl === "string" && config.rpcUrl.trim().length === 0)
  ) {
    issues.push({
      field: "rpcUrl",
      message: "rpcUrl is required.",
    });
  } else if (
    typeof config.rpcUrl !== "string" ||
    !isValidNetworkUrl(config.rpcUrl)
  ) {
    issues.push({
      field: "rpcUrl",
      message:
        `Invalid rpcUrl "${String(config.rpcUrl)}". ` +
        "Must be a valid HTTPS URL, or an HTTP URL on localhost.",
    });
  }

  // networkPassphrase field
  if (
    config.networkPassphrase === undefined ||
    config.networkPassphrase === null ||
    (typeof config.networkPassphrase === "string" &&
      config.networkPassphrase.trim().length === 0)
  ) {
    issues.push({
      field: "networkPassphrase",
      message: "networkPassphrase is required and must be a non-empty string.",
    });
  } else if (typeof config.networkPassphrase !== "string") {
    issues.push({
      field: "networkPassphrase",
      message: "networkPassphrase must be a string.",
    });
  } else if (
    typeof config.network === "string" &&
    config.network.trim().length > 0
  ) {
    // Cross-check passphrase against known network constants.
    const expected = KNOWN_PASSPHRASES.get(config.network);
    if (expected !== undefined && config.networkPassphrase !== expected) {
      issues.push({
        field: "networkPassphrase",
        message:
          `networkPassphrase does not match the known passphrase for "${config.network}". ` +
          `Expected: "${expected}".`,
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }
  return { valid: true, issues: [] };
}
