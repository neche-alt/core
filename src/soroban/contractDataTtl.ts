/**
 * TTL-aware contract data reads (#51).
 *
 * Contract instance and persistent data expire at a known ledger sequence.
 * Applications need to distinguish three states: data is present and live,
 * data is present but expired, or data is absent entirely. This module
 * provides utilities to classify ledger entry state and read contract data
 * with explicit TTL awareness.
 */

import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";

// ─── TTL state classification ─────────────────────────────────────────────────

/**
 * The TTL lifecycle state of a single contract ledger entry.
 *
 * - `"present"` — the entry exists and has not expired at the given ledger.
 * - `"expired"` — the entry exists in the response but its TTL has elapsed.
 * - `"missing"` — the entry was not returned by the RPC node (never existed or was archived).
 */
export type ContractDataTtlState = "present" | "expired" | "missing";

/**
 * Annotated result for a single contract data entry read.
 */
export interface ContractDataTtlResult {
  /** TTL lifecycle state at the time of the read. */
  ttlState: ContractDataTtlState;
  /** Ledger sequence at which the entry expires; `undefined` for missing entries. */
  liveUntilLedgerSeq?: number;
  /** Ledgers remaining until expiry; `0` for expired; `undefined` for missing. */
  remainingLedgers?: number;
  /** The latest ledger returned by the RPC node. */
  latestLedger: number;
}

/**
 * Classify a contract ledger entry's TTL state given the RPC response values.
 *
 * @param latestLedger     - The current ledger sequence from the RPC node.
 * @param liveUntilLedgerSeq - The entry's expiry ledger, or `undefined` if absent.
 *
 * @example
 * ```ts
 * const state = classifyContractDataTtl(50_000, 51_000); // "present"
 * const expired = classifyContractDataTtl(51_001, 51_000); // "expired"
 * const missing = classifyContractDataTtl(50_000, undefined); // "missing"
 * ```
 */
export function classifyContractDataTtl(
  latestLedger: number,
  liveUntilLedgerSeq: number | undefined,
): ContractDataTtlState {
  if (liveUntilLedgerSeq === undefined) return "missing";
  if (liveUntilLedgerSeq <= latestLedger) return "expired";
  return "present";
}

/**
 * Build a {@link ContractDataTtlResult} from raw RPC values.
 *
 * @param latestLedger        - Current ledger from the RPC response.
 * @param liveUntilLedgerSeq  - Entry expiry ledger, or `undefined` if not in response.
 */
export function buildContractDataTtlResult(
  latestLedger: number,
  liveUntilLedgerSeq: number | undefined,
): ContractDataTtlResult {
  const ttlState = classifyContractDataTtl(latestLedger, liveUntilLedgerSeq);
  const remainingLedgers =
    liveUntilLedgerSeq === undefined
      ? undefined
      : Math.max(0, liveUntilLedgerSeq - latestLedger);

  return {
    ttlState,
    ...(liveUntilLedgerSeq !== undefined ? { liveUntilLedgerSeq } : {}),
    ...(remainingLedgers !== undefined ? { remainingLedgers } : {}),
    latestLedger,
  };
}

// ─── TTL-aware read ───────────────────────────────────────────────────────────

/**
 * Options for {@link readContractDataWithTtl}.
 */
export interface ReadContractDataWithTtlOptions {
  /**
   * When `true`, an expired entry returns an error instead of a TTL result.
   * This is useful when callers must not use stale data.
   * Default: `false` — expired entries are reported but do not error.
   */
  errorOnExpired?: boolean;
  /**
   * When `true`, a missing entry returns an error.
   * Default: `false` — missing entries are reported as `ttlState: "missing"`.
   */
  errorOnMissing?: boolean;
}

/**
 * Read contract data TTL information from a pre-fetched ledger entry response.
 *
 * This function is intentionally decoupled from network I/O so it can be used
 * in tests with fixture data and in production with real RPC responses.
 *
 * @param latestLedger        - Current ledger sequence from the RPC node.
 * @param liveUntilLedgerSeq  - Entry's `liveUntilLedgerSeq`, or `undefined` if absent.
 * @param options             - Control whether expired/missing entries error.
 *
 * @example
 * ```ts
 * // With a real RPC response:
 * const rpc = new SorobanRpc.Server(rpcUrl);
 * const response = await rpc.getLedgerEntries(key);
 * const entry = response.entries[0];
 * const result = readContractDataWithTtl(
 *   response.latestLedger,
 *   entry?.liveUntilLedgerSeq,
 *   { errorOnExpired: true },
 * );
 * ```
 */
export function readContractDataWithTtl(
  latestLedger: number,
  liveUntilLedgerSeq: number | undefined,
  options?: ReadContractDataWithTtlOptions,
): SorokitResult<ContractDataTtlResult> {
  const ttlResult = buildContractDataTtlResult(latestLedger, liveUntilLedgerSeq);

  if (ttlResult.ttlState === "missing" && options?.errorOnMissing) {
    return err(
      SorokitErrorCode.CONTRACT_READ_FAILED,
      "Contract data entry is missing — it may never have been written or has been archived.",
    );
  }

  if (ttlResult.ttlState === "expired" && options?.errorOnExpired) {
    return err(
      SorokitErrorCode.CONTRACT_READ_FAILED,
      `Contract data entry expired at ledger ${liveUntilLedgerSeq} ` +
        `(current ledger: ${latestLedger}). Renew the entry before reading.`,
    );
  }

  return ok(ttlResult);
}

// ─── Refresh guidance ─────────────────────────────────────────────────────────

/**
 * Determine whether a contract data entry should be renewed based on its remaining TTL.
 *
 * Returns `true` when remaining ledgers fall at or below `thresholdLedgers`.
 * This is advisory — the caller decides whether and when to renew.
 *
 * @param remainingLedgers  - Ledgers until expiry (use 0 for already-expired entries).
 * @param thresholdLedgers  - Minimum acceptable remaining TTL. Default: 100.
 *
 * @example
 * ```ts
 * if (shouldRenewContractData(entry.remainingLedgers)) {
 *   await renewContractStorage(contractId, 100_000, renewOptions);
 * }
 * ```
 */
export function shouldRenewContractData(
  remainingLedgers: number,
  thresholdLedgers = 100,
): boolean {
  return remainingLedgers <= thresholdLedgers;
}
