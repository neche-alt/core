/**
 * Vue Soroban example — composable (#vue-soroban).
 *
 * Handles wallet connection, Soroban contract invocation with progress
 * reporting, and account state streaming. The composable returns plain refs
 * so App.vue can stay template-focused without any sorokit-core imports.
 *
 * In your own app the SDK imports below become:
 *   import { createSorokitClient, FreighterAdapter, ... } from "sorokit-core";
 */

import { ref, onUnmounted } from "vue";
import { createSorokitClient } from "../../../src/client/createSorokitClient";
import { FreighterAdapter } from "../../../src/wallet/adapters/freighter";
import type { SorokitClient } from "../../../src/client/createSorokitClient";
import type { WalletState, SWKInstance } from "../../../src/wallet/types";
import type { AssetBalance } from "../../../src/account/types";
import type { NetworkType } from "../../../src/network/config";
import type { ScVal } from "@stellar/stellar-sdk";
import {
  buildPendingEvent,
  buildSimulationProgressEvent,
  buildRpcErrorEvent,
  type SimulationProgressEvent,
} from "../../../src/soroban/simulationFeedback";

export type InvokeProgress = "idle" | "preparing" | "simulating" | "signing" | "confirming" | "done";

export interface ContractMethod {
  name: string;
  /** Pre-built args for this demo — a real app would collect them from a form */
  args: ScVal[];
}

export function useContract(
  swkInstance: SWKInstance,
  contractId: string,
  network: NetworkType = "testnet",
) {
  // ── client ──────────────────────────────────────────────────────────────────
  const clientResult = createSorokitClient({ network });
  const client = ref<SorokitClient | null>(
    clientResult.status === "ok" ? clientResult.data : null,
  );
  if (clientResult.status === "error") {
    console.error("[sorokit] client init failed:", clientResult.error.message);
  }

  const adapter = new FreighterAdapter(swkInstance);

  // ── state ────────────────────────────────────────────────────────────────────
  const walletState = ref<WalletState | null>(null);
  const balances = ref<AssetBalance[]>([]);
  const methods = ref<ContractMethod[]>([]);
  const selectedMethod = ref<string>("");
  const progress = ref<InvokeProgress>("idle");
  const result = ref<string | null>(null);
  const error = ref<string | null>(null);
  /** Current simulation feedback event — shown before the user is asked to sign. */
  const simulationFeedback = ref<SimulationProgressEvent | null>(null);

  // AbortController for the account stream — cancelled when the component unmounts.
  let streamController: AbortController | null = null;

  // ── wallet ───────────────────────────────────────────────────────────────────
  async function connect() {
    if (!client.value) return;
    error.value = null;

    const conn = await client.value.wallet.connect(adapter);
    if (conn.status === "error") {
      error.value = conn.error.message;
      return;
    }
    walletState.value = conn.data;

    if (conn.data.publicKey) {
      await refreshBalances(conn.data.publicKey);
      startStream(conn.data.publicKey);
    }

    await loadMethods();
  }

  async function disconnect() {
    if (!client.value) return;
    streamController?.abort();
    await client.value.wallet.disconnect(adapter);
    walletState.value = null;
    balances.value = [];
  }

  // ── balances ─────────────────────────────────────────────────────────────────
  async function refreshBalances(publicKey: string) {
    if (!client.value) return;
    const bal = await client.value.account.getBalances(publicKey);
    if (bal.status === "ok") balances.value = bal.data;
  }

  // ── account stream ────────────────────────────────────────────────────────────
  function startStream(publicKey: string) {
    if (!client.value) return;
    streamController?.abort();
    streamController = new AbortController();
    const signal = streamController.signal;

    // Run the stream in the background — no awaiting so the UI doesn't block.
    (async () => {
      for await (const update of client.value!.account.stream(
        publicKey,
        { intervalMs: 5000 },
        signal,
      )) {
        if (update.status === "ok") {
          balances.value = update.data.balances;
        }
      }
    })();
  }

  // ── contract methods ─────────────────────────────────────────────────────────
  async function loadMethods() {
    if (!client.value) return;
    const meta = await client.value.soroban.getContractMethods(contractId);
    if (meta.status === "ok") {
      // Map the SDK's ContractMethod list to the shape the UI needs.
      methods.value = meta.data.map((m) => ({ name: m.name, args: [] }));
      if (methods.value.length > 0) {
        selectedMethod.value = methods.value[0]!.name;
      }
    }
  }

  // ── invoke ────────────────────────────────────────────────────────────────────
  async function invokeMethod(methodName: string, args: ScVal[] = []) {
    if (!client.value || !walletState.value?.publicKey) {
      error.value = "Connect a wallet first";
      return;
    }

    progress.value = "preparing";
    result.value = null;
    error.value = null;
    simulationFeedback.value = null;

    // ── Simulate first and show feedback before asking the user to sign ────────
    // The prepare step internally runs simulation; we surface feedback here so
    // the user can review estimated fees and any validation issues before the
    // wallet prompt appears.
    progress.value = "simulating";
    simulationFeedback.value = buildPendingEvent();

    const prepared = await client.value.soroban.prepare({
      contractId,
      method: methodName,
      args,
      sourcePublicKey: walletState.value.publicKey,
    });

    if (prepared.status === "error") {
      // Treat a prepare/simulation failure as a validation error so the message
      // is actionable rather than a raw SDK error code.
      simulationFeedback.value = buildRpcErrorEvent(prepared.error.message);
      error.value = simulationFeedback.value.detail ?? prepared.error.message;
      progress.value = "idle";
      return;
    }

    // Surface the simulated fee — never imply this guarantees execution.
    simulationFeedback.value = buildSimulationProgressEvent({
      success: true,
      fee: prepared.data.fee,
    });

    // Only proceed to signing after the user has seen the simulation result.
    progress.value = "signing";

    const invoked = await client.value.soroban.invoke(
      {
        contractId,
        method: methodName,
        args,
        sourcePublicKey: walletState.value.publicKey,
      },
      async (xdr) => {
        // The sign callback fires after preparation is complete.
        progress.value = "signing";
        return client.value!.wallet.signTransaction(adapter, {
          transactionXdr: xdr,
          networkPassphrase: client.value!.networkConfig.networkPassphrase,
        });
      },
    );

    // The SDK polls until the transaction settles before returning, so by the
    // time we get here the result is the confirmed tx hash (or an error).
    if (invoked.status === "error") {
      error.value = `${invoked.error.code}: ${invoked.error.message}`;
      progress.value = "idle";
      return;
    }

    progress.value = "done";
    result.value = invoked.data; // tx hash

    // Refresh balances so any token transfer is reflected immediately.
    if (walletState.value.publicKey) {
      await refreshBalances(walletState.value.publicKey);
    }
  }

  // ── read (no signature) ────────────────────────────────────────────────────────
  async function readMethod(methodName: string, args: ScVal[] = []) {
    if (!client.value || !walletState.value?.publicKey) return;
    error.value = null;

    const read = await client.value.soroban.read({
      contractId,
      method: methodName,
      args,
      sourcePublicKey: walletState.value.publicKey,
    });

    if (read.status === "error") {
      error.value = read.error.message;
    } else {
      result.value = JSON.stringify(read.data.result);
    }
  }

  // Tear down the stream when the component using this composable unmounts.
  onUnmounted(() => streamController?.abort());

  return {
    client,
    walletState,
    balances,
    methods,
    selectedMethod,
    progress,
    result,
    error,
    simulationFeedback,
    connect,
    disconnect,
    invokeMethod,
    readMethod,
    refreshBalances,
  };
}
