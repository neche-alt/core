/**
 * Soroban network capability checks and preflight validation (#54).
 *
 * A contract deployment or invocation flow can fail late if the selected
 * network endpoint does not support Soroban operations or runs an incompatible
 * protocol version. This module performs capability preflights before initiating
 * heavy deployment transactions, returning clear, actionable errors.
 */

import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import {
  isNetworkConnectivityError,
  isTimeoutError,
  toMessage,
} from "../shared";
import type { ResolvedNetworkConfig } from "../shared/types";
import { createSorobanServer } from "../shared/serverFactory";

/**
 * Minimum protocol version required for Soroban smart contract support.
 * Soroban was officially introduced in Stellar Protocol 20.
 */
export const MIN_SOROBAN_PROTOCOL_VERSION = 20;

/**
 * Network capabilities discovered from the endpoint.
 */
export interface NetworkCapabilities {
  /** Whether the network endpoint meets Soroban requirements */
  supported: boolean;
  /** Active protocol version reported by the RPC server */
  protocolVersion: number;
  /** Network passphrase reported by the RPC server */
  passphrase?: string;
  /** Friendbot faucet URL, if provided by the network */
  friendbotUrl?: string;
}

/**
 * Options for capability inspection.
 */
export interface NetworkCapabilityCheckOptions {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Minimum required protocol version (defaults to 20) */
  minProtocolVersion?: number;
  /** Expected network passphrase to ensure endpoint matches network configuration */
  expectedPassphrase?: string;
  /** Optional timeout signal or duration */
  timeoutMs?: number;
}

/**
 * Inspect a Soroban RPC endpoint's capabilities and protocol support.
 *
 * Preflights the RPC server by calling `getNetwork()` and validating:
 * 1. Endpoint availability (returns SERVICE_UNAVAILABLE if unreachable)
 * 2. Protocol version support (returns UNSUPPORTED_NETWORK if protocol < 20)
 * 3. Passphrase match (returns UNSUPPORTED_NETWORK if passphrase mismatches)
 *
 * @param options - RPC URL and capability criteria
 * @returns ok(NetworkCapabilities) if supported, or an actionable err(SorokitError)
 */
export async function checkNetworkCapabilities(
  options: NetworkCapabilityCheckOptions,
): Promise<SorokitResult<NetworkCapabilities>> {
  const { rpcUrl, minProtocolVersion = MIN_SOROBAN_PROTOCOL_VERSION, expectedPassphrase } = options;

  if (!rpcUrl || typeof rpcUrl !== "string" || !rpcUrl.trim()) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      "Cannot check network capabilities: rpcUrl is missing or empty.",
    );
  }

  let server: ReturnType<typeof createSorobanServer>;
  try {
    server = createSorobanServer(rpcUrl.trim());
  } catch (cause) {
    return err(
      SorokitErrorCode.INVALID_CONFIG,
      `Invalid RPC URL for capability check: ${toMessage(cause)}`,
      cause,
    );
  }

  let networkInfo: {
    passphrase?: string;
    protocolVersion?: number;
    friendbotUrl?: string;
  };

  try {
    if (typeof (server as any).getNetwork === "function") {
      networkInfo = await (server as any).getNetwork();
    } else {
      return err(
        SorokitErrorCode.UNSUPPORTED_NETWORK,
        "Connected endpoint does not implement getNetwork(); Soroban RPC capabilities cannot be verified.",
        { rpcUrl },
      );
    }
  } catch (cause) {
    if (isTimeoutError(cause) || isNetworkConnectivityError(cause)) {
      return err(
        SorokitErrorCode.SERVICE_UNAVAILABLE,
        `Network capability check failed: endpoint is unavailable or unreachable: ${toMessage(cause)}`,
        cause,
      );
    }
    return err(
      SorokitErrorCode.SERVICE_UNAVAILABLE,
      `Failed to query network capabilities from "${rpcUrl}": ${toMessage(cause)}`,
      cause,
    );
  }

  const protocolVersion = networkInfo?.protocolVersion ?? 0;

  // Check 1: Verify protocol version meets minimum Soroban requirement
  if (protocolVersion < minProtocolVersion) {
    return err(
      SorokitErrorCode.UNSUPPORTED_NETWORK,
      `Network endpoint does not support Soroban operations: protocol version ${protocolVersion} is below minimum required ${minProtocolVersion}.`,
      {
        rpcUrl,
        protocolVersion,
        minProtocolVersion,
        reportedPassphrase: networkInfo?.passphrase,
      },
    );
  }

  // Check 2: Verify network passphrase matches expectation if configured
  if (
    expectedPassphrase &&
    networkInfo?.passphrase &&
    networkInfo.passphrase !== expectedPassphrase
  ) {
    return err(
      SorokitErrorCode.UNSUPPORTED_NETWORK,
      `Network passphrase mismatch: endpoint reported "${networkInfo.passphrase}", but deployment configuration expects "${expectedPassphrase}".`,
      {
        rpcUrl,
        expectedPassphrase,
        reportedPassphrase: networkInfo.passphrase,
      },
    );
  }

  return ok({
    supported: true,
    protocolVersion,
    ...(networkInfo?.passphrase ? { passphrase: networkInfo.passphrase } : {}),
    ...(networkInfo?.friendbotUrl ? { friendbotUrl: networkInfo.friendbotUrl } : {}),
  });
}

/**
 * Preflight capability check before contract deployment.
 *
 * Validates that the targeted Soroban RPC server supports Protocol 20+
 * and matches the deployment network configuration.
 */
export async function preflightDeploymentCapabilities(options: {
  rpcUrl: string;
  networkConfig?: ResolvedNetworkConfig | undefined;
  minProtocolVersion?: number;
}): Promise<SorokitResult<NetworkCapabilities>> {
  return checkNetworkCapabilities({
    rpcUrl: options.rpcUrl,
    minProtocolVersion: options.minProtocolVersion ?? MIN_SOROBAN_PROTOCOL_VERSION,
    expectedPassphrase: options.networkConfig?.networkPassphrase,
  });
}
