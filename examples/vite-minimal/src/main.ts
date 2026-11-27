/**
 * Minimal Vite + TypeScript example for sorokit-core.
 *
 * Intentionally imports ONLY sorokit-core/transaction and sorokit-core/network.
 * The analyze-consumer-bundle.mjs script verifies that wallet adapter code
 * (freighter, xbull, lobstr, WalletConnect, discoverAvailableWallets, etc.)
 * does NOT appear in the production bundle produced by this file.
 */
import { NETWORK_DEFAULTS } from "sorokit-core/network";
import { buildPaymentTransaction } from "sorokit-core/transaction";

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app element");

const testnet = NETWORK_DEFAULTS.testnet;
const mainnet = NETWORK_DEFAULTS.mainnet;

app.innerHTML = `
  <h1>Sorokit Core — Vite Minimal Example</h1>

  <section>
    <h2>Network Defaults</h2>
    <ul>
      <li><strong>Testnet Horizon:</strong> <code>${testnet.horizonUrl}</code></li>
      <li><strong>Testnet RPC:</strong> <code>${testnet.rpcUrl}</code></li>
      <li><strong>Mainnet Horizon:</strong> <code>${mainnet.horizonUrl}</code></li>
      <li><strong>Mainnet RPC:</strong> <code>${mainnet.rpcUrl}</code></li>
    </ul>
  </section>

  <section>
    <h2>Transaction Builder</h2>
    <p>
      <code>buildPaymentTransaction</code> is available:
      <code>${typeof buildPaymentTransaction}</code>
    </p>
  </section>

  <p>
    <em>
      This app imports only <code>sorokit-core/network</code> and
      <code>sorokit-core/transaction</code>. Run
      <code>node scripts/analyze-consumer-bundle.mjs</code> from the repo root
      to verify that wallet adapter code is absent from the bundle.
    </em>
  </p>
`;

console.log("[sorokit] Loaded network defaults:", { testnet, mainnet });
console.log("[sorokit] Transaction builder type:", typeof buildPaymentTransaction);
