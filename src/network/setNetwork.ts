import { resolveNetwork } from "./resolveNetwork";
import type { NetworkConfig, NetworkType } from "./config";
import { err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { validateNetworkConfig } from "./validateNetworkConfig";

export interface SetNetworkOptions {
  /**
   * When true, runs the browser-safe preflight validator before switching.
   * Invalid configs are rejected immediately with a structured error instead
   * of surfacing at request time as an opaque Horizon/RPC error.
   * @default false
   */
  validate?: boolean;
}

/**
 * Build a NetworkConfig with optional URL overrides and an optional preflight
 * validation step. Delegates to resolveNetwork().
 */
export function setNetwork(
  network: NetworkType,
  overrides?: Partial<Pick<NetworkConfig, "horizonUrl" | "rpcUrl">>,
  options?: SetNetworkOptions,
): SorokitResult<NetworkConfig> {
  const resolved = resolveNetwork(network, overrides);

  if (options?.validate && resolved.status === "ok") {
    const validation = validateNetworkConfig(resolved.data);
    if (!validation.valid) {
      const summary = validation.issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("; ");
      return err(
        SorokitErrorCode.INVALID_NETWORK,
        `Network configuration is invalid — ${summary}`,
      );
    }
  }

  return resolved;
}
