/**
 * Network configuration — defaults and the canonical NetworkConfig type.
 *
 * NetworkConfig extends ResolvedNetworkConfig from shared/types so that
 * transaction/ and soroban/ modules can type their parameters against
 * ResolvedNetworkConfig without importing from this file.
 *
 * Rule: only network/ and client/ import from this file.
 */

import type { ResolvedNetworkConfig } from "../shared/types";

export type NetworkType = "mainnet" | "testnet" | "futurenet";

/** Full network config — extends the shared shape with no additions. */
export type NetworkConfig = ResolvedNetworkConfig;

/**
 * Tuning knobs for the request batcher used by bulk account reads.
 * Pass this to `createRequestBatcher` via its `config` argument.
 *
 * @example
 * ```typescript
 * import { createRequestBatcher } from "./requestBatching";
 * import type { BatchingConfig } from "./config";
 *
 * const batchingConfig: BatchingConfig = {
 *   adaptiveWindow: true,
 *   minWindowMs: 5,
 *   maxWindowMs: 50,
 *   targetLatencyMs: 100,
 *   maxBatchSize: 50,
 * };
 * const batcher = createRequestBatcher(fetcher, batchingConfig);
 * ```
 */
export interface BatchingConfig {
  /** Enable the batcher. Default: true. */
  enabled?: boolean;
  /** Fixed collection window in ms (used when `adaptiveWindow` is false). Default: 10. */
  windowMs?: number;
  /** Maximum distinct keys per batch before an immediate flush. Default: 20. */
  maxBatchSize?: number;
  /**
   * Enable adaptive windowing — the window grows under high load and shrinks
   * under low load, always respecting `targetLatencyMs`. Default: false.
   */
  adaptiveWindow?: boolean;
  /** Lower bound for the adaptive window (ms). Default: 5. */
  minWindowMs?: number;
  /** Upper bound for the adaptive window (ms). Default: 50. */
  maxWindowMs?: number;
  /**
   * Hard latency cap (ms). The adaptive window never exceeds this value.
   * Default: 100.
   */
  targetLatencyMs?: number;
}

export const NETWORK_DEFAULTS: Record<NetworkType, NetworkConfig> = {
  mainnet: {
    network: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://mainnet.stellar.validationcloud.io/v1/soroban/rpc",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
  testnet: {
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  futurenet: {
    network: "futurenet",
    horizonUrl: "https://horizon-futurenet.stellar.org",
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
  },
};
