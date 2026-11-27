# Recipe 22 – Contract Upgrade and Version Verification

Contracts can be upgraded by their administrator. If your application hard-codes
assumptions about a contract's ABI or business logic, an unexpected upgrade can
cause silent data corruption or fund loss. This recipe shows how to detect
version changes before invoking sensitive methods, and what client-side
verification cannot guarantee.

## Prerequisites

```ts
import {
  getContractVersion,
  recordObservation,
  invalidateContractVersionCache,
  resetContractVersionTracking,
  getContractVersionHistory,
  type ContractVersionOptions,
  type ContractUpgradeEvent,
} from "sorokit-core/soroban/contractVersion";
```

---

## 1. Fetch and record the current version

`getContractVersion` reads the `contractmetav0` Wasm custom section, caches the
result for 1 hour by default, and automatically calls `recordObservation` to
track any change.

```ts
const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = "CEXAMPLECONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const result = await getContractVersion(RPC_URL, CONTRACT_ID);
if (result.status === "error") {
  console.error("Could not read contract version:", result.error.message);
} else {
  console.log("Observed version:", result.data.version ?? "(none)");
}
```

A `version` of `null` means the deployed contract exposes no version metadata —
it is **not** an error, and it is **not** treated as an upgrade.

---

## 2. Guard sensitive operations with an expected version

Pin the version your application was built against and abort any call if the
observed version differs.

```ts
const EXPECTED_VERSION = "v1.4.2";

async function transferTokens(amount: bigint) {
  const result = await getContractVersion(RPC_URL, CONTRACT_ID);
  if (result.status === "error") {
    throw new Error(`Version check failed: ${result.error.message}`);
  }

  const observed = result.data.version;
  if (observed !== EXPECTED_VERSION) {
    throw new Error(
      `Contract version mismatch: expected ${EXPECTED_VERSION}, ` +
      `observed ${observed ?? "(none)"}. Halting transfer.`
    );
  }

  // Safe to proceed — version matches.
  await invokeTransfer(amount);
}
```

---

## 3. React to upgrades with `onContractUpgrade`

Pass an `onContractUpgrade` callback in `ContractVersionOptions` to receive a
single notification each time the observed version changes to a new non-null
value.

```ts
const opts: ContractVersionOptions = {
  onContractUpgrade: (event: ContractUpgradeEvent) => {
    console.warn(
      `Contract ${event.contractId} upgraded: ` +
      `${event.previousVersion} → ${event.currentVersion}`
    );
    // Invalidate application-level caches, disable UI, alert operators, etc.
    disableSensitiveFeatures();
  },
};

await getContractVersion(RPC_URL, CONTRACT_ID, opts);
```

The callback fires **exactly once per version change**. It does not fire for:
- the first observation of a contract (no previous version to compare against),
- observations where `version` is `null` (metadata absent),
- repeated calls where the version has not changed.

---

## 4. Force a fresh version check

The default TTL is 1 hour. To bypass the cache and re-fetch immediately — for
example, right before a high-value operation — call `invalidateContractVersionCache`
first.

```ts
// Evict the cached entry so the next getContractVersion goes to the network.
invalidateContractVersionCache(CONTRACT_ID);

const freshResult = await getContractVersion(RPC_URL, CONTRACT_ID, opts);
```

Pass a `SorokitCache` instance as the second argument if you are using an
external cache store.

---

## 5. Inspect the full version history

`getContractVersionHistory` returns every distinct version observed in the
current process, ordered chronologically (oldest first), capped at 100 entries.

```ts
const history = getContractVersionHistory(CONTRACT_ID);

for (const entry of history) {
  console.log(
    entry.observedAt,
    entry.version,
    entry.isUpgrade ? "(upgrade)" : "(initial)"
  );
}
```

---

## 6. Reset tracking state

`resetContractVersionTracking` wipes the in-memory observed-version record and
history. The next observation is treated as the initial one — no upgrade
callback fires.

```ts
// Useful in tests or after deliberate re-deployment.
resetContractVersionTracking(CONTRACT_ID);
```

---

## What client-side metadata alone cannot prove

The checks above rely on the `contractmetav0` custom section embedded in the
contract Wasm. Treat these as advisory signals, not cryptographic guarantees.

| Claim | Why it cannot be proven client-side |
|---|---|
| **The deployer's identity** | The `version` string is a free-form field that any deployer can set to any value. There is no on-chain attestation that ties it to a specific build pipeline or key. |
| **Wasm hash matches your build exactly** | `getContractVersion` does not download and hash the full Wasm binary. To verify the hash you must call `fetchContractWasm`, compute the SHA-256 yourself, and compare it against a known-good value from your own build artifacts. |
| **Real-time upgrade status mid-transaction** | The version is fetched before the transaction is submitted. An upgrade that occurs after the fetch but before the transaction is finalized will not be detected by this check. Use short TTLs and invalidate aggressively for high-value flows. |
| **That `null` means the contract is unversioned and not upgraded** | A contract that deliberately omits version metadata is indistinguishable (via this API) from one that never had it. `null` is a signal that no metadata was found, not that the contract is safe. |
| **That the observed version is monotonically increasing** | `sorokit-core` records whatever string appears in the metadata. A malicious or buggy upgrade could publish a lower version string, or reuse a prior one. Compare against your pinned expected version rather than assuming higher is safer. |

---

## Safe-call pattern (complete example)

```ts
import {
  getContractVersion,
  invalidateContractVersionCache,
  type ContractVersionOptions,
  type ContractUpgradeEvent,
} from "sorokit-core/soroban/contractVersion";

const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = "CEXAMPLECONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const PINNED_VERSION = "v2.1.0";

let sensitiveFeaturesEnabled = true;

const versionOpts: ContractVersionOptions = {
  onContractUpgrade: (event: ContractUpgradeEvent) => {
    console.warn(`Upgrade detected: ${event.previousVersion} → ${event.currentVersion}`);
    sensitiveFeaturesEnabled = false; // Block until operator review.
  },
};

async function safeInvoke(fn: () => Promise<void>): Promise<void> {
  // Always invalidate before high-value operations to bypass the TTL cache.
  invalidateContractVersionCache(CONTRACT_ID);

  const versionResult = await getContractVersion(RPC_URL, CONTRACT_ID, versionOpts);
  if (versionResult.status === "error") {
    throw new Error(`Cannot verify contract version: ${versionResult.error.message}`);
  }

  const observed = versionResult.data.version;
  if (observed !== PINNED_VERSION) {
    throw new Error(
      `Version mismatch — expected ${PINNED_VERSION}, got ${observed ?? "(none)"}. ` +
      `Aborting call.`
    );
  }

  if (!sensitiveFeaturesEnabled) {
    throw new Error("Sensitive features disabled after upgrade detection.");
  }

  await fn();
}

// Usage:
await safeInvoke(() => submitHighValueTransaction(/* ... */));
```

---

## Related

- [ADR 004 – Contract interaction patterns](../adr/004-contract-interaction-patterns.md)
- [Recipe 14 – Contract deployment](14-contract-deployment.md)
- [Recipe 15 – Fee estimation](15-fee-estimation.md)
- [Contract event archival](../contract-event-archival.md)
