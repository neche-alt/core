/**
 * Soroban Contract Invocation Recipe Example
 *
 * Demonstrates:
 * 1. Typed ScVal argument preparation for Soroban contract calls
 * 2. Read-only invocation without wallet signing
 * 3. Write invocation with simulation, authorization, and signing
 * 4. Structured failure interpretation
 */

import { createSorokitClient, FreighterAdapter } from "../src/index";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export async function runContractReadExample(contractId: string, accountPublicKey: string) {
  const clientRes = createSorokitClient({ network: "testnet" });
  if (clientRes.status === "error") {
    return { success: false, error: clientRes.error.message };
  }
  const client = clientRes.data;

  const addressScVal = new xdr.ScVal.scvAddress(
    Address.fromString(accountPublicKey).toScAddress()
  );

  const readRes = await client.soroban.read({
    contractId,
    method: "balance",
    args: [addressScVal],
  });

  if (readRes.status === "error") {
    return { success: false, error: readRes.error.message, code: readRes.error.code };
  }

  return { success: true, result: readRes.data.result };
}

export async function runContractWriteExample(
  contractId: string,
  swkInstance: any,
  recipientPublicKey: string,
  amount: bigint
) {
  const clientRes = createSorokitClient({ network: "testnet" });
  if (clientRes.status === "error") {
    return { success: false, error: clientRes.error.message };
  }
  const client = clientRes.data;
  const adapter = new FreighterAdapter(swkInstance);

  const connRes = await client.wallet.connect(adapter);
  if (connRes.status === "error") {
    return { success: false, error: connRes.error.message };
  }

  const senderPublicKey = connRes.data.publicKey;
  const invokeRes = await client.soroban.invoke(
    {
      contractId,
      method: "transfer",
      sourcePublicKey: senderPublicKey,
      args: [
        new xdr.ScVal.scvAddress(Address.fromString(senderPublicKey).toScAddress()),
        new xdr.ScVal.scvAddress(Address.fromString(recipientPublicKey).toScAddress()),
        nativeToScVal(amount, { type: "i128" }),
      ],
    },
    async (unsignedXdr) => {
      const signRes = await client.wallet.signTransaction(adapter, {
        transactionXdr: unsignedXdr,
        networkPassphrase: client.networkConfig.networkPassphrase,
      });
      if (signRes.status === "error") throw new Error(signRes.error.message);
      return signRes.data;
    }
  );

  if (invokeRes.status === "error") {
    return { success: false, error: invokeRes.error.message, code: invokeRes.error.code };
  }

  return { success: true, txHash: invokeRes.data };
}
