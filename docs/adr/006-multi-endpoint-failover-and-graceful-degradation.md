# ADR-006: Multi-Endpoint Failover and Graceful Degradation Strategy

## Status
Accepted

## Context
Production Stellar and Soroban applications rely on high availability for querying ledger state, simulating contract calls, and submitting transactions. While configuring multiple fallback endpoints (e.g. primary Horizon/RPC nodes with secondary backup providers) protects applications against transient outages and 5xx errors, multi-node failover introduces subtle consistency and state synchronization challenges:
1. **Ledger Height Skew:** Different node providers or geographically distributed nodes may sync at slightly different speeds or lag behind the current consensus ledger.
2. **Stale Data Ingestion:** Failing over to an endpoint that is lagging can cause applications to read stale account balances, outdated contract storage entries, or outdated sequence numbers.
3. **Transaction Submission & Safe Writes:** Retrying non-idempotent or sequence-sensitive operations across nodes can result in sequence errors (`tx_bad_seq`), double-spends, or false submission failures when a transaction has already been ingested into the mempool of the original node.
4. **Endpoint Capabilities:** Nodes in a pool may have different historical retention windows (e.g., archival vs. non-archival nodes) or different Soroban RPC method support / rate limits.

## Decision

We document and standardize graceful degradation principles and configuration patterns for multi-endpoint failover across `sorokit-core`:

### 1. Health Checks & Probing
- **Horizon Endpoints:** Probed via lightweight GET requests to `/ledgers?limit=1`.
- **Soroban RPC Endpoints:** Probed using JSON-RPC `getHealth` requests rather than root GET requests (which return 404/405).
- Probing tracks rolling latency (exponential moving average or sample latency), consecutive failure counts, and uptime status.

### 2. Switch Criteria
- Failover switches away from an active endpoint when:
  - An HTTP request returns a retryable status: `408 Request Timeout`, `425 Too Early`, `429 Too Many Requests`, or server error `>= 500`.
  - A low-level network failure occurs (DNS resolution failure, connection reset, connection refused, or socket timeout).
  - Consecutive failures reach or exceed the configured `failureThreshold` (default: 2).
- Non-retryable 4xx client errors (e.g., `400 Bad Request`, `404 Not Found`) do **not** trigger endpoint switching, as they represent request or resource errors, not node unavailability.

### 3. Recovery Protocol
- Unhealthy or deprioritized endpoints enter a quarantine period defined by `recoveryIntervalMs` (default: 30,000 ms).
- Once the recovery interval elapses, the endpoint becomes eligible as a candidate for retry.
- A candidate endpoint is not prematurely flipped to healthy by timer alone; instead, it proves recovery on its next successful request or background health probe (`markSuccess`), which resets the failure counter.

### 4. Data Consistency & Stale Read Mitigation
- **Verify Ledger Sequence on Read:** When performing critical business reads across failovers, inspect the `ledger` or `latestLedger` sequence returned by the endpoint against the application's last observed high-water mark.
- **Tolerate Bounded Staleness:** For read-only queries (e.g., displaying dashboard metrics or non-critical activity), applications may gracefully display data with a timestamp indicator if all available endpoints report mild lag.
- **Fail Closed on Severe Skew:** For operations requiring state proofs or sequential progression, reject or requery if an endpoint returns a ledger height lower than the known high-water mark.

### 5. Safe Write Handling
- **Idempotent Submission Hash:** Transaction hashes on Stellar are strictly deterministic based on the signed transaction envelope. If an endpoint times out during submission, check the transaction status by hash across endpoints before re-signing or incrementing sequence numbers.
- **Sequence Number Invalidation:** Never reuse cached account sequence numbers after a failover failure. Always reload account state with `client.account.get(publicKey)` or `loadAccount` before rebuilding a transaction.
- **Simulation Consistency:** When simulating Soroban transactions (`simulate`), ensure the simulation and the subsequent submission target nodes with consistent protocol and state capabilities.

## Consequences
- Developers have clear, actionable guidance on configuring primary and backup endpoints safely.
- Application architectures avoid common pitfalls such as sequence race conditions or acting on stale ledger snapshots.
- Public APIs and SDK interfaces remain framework-agnostic and backwards-compatible.
