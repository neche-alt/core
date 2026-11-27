# Sorokit Core API Reference

`sorokit-core` is a framework-independent TypeScript SDK for Stellar wallets,
accounts, transactions, and Soroban contracts.

Start with {@link createSorokitClient} to create a client. Browse its
{@link SorokitClient} interface for wallet, account, transaction, Soroban, and
network operations. All public methods return {@link SorokitResult} values.

```ts
import { createSorokitClient } from "sorokit-core";

const result = createSorokitClient({ network: "testnet" });
if (result.status === "ok") {
  const client = result.data;
  console.log(client.network.getConfig());
}
```

---

## Task-Based Navigation

Find what you need by task rather than navigating individual modules:

### 1. Connect a Wallet and Manage Sessions
- **Client Entrypoint**: {@link createSorokitClient} → `client.wallet`
- **Adapters**: {@link FreighterAdapter}, {@link LobstrAdapter}, {@link XBullAdapter}, {@link RabetAdapter}
- **Operations**: `client.wallet.connect`, `client.wallet.disconnect`, `client.wallet.signTransaction`
- **Related Recipes**:
  - [Key rotation and multi-account security](recipes/08-key-rotation.md)
  - [Account recovery patterns](recipes/10-account-recovery.md)

### 2. Check Balances, Accounts, and Trustlines
- **Client Entrypoint**: `client.account`
- **Operations**: `client.account.get`, `client.account.getBalances`, `client.account.stream`
- **Related Recipes**:
  - [Trustline management and asset balances](recipes/11-trustline-management.md)
  - [Real-time balance alerts and streaming](recipes/13-balance-alerts-streaming.md)

### 3. Build, Estimate Fees, and Submit Transactions
- **Client Entrypoint**: `client.transaction`
- **Key Functions**: {@link buildPaymentTransaction}, {@link submitTransaction}, {@link estimateFee}
- **Operations**: `client.transaction.buildPayment`, `client.transaction.submit`, `client.transaction.estimateFee`
- **Related Recipes**:
  - [Fee estimation and surge pricing](recipes/15-fee-estimation.md)
  - [Batch payments and multi-operation envelopes](recipes/05-batch-payment.md)
  - [Payments with structured memos](recipes/09-payment-with-memo.md)
  - [Multi-signature approval workflows](recipes/01-multisig-approval.md)

### 4. Read, Simulate, and Invoke Soroban Contracts
- **Client Entrypoint**: `client.soroban`
- **Key Functions**: {@link readContract}, {@link simulateContractSafe}, {@link invokeContract}, {@link buildContractDeploy}
- **Operations**: `client.soroban.read`, `client.soroban.simulate`, `client.soroban.invoke`
- **Related Recipes**:
  - [Soroban contract invocation and parameter encoding](recipes/04-soroban-invoke.md)
  - [Contract deployment with preflight validation](recipes/14-contract-deployment.md)
  - [NFT minting on Soroban](recipes/20-nft-minting.md)

### 5. DEX Swaps, Offers, and Path Payments
- **Client Entrypoint**: `client.transaction`
- **Operations**: `client.transaction.buildPathPayment`
- **Related Recipes**:
  - [DEX atomic swaps](recipes/03-dex-atomic-swap.md)
  - [Offer management and limit orders](recipes/07-offer-management.md)
  - [Path payments and liquidity routing](recipes/12-path-payment.md)
  - [Smart order DEX routing](recipes/19-dex-routing.md)

### 6. Configure Networks and Endpoints
- **Client Entrypoint**: `client.network`
- **Key Functions**: {@link resolveNetwork}, {@link NETWORK_DEFAULTS}
- **Operations**: `client.network.getConfig`, `client.network.setNetwork`
- **Related Documentation**:
  - [Architecture and boundary rules](architecture.md)
  - [End-to-end task workflows](workflows.md)

---

## Guides and Documentation

- [Getting started and SDK usage](https://github.com/TochukwuJustice/core#readme)
- [Task-oriented workflows](workflows.md)
- [Architecture guide](architecture.md)
- [Recipes and Cookbook index](recipes/README.md)

To regenerate this reference locally, run `npm ci --legacy-peer-deps` and
`npm run docs`, then open `docs/api/index.html`. Generated files are not committed.
