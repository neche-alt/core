import { describe, expect, it } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { interpretContractFailure } from "../soroban/contractFailureInterpreter";
import { createSorokitClient } from "../client/createSorokitClient";
import { SorokitErrorCode } from "../shared/response";
import type { SorokitError } from "../shared/response";

describe("Soroban Contract Invocation Cookbook", () => {
  describe("Typed argument conversions", () => {
    it("converts primitives and addresses into valid xdr.ScVal representations", () => {
      const u32Val = nativeToScVal(12345, { type: "u32" });
      expect(u32Val.switch()).toBe(xdr.ScValType.scvU32());
      expect(u32Val.u32()).toBe(12345);

      const boolVal = nativeToScVal(true, { type: "bool" });
      expect(boolVal.switch()).toBe(xdr.ScValType.scvBool());
      expect(boolVal.b()).toBe(true);

      const symbolVal = xdr.ScVal.scvSymbol("mint");
      expect(symbolVal.switch()).toBe(xdr.ScValType.scvSymbol());
      expect(symbolVal.sym().toString()).toBe("mint");

      const pubKey = "GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV";
      const scAddress = new xdr.ScVal.scvAddress(Address.fromString(pubKey).toScAddress());
      expect(scAddress.switch()).toBe(xdr.ScValType.scvAddress());
    });
  });

  describe("Failure interpretation", () => {
    it("correctly decodes CONTRACT_NOT_FOUND error domain", () => {
      const err: SorokitError = {
        code: SorokitErrorCode.CONTRACT_NOT_FOUND,
        message: "Contract C123 not found on ledger",
      };
      const interpretation = interpretContractFailure(err);
      expect(interpretation).toContain("The target contract does not exist");
    });

    it("correctly decodes SIMULATION_FAILED error with contract cause", () => {
      const err: SorokitError = {
        code: SorokitErrorCode.SIMULATION_FAILED,
        message: "HostError: Error(Contract, #1)",
      };
      const interpretation = interpretContractFailure(err);
      expect(interpretation).toContain("Contract simulation failed");
      expect(interpretation).toContain("HostError: Error(Contract, #1)");
    });

    it("correctly decodes sequence conflict failure", () => {
      const err: SorokitError = {
        code: SorokitErrorCode.TX_SUBMIT_FAILED,
        message: "Transaction failed: tx_bad_seq",
      };
      const interpretation = interpretContractFailure(err);
      expect(interpretation).toContain("Transaction sequence conflict");
    });

    it("handles boundary case for wallet sign rejection", () => {
      const err: SorokitError = {
        code: SorokitErrorCode.WALLET_SIGN_FAILED,
        message: "User declined transaction signature",
      };
      const interpretation = interpretContractFailure(err);
      expect(interpretation).toContain("Wallet rejected");
    });

    it("handles boundary case for timeout error", () => {
      const err: SorokitError = {
        code: SorokitErrorCode.TIMEOUT,
        message: "Poll status timed out after 30000ms",
      };
      const interpretation = interpretContractFailure(err);
      expect(interpretation).toContain("Network latency or timeout");
    });
  });

  describe("Client contract method validation boundary cases", () => {
    it("returns error result when invoking with invalid contract address format", async () => {
      const clientRes = createSorokitClient({ network: "testnet" });
      expect(clientRes.status).toBe("ok");
      if (clientRes.status !== "ok") return;

      const client = clientRes.data;
      const readRes = await client.soroban.read({
        contractId: "invalid-contract-id",
        method: "test",
        args: [],
      });

      expect(readRes.status).toBe("error");
      expect(readRes.error).toBeDefined();
    });
  });
});
