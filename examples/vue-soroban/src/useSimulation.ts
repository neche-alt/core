/**
 * Vue Soroban simulation preview composable (#129).
 *
 * Wraps simulateContractSafe so simulation state (result, loading, error)
 * is reactive and bindable in templates. Errors from the RPC layer are
 * mapped to user-readable messages via extractRpcErrorMessage and
 * decodeContractError.
 *
 * Usage:
 *   const { result, loading, error, simulate, reset } = useSimulation();
 *   await simulate(rpcUrl, networkPassphrase, transactionXdr);
 *   // result.value contains fee, success, footprint
 *
 * Unit-testable with mockClient: pass a mock simulateContractSafe-compatible
 * function via the options argument.
 */

import { ref } from "vue";
import type { Ref } from "vue";
import { simulateContractSafe } from "../../../src/soroban/simulateContractSafe";
import { extractRpcErrorMessage } from "../../../src/soroban/rpcErrorMapper";
import { decodeContractError } from "../../../src/soroban/contractErrors";
import type { SafeSimulationResult } from "../../../src/soroban/simulateContractSafe";
import type { SimulateContractSafeOptions } from "../../../src/soroban/simulateContractSafe";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SimulationPreviewData {
  /** Whether the simulation call succeeded. */
  success: boolean;
  /** Estimated fee in stroops (string to match SDK shape). */
  fee: string;
  /** Fee converted to XLM for display (fee / 10_000_000). */
  feeXlm: string;
  /** True when the result came from the fallback fee, not a live RPC call. */
  fromFallback: boolean;
  /** Raw SDK result, available for advanced consumers. */
  raw: SafeSimulationResult;
}

export interface UseSimulationOptions {
  /** Passed through to simulateContractSafe. allowFail defaults to true so a
   *  simulation failure shows an error rather than crashing the UI. */
  simulateOptions?: SimulateContractSafeOptions;
  /**
   * Override the simulate implementation — useful for unit testing with
   * src/testing/mockClient.ts or a manual stub.
   */
  simulateFn?: typeof simulateContractSafe;
}

export interface UseSimulationReturn {
  /** Reactive simulation result, null until simulate() has been called. */
  result: Ref<SimulationPreviewData | null>;
  /** True while a simulation is in flight. */
  loading: Ref<boolean>;
  /** User-readable error message, null when the last simulation succeeded. */
  error: Ref<string | null>;
  /**
   * Run a simulation. Updates result / error reactively.
   *
   * @param rpcUrl            - Soroban RPC endpoint.
   * @param networkPassphrase - Network passphrase matching the transaction.
   * @param transactionXdr    - Unsigned (or signed) transaction envelope XDR.
   */
  simulate: (
    rpcUrl: string,
    networkPassphrase: string,
    transactionXdr: string,
  ) => Promise<void>;
  /** Clear result, error, and loading state. */
  reset: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: string): string {
  const n = Number(stroops);
  if (!Number.isFinite(n)) return "0";
  return (n / 10_000_000).toFixed(7);
}

function toReadableError(cause: unknown): string {
  // Try decoding as a contract error first (gives structured message + remediation).
  const decoded = decodeContractError(cause);
  if (decoded.decoded && decoded.message) {
    return decoded.remediation
      ? `${decoded.message} — ${decoded.remediation}`
      : decoded.message;
  }
  // Fall back to the RPC error mapper for network/RPC-layer failures.
  const rpcMsg = extractRpcErrorMessage(cause);
  if (rpcMsg && rpcMsg !== "Soroban RPC request failed") return rpcMsg;
  return typeof cause === "string" ? cause : "Simulation failed — unknown error";
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useSimulation(options: UseSimulationOptions = {}): UseSimulationReturn {
  const result = ref<SimulationPreviewData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const runSimulate = options.simulateFn ?? simulateContractSafe;

  async function simulate(
    rpcUrl: string,
    networkPassphrase: string,
    transactionXdr: string,
  ): Promise<void> {
    loading.value = true;
    error.value = null;
    result.value = null;

    try {
      const simOptions: SimulateContractSafeOptions = {
        allowFail: true,
        ...options.simulateOptions,
      };

      const outcome = await runSimulate(
        rpcUrl,
        networkPassphrase,
        transactionXdr,
        simOptions,
      );

      if (outcome.status === "error") {
        error.value = toReadableError(outcome.error);
        return;
      }

      const raw = outcome.data;

      if (!raw.success) {
        // Simulation returned a failure result (contract reverted, etc.)
        error.value = toReadableError(raw.error ?? "Contract simulation returned failure");
        return;
      }

      result.value = {
        success: true,
        fee: raw.fee ?? "0",
        feeXlm: stroopsToXlm(raw.fee ?? "0"),
        fromFallback: raw.fromFallback,
        raw,
      };
    } catch (cause: unknown) {
      error.value = toReadableError(cause);
    } finally {
      loading.value = false;
    }
  }

  function reset(): void {
    result.value = null;
    loading.value = false;
    error.value = null;
  }

  return { result, loading, error, simulate, reset };
}
