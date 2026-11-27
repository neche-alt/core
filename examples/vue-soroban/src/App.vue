<script setup lang="ts">
/**
 * Vue Soroban example — UI layer (#vue-soroban).
 *
 * Renders wallet connection, balance list, contract method selector, invoke
 * button, and progress indicator. All sorokit-core calls are in useContract.ts.
 * Simulation preview (fee + footprint before signing) is in useSimulation.ts.
 */

import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";
import { useContract } from "./useContract";
import { useSimulation } from "./useSimulation";

// Initialise SWK once per app — not per component render.
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

// Replace with a real contract ID on testnet.
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

// Soroban RPC endpoint — replace with your preferred testnet/mainnet URL.
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const {
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
} = useContract(kit, CONTRACT_ID, "testnet");

const {
  result: simResult,
  loading: simLoading,
  error: simError,
  simulate,
  reset: resetSim,
} = useSimulation();

const progressLabel: Record<string, string> = {
  idle: "",
  preparing: "Preparing transaction…",
  simulating: "Simulating transaction — estimating fees and validating inputs…",
  signing: "Approve in your wallet…",
  confirming: "Waiting for confirmation…",
  done: "Done",
};

async function handleSimulate() {
  if (!client.value || !walletState.value?.publicKey) return;
  resetSim();

  // Build a preview transaction XDR to simulate without signing it.
  const method = methods.value.find((m) => m.name === selectedMethod.value);
  if (!method) return;

  const prepared = await client.value.soroban.prepare({
    contractId: CONTRACT_ID,
    method: method.name,
    args: method.args,
    sourcePublicKey: walletState.value.publicKey,
  });

  if (prepared.status === "error") {
    // Surface the prepare error through the simulation error ref.
    await simulate(RPC_URL, NETWORK_PASSPHRASE, "");
    return;
  }

  await simulate(RPC_URL, NETWORK_PASSPHRASE, prepared.data.transactionXdr);
}

function handleInvoke() {
  const method = methods.value.find((m) => m.name === selectedMethod.value);
  if (method) invokeMethod(method.name, method.args);
}

function handleRead() {
  const method = methods.value.find((m) => m.name === selectedMethod.value);
  if (method) readMethod(method.name, method.args);
}
</script>

<template>
  <div class="app">
    <h1>sorokit-core — Vue contract</h1>

    <!-- Wallet panel -->
    <section>
      <template v-if="!walletState?.connected">
        <button @click="connect">Connect Freighter</button>
      </template>
      <template v-else>
        <p>
          <strong>Connected:</strong>
          <code>{{ walletState.publicKey }}</code>
        </p>
        <button @click="disconnect">Disconnect</button>
      </template>
    </section>

    <!-- Balances — shown once the wallet is connected -->
    <section v-if="balances.length > 0">
      <h2>Balances</h2>
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in balances"
            :key="`${b.assetCode}-${b.assetIssuer ?? 'native'}`"
          >
            <td>{{ b.assetCode }}</td>
            <td class="right">{{ b.balance }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Contract interaction — shown after wallet is connected -->
    <section v-if="walletState?.connected && methods.length > 0">
      <h2>Contract</h2>
      <label>
        Method
        <select v-model="selectedMethod">
          <option v-for="m in methods" :key="m.name" :value="m.name">
            {{ m.name }}
          </option>
        </select>
      </label>

      <div class="actions">
        <!-- read is free — no wallet prompt, no fee -->
        <button @click="handleRead" :disabled="progress !== 'idle'">
          Read (free)
        </button>
        <!-- simulate previews fee and footprint before signing -->
        <button
          @click="handleSimulate"
          :disabled="progress !== 'idle' || simLoading"
        >
          {{ simLoading ? "Simulating…" : "Simulate" }}
        </button>
        <!-- invoke requires signing and pays a fee -->
        <button
          @click="handleInvoke"
          :disabled="progress !== 'idle'"
          class="primary"
        >
          Invoke
        </button>
      </div>

      <!-- Simulation preview — shown after Simulate is clicked -->
      <div v-if="simResult" class="sim-preview">
        <h3>Simulation preview</h3>
        <table>
          <tbody>
            <tr>
              <td>Status</td>
              <td>{{ simResult.success ? "✅ Success" : "❌ Failed" }}</td>
            </tr>
            <tr>
              <td>Estimated fee</td>
              <td class="right">{{ simResult.feeXlm }} XLM ({{ simResult.fee }} stroops)</td>
            </tr>
            <tr v-if="simResult.fromFallback">
              <td colspan="2" class="warn">
                ⚠ Fee is an estimate — live simulation unavailable
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Simulation error -->
      <p v-if="simError" class="error">
        <strong>Simulation error:</strong> {{ simError }}
      </p>

      <!-- Progress indicator -->
      <p v-if="progress !== 'idle'" class="info">
        {{ progressLabel[progress] }}
      </p>

      <!-- Simulation feedback — shown after simulation and before signing -->
      <div
        v-if="simulationFeedback"
        :class="['sim-feedback', simulationFeedback.state === 'success' ? 'sim-ok' : 'sim-warn']"
      >
        <p class="sim-message">{{ simulationFeedback.message }}</p>
        <p v-if="simulationFeedback.fee" class="sim-fee">
          Estimated fee: <strong>{{ simulationFeedback.fee }} stroops</strong>
          <em> — a successful simulation is not a guarantee of execution.</em>
        </p>
        <p v-if="simulationFeedback.detail" class="sim-detail">
          {{ simulationFeedback.detail }}
        </p>
      </div>
    </section>

    <!-- Result -->
    <p v-if="result" class="result">
      <strong>Result:</strong> {{ result }}
    </p>

    <!-- Error -->
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.app {
  max-width: 480px;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

section {
  margin-bottom: 1.5rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
}

select {
  display: block;
  width: 100%;
  padding: 0.4rem;
  margin-top: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
}

th:last-child,
.right {
  text-align: right;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

button {
  padding: 0.5rem 1rem;
  cursor: pointer;
}

button.primary {
  background: #1a56db;
  color: white;
  border: none;
  border-radius: 4px;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.info {
  background: #eef6ff;
  padding: 0.75rem;
  border-radius: 6px;
}

.sim-preview {
  margin-top: 1rem;
  border: 1px solid #d1e3ff;
  border-radius: 6px;
  padding: 0.75rem;
  background: #f0f7ff;
}

.sim-preview h3 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}

.warn {
  color: #7a5c00;
  font-size: 0.85rem;
}

.result {
  background: #f4f4f5;
  padding: 0.75rem;
  border-radius: 6px;
  word-break: break-all;
}

.error {
  background: #fdecec;
  color: #8a1c1c;
  padding: 0.75rem;
  border-radius: 6px;
}

.sim-feedback {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-radius: 6px;
  border-left: 4px solid;
}

.sim-ok {
  background: #f0fdf4;
  border-color: #16a34a;
}

.sim-warn {
  background: #fefce8;
  border-color: #ca8a04;
}

.sim-message {
  font-weight: 600;
  margin: 0 0 0.25rem;
}

.sim-fee {
  margin: 0 0 0.25rem;
  font-size: 0.9em;
}

.sim-fee em {
  color: #6b7280;
}

.sim-detail {
  margin: 0;
  font-size: 0.9em;
  color: #92400e;
}
</style>
