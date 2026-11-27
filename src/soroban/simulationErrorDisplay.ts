/**
 * Actionable simulation failure display (#137).
 *
 * Runs failed contract simulations through the existing decoders —
 * contractErrors, rpcErrorMapper, resultDecoder, and contractCallIdentity —
 * and returns structured, human-readable failure information so users see
 * decoded error codes and messages instead of raw XDR blobs.
 */

import { xdr } from "@stellar/stellar-sdk";
import {
  decodeContractError,
  DEFAULT_CONTRACT_ERROR_MAP,
} from "./contractErrors";
import type { ContractErrorMap } from "./contractErrors";
import {
  classifySorobanRpcError,
  extractRpcErrorMessage,
} from "./rpcErrorMapper";
import { extractContractCallIdentity } from "./contractCallIdentity";
import { decodeContractValue } from "./contractEncoding";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single argument that could be identified as failing in the simulation.
 */
export interface SimulationFailureArg {
  /** Zero-based position in the contract call argument list. */
  index: number;
  /** The raw base64-encoded XDR for this argument. */
  valueXdr: string;
  /** Best-effort decoded JS value, or null when decoding was not possible. */
  decoded: unknown;
  /** Set when decoding raised an error. */
  decodingError?: string;
}

/**
 * Fully assembled, human-readable description of a failed simulation.
 */
export interface SimulationFailureDisplay {
  /** Contract ID that was called, or null when not extractable from XDR. */
  contractId: string | null;
  /** Method name that was called, or null when not extractable. */
  method: string | null;
  /** Decoded contract error code (symbolic or numeric), or null when unavailable. */
  errorCode: string | null;
  /** Human-readable error message from the contract error map. */
  errorMessage: string;
  /** Remediation guidance from the contract error map, when available. */
  remediation?: string;
  /** SDK error code string from RPC-level classification (e.g. SOROBAN_SIMULATION_FAILED). */
  rpcErrorCode: string;
  /** Raw RPC-level error message. */
  rpcErrorMessage: string;
  /** First argument that could be associated with the failure, when decodable. */
  failingArg?: SimulationFailureArg;
  /** The original, untouched error value. */
  raw: unknown;
}

// ─── Arg extraction ───────────────────────────────────────────────────────────

/**
 * Split a concatenated base64 XDR string (produced by serializeContractArgs)
 * into individual per-argument chunks.
 *
 * Each ScVal encoded as base64 is a multiple of 4 characters. We attempt to
 * parse greedily from the left, treating each successful parse as one argument.
 */
function splitArgXdr(concatenated: string): string[] {
  if (!concatenated) return [];

  // Try splitting on natural base64 boundaries (multiples of 4 up to 256 chars per arg).
  const chunks: string[] = [];
  let remaining = concatenated;

  while (remaining.length > 0) {
    let parsed = false;
    // Try increasing sizes (smallest valid base64 ScVal is 4+ chars).
    for (let len = 4; len <= remaining.length; len += 4) {
      const chunk = remaining.slice(0, len);
      try {
        xdr.ScVal.fromXDR(chunk, "base64");
        chunks.push(chunk);
        remaining = remaining.slice(len);
        parsed = true;
        break;
      } catch {
        // Keep extending.
      }
    }
    if (!parsed) break; // Cannot parse further — stop.
  }

  return chunks;
}

function decodeArgChunk(xdrChunk: string, index: number): SimulationFailureArg {
  try {
    const scVal = xdr.ScVal.fromXDR(xdrChunk, "base64");
    const decoded = decodeContractValue(scVal);
    return { index, valueXdr: xdrChunk, decoded };
  } catch (err) {
    return {
      index,
      valueXdr: xdrChunk,
      decoded: null,
      decodingError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a SimulationFailureDisplay from a failed simulation error.
 *
 * @param error             Raw error from a failed simulation call.
 * @param transactionXdr    Optional transaction XDR to extract caller identity and args.
 * @param networkPassphrase Required when transactionXdr is provided.
 * @param errorMap          Custom contract error map; defaults to DEFAULT_CONTRACT_ERROR_MAP.
 *
 * @example
 * try {
 *   await simulateTransaction(server, tx);
 * } catch (err) {
 *   const display = buildSimulationFailureDisplay(err, txXdr, Networks.TESTNET);
 *   console.error(display.errorMessage, display.remediation);
 * }
 */
export function buildSimulationFailureDisplay(
  error: unknown,
  transactionXdr?: string,
  networkPassphrase?: string,
  errorMap: ContractErrorMap = DEFAULT_CONTRACT_ERROR_MAP,
): SimulationFailureDisplay {
  // 1. Decode the contract-level error (code + message).
  const contractDecoded = decodeContractError(error, errorMap);

  // 2. Classify and extract the RPC-level error.
  const rpcCode = classifySorobanRpcError(error);
  const rpcMessage = extractRpcErrorMessage(error);

  // 3. Extract caller identity from the transaction XDR when available.
  let contractId: string | null = null;
  let method: string | null = null;
  let failingArg: SimulationFailureArg | undefined;

  if (transactionXdr && networkPassphrase) {
    const identity = extractContractCallIdentity(transactionXdr, networkPassphrase);
    if (identity) {
      contractId = identity.contractId;
      method = identity.method;

      // 4. Attempt to decode the first argument as the potentially failing one.
      const argChunks = splitArgXdr(identity.argsXdr);
      if (argChunks.length > 0) {
        failingArg = decodeArgChunk(argChunks[0]!, 0);
      }
    }
  }

  return {
    contractId,
    method,
    errorCode: contractDecoded.code,
    errorMessage: contractDecoded.message,
    ...(contractDecoded.remediation !== undefined
      ? { remediation: contractDecoded.remediation }
      : {}),
    rpcErrorCode: rpcCode,
    rpcErrorMessage: rpcMessage,
    ...(failingArg !== undefined ? { failingArg } : {}),
    raw: error,
  };
}
