# Recipe 21: Multi-Endpoint Failover and Graceful Degradation

## Problem
In distributed environments, primary RPC or Horizon endpoints can become unavailable, rate-limited (HTTP 429), or lag behind the latest consensus ledger. You need:
1. Automatic failover to secondary endpoints without dropping requests.
2. Safe write patterns that prevent sequence conflicts or double submissions during failover.
3. Detection and mitigation of stale data reads when endpoints differ in ledger heights.
4. Automatic recovery once the primary endpoint returns to health.

## Solution
Configure `horizonEndpoints` and `rpcEndpoints` with primary and backup nodes when instantiating `createSorokitClient`. Implement high-water mark validation for queries sensitive to ledger skew, and query transaction status by deterministic hash before re-attempting timed-out submissions.

## Implementation Example

```typescript
import {
  createSorokitClient,
  checkNetworkHealth,
  type SorokitClient,
  type SorokitResult,
  type TransactionResult,
} from "sorokit-core";

/**
 * Initialize SorokitClient with multi-endpoint failover.
 * The first endpoint acts as primary; subsequent endpoints serve as backups.
 */
export function createResilientClient(): SorokitClient {
  const result = createSorokitClient({
    network: "testnet",
    horizonEndpoints: [
      "https://horizon-testnet.stellar.org",
      "https://horizon-backup.example.com",
    ],
    rpcEndpoints: [
      "https://soroban-testnet.stellar.org",
      "https://soroban-backup.example.com",
    ],
  });

  if (result.status === "error") {
    throw new Error(`Failed to initialize client: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Read account balance ensuring data does not lag behind a known high-water mark ledger.
 */
export async function getAccountWithStalenessCheck(
  client: SorokitClient,
  publicKey: string,
  minLedgerSequence?: number,
): Promise<SorokitResult<any>> {
  const accountResult = await client.account.get(publicKey);
  if (accountResult.status === "error") {
    return accountResult;
  }

  // If a minimum ledger sequence is specified, guard against stale reads
  if (minLedgerSequence !== undefined && accountResult.data.sequence !== undefined) {
    // Check if the endpoint state lags behind our minimum expected ledger sequence
    const currentSeq = Number(accountResult.data.sequence);
    if (currentSeq < minLedgerSequence) {
      return {
        status: "error",
        error: {
          code: "SERVICE_UNAVAILABLE" as any,
          message: `Endpoint returned stale data: sequence ${currentSeq} < expected ${minLedgerSequence}`,
        },
      };
    }
  }

  return accountResult;
}

/**
 * Safe transaction submission handling failover timeouts:
 * Checks transaction status by deterministic transaction hash before retrying.
 */
export async function safeSubmitWithFailover(
  client: SorokitClient,
  signedXdr: string,
  txHash: string,
): Promise<SorokitResult<TransactionResult>> {
  // First attempt submission
  const submitResult = await client.transaction.submit(signedXdr);

  if (submitResult.status === "ok") {
    return submitResult;
  }

  // If submission timed out or failed due to network disruption, check if the
  // transaction was already ingested and confirmed on another node
  const statusResult = await client.transaction.getStatus(txHash);
  if (statusResult.status === "ok" && statusResult.data.status === "success") {
    return {
      status: "ok",
      data: {
        hash: txHash,
        successful: true,
        ledger: statusResult.data.ledger,
      } as any,
    };
  }

  // If not confirmed and sequence became invalid, do not retry blindly;
  // return the structured error for rebuilding with fresh sequence.
  return submitResult;
}
```

## Health Checks and Switch Criteria

| Category | Policy / Behavior |
|---|---|
| **Health Probes** | Probed periodically via `client.network.checkHealth()` or background monitoring. Horizon uses `/ledgers?limit=1`; Soroban RPC uses `getHealth`. |
| **Switch Triggers** | Retryable HTTP statuses (`408`, `425`, `429`, `>= 500`) and socket disconnects trigger failover to backup endpoints. |
| **Quarantine & Recovery** | Deprioritized nodes remain in quarantine for `recoveryIntervalMs` (default: 30s) before receiving trial traffic. Successful responses immediately restore health. |
| **Safe Writes** | Transactions on Stellar have immutable, hash-identified envelopes. Always check hash status before rebuilding to avoid sequence conflicts. |
| **Ledger Skew** | Compare response ledger heights against known checkpoints to reject or alert on lagging replica nodes. |
