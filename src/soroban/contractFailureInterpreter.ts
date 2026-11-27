import type { SorokitError } from "../shared/response";
import { SorokitErrorCode } from "../shared/response";

/**
 * Interprets a Soroban invocation failure into actionable human-readable guidance.
 */
export function interpretContractFailure(error: SorokitError): string {
  switch (error.code) {
    case SorokitErrorCode.CONTRACT_NOT_FOUND:
      return "The target contract does not exist on this network or instance storage has expired.";
    case SorokitErrorCode.SIMULATION_FAILED:
    case SorokitErrorCode.CONTRACT_INVOKE_FAILED:
      return `Contract simulation failed: ${error.message}. Please check your balance, allowances, or input parameters.`;
    case SorokitErrorCode.TX_SUBMIT_FAILED:
      if (error.message.includes("tx_bad_seq")) {
        return "Transaction sequence conflict. Please resubmit to use the latest sequence number.";
      }
      return `Transaction submission rejected: ${error.message}`;
    case SorokitErrorCode.WALLET_SIGN_FAILED:
      return "Wallet rejected the signature request or connection timed out.";
    case SorokitErrorCode.NETWORK_ERROR:
    case SorokitErrorCode.TIMEOUT:
      return "Network latency or timeout. Check transaction status before retrying to prevent double submission.";
    default:
      return `Unexpected error (${error.code}): ${error.message}`;
  }
}
