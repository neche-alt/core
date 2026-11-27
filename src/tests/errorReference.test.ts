import { describe, expect, it } from "vitest";
import {
  err,
  SorokitErrorCode,
  SorokitErrorCategory,
  isInvalidInputError,
  isWalletRejectionError,
  isNetworkFailureError,
  isSimulationFailureError,
  isLedgerExecutionError,
  classifyErrorDomain,
} from "../index";

describe("Structured Error Reference and Classification (#59)", () => {
  describe("Domain 1: Invalid Input", () => {
    it("classifies validation and configuration errors as invalid input", () => {
      const errorResult = err(
        SorokitErrorCode.INVALID_CONFIG,
        "rpcUrl is missing",
      );
      expect(errorResult.status).toBe("error");
      if (errorResult.status === "error") {
        expect(isInvalidInputError(errorResult.error)).toBe(true);
        expect(classifyErrorDomain(errorResult.error)).toBe("invalid_input");
        expect(errorResult.error.category).toBe(SorokitErrorCategory.VALIDATION);
        expect(errorResult.error.recovery?.retryable).toBe(false);
      }
    });

    it("classifies INVALID_ADDRESS and XDR_INVALID as invalid input", () => {
      const addressError = err(
        SorokitErrorCode.INVALID_ADDRESS,
        "Malformed public key",
      );
      const xdrError = err(
        SorokitErrorCode.XDR_INVALID,
        "Invalid transaction XDR",
      );

      if (addressError.status === "error") {
        expect(isInvalidInputError(addressError.error)).toBe(true);
      }
      if (xdrError.status === "error") {
        expect(isInvalidInputError(xdrError.error)).toBe(true);
      }
    });
  });

  describe("Domain 2: Wallet Rejection", () => {
    it("classifies WALLET_SIGN_REJECTED as wallet rejection", () => {
      const errorResult = err(
        SorokitErrorCode.WALLET_SIGN_REJECTED,
        "User declined the signing request",
      );
      expect(errorResult.status).toBe("error");
      if (errorResult.status === "error") {
        expect(isWalletRejectionError(errorResult.error)).toBe(true);
        expect(classifyErrorDomain(errorResult.error)).toBe("wallet_rejection");
        expect(errorResult.error.recovery?.retryable).toBe(false);
      }
    });

    it("detects wallet rejections via wallet category message patterns", () => {
      const errorResult = err(
        SorokitErrorCode.WALLET_CONNECT_FAILED,
        "User rejected the popup connection dialog",
      );
      if (errorResult.status === "error") {
        expect(isWalletRejectionError(errorResult.error)).toBe(true);
      }
    });
  });

  describe("Domain 3: Network Failure", () => {
    it("classifies NETWORK_ERROR and SERVICE_UNAVAILABLE as network failure", () => {
      const netError = err(
        SorokitErrorCode.NETWORK_ERROR,
        "Connection refused to RPC endpoint",
      );
      const unavailError = err(
        SorokitErrorCode.SERVICE_UNAVAILABLE,
        "RPC endpoint returned 503",
      );

      if (netError.status === "error") {
        expect(isNetworkFailureError(netError.error)).toBe(true);
        expect(classifyErrorDomain(netError.error)).toBe("network_failure");
        expect(netError.error.recovery?.retryable).toBe(true);
      }

      if (unavailError.status === "error") {
        expect(isNetworkFailureError(unavailError.error)).toBe(true);
      }
    });

    it("classifies RATE_LIMITED and OPERATION_TIMEOUT as network failure", () => {
      const rateLimitError = err(
        SorokitErrorCode.RATE_LIMITED,
        "Too many requests",
      );
      const timeoutError = err(
        SorokitErrorCode.OPERATION_TIMEOUT,
        "Operation timed out after 10000ms",
      );

      if (rateLimitError.status === "error") {
        expect(isNetworkFailureError(rateLimitError.error)).toBe(true);
      }
      if (timeoutError.status === "error") {
        expect(isNetworkFailureError(timeoutError.error)).toBe(true);
      }
    });
  });

  describe("Domain 4: Simulation Failure", () => {
    it("classifies CONTRACT_SIMULATE_FAILED and SOROBAN_SIMULATION_FAILED as simulation failure", () => {
      const simError = err(
        SorokitErrorCode.CONTRACT_SIMULATE_FAILED,
        "Contract call reverted: Error(Contract, #1)",
        { revertCode: 1 },
      );

      expect(simError.status).toBe("error");
      if (simError.status === "error") {
        expect(isSimulationFailureError(simError.error)).toBe(true);
        expect(classifyErrorDomain(simError.error)).toBe("simulation_failure");
        expect(simError.error.category).toBe(SorokitErrorCategory.CONTRACT);
        expect(simError.error.recovery?.retryable).toBe(false);
      }
    });

    it("classifies TX_SIMULATE_FAILED as simulation failure", () => {
      const simError = err(
        SorokitErrorCode.TX_SIMULATE_FAILED,
        "Transaction simulation exceeded resource budget",
      );
      if (simError.status === "error") {
        expect(isSimulationFailureError(simError.error)).toBe(true);
      }
    });
  });

  describe("Domain 5: Ledger Execution Failure", () => {
    it("classifies TX_SUBMIT_FAILED and TX_SEQUENCE_CONFLICT as ledger execution failure", () => {
      const submitError = err(
        SorokitErrorCode.TX_SUBMIT_FAILED,
        "Transaction failed consensus with result code txINTERNAL_ERROR",
      );
      const seqError = err(
        SorokitErrorCode.TX_SEQUENCE_CONFLICT,
        "Sequence number mismatch: txBAD_SEQ",
      );

      if (submitError.status === "error") {
        expect(isLedgerExecutionError(submitError.error)).toBe(true);
        expect(classifyErrorDomain(submitError.error)).toBe("ledger_execution_failure");
      }

      if (seqError.status === "error") {
        expect(isLedgerExecutionError(seqError.error)).toBe(true);
        expect(classifyErrorDomain(seqError.error)).toBe("ledger_execution_failure");
      }
    });
  });

  describe("Boundary and Fallback Handling", () => {
    it("returns 'unknown' domain for unrecognized internal error codes", () => {
      const unknownError = err(
        SorokitErrorCode.UNKNOWN,
        "An unexpected error occurred",
      );
      if (unknownError.status === "error") {
        expect(classifyErrorDomain(unknownError.error)).toBe("unknown");
      }
    });

    it("sanitizes sensitive parameters in error context", () => {
      const errorWithContext = err(
        SorokitErrorCode.VALIDATION,
        "Validation error",
        undefined,
        undefined,
        {
          context: {
            operation: "testOp",
            parameters: {
              apiKey: "super-secret-key-123",
              password: "my-password",
              safeArg: "public-value",
            },
          },
        },
      );

      if (errorWithContext.status === "error") {
        expect(errorWithContext.error.context?.parameters).toEqual({
          apiKey: "[REDACTED]",
          password: "[REDACTED]",
          safeArg: "public-value",
        });
      }
    });
  });
});
