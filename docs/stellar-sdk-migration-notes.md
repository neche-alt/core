# Stellar SDK Upgrade Migration & Peer Compatibility Notes

A comprehensive guide to supported upstream `@stellar/stellar-sdk` versions, compatibility expectations, breaking XDR shifts, and migration verification checks for `sorokit-core` integrators.

---

## 1. Supported Upstream Versions

`sorokit-core` declares `@stellar/stellar-sdk` as a peer dependency:

| SDK Version | Protocol Support | Compatibility Status | Release Notes / Verification |
|---|---|---|---|
| **`@stellar/stellar-sdk@13.3.0`** | Protocols 20, 21, 22 | âœ… Fully Supported (Target Peer) | Tested in CI; full Soroban RPC v22 support |
| **`@stellar/stellar-sdk@13.2.x`** | Protocols 20, 21 | âœ… Supported | Verified against core XDR types |
| **`@stellar/stellar-sdk@13.0.x - 13.1.x`** | Protocols 20, 21 | âš ï¸  Compatible with deprecations | Simulation response payload differences |
| **`@stellar/stellar-sdk@<13.0.0` (v11/v12)** | Protocol 20 early drafts | â Œ Unsupported | Breaking XDR and RPC class structures |

---

## 2. Compatibility Expectations & SemVer Boundary

### How Sorokit Core Insulates Consumers

`sorokit-core` acts as a framework-agnostic execution layer. While it utilizes `@stellar/stellar-sdk` internally for transaction serialization and XDR handling:

1. **Structured Errors (`SorokitResult<T>`)**: We never throw raw SDK exceptions across the public API boundary. All Horizon or Soroban RPC errors are classified into stable `SorokitErrorCode` enums.
2. **Abstract Wallet Adapters**: Changes to underlying wallet injection APIs (e.g., Freighter API updates) are contained inside adapters.
3. **Stable Common Types**: Account balances, network configurations, and transaction results have permanent TypeScript definitions independent of upstream SDK changes.

---

## 3. Upstream Evolution: Key Breaking Changes (v12 â†’ v13)

When upgrading legacy Stellar projects to `@stellar/stellar-sdk` v13 and `sorokit-core`:

### A. Horizon Server vs. Soroban RPC Separation
- **Old (v11/v12):** Horizon `Server` mixed classical Stellar operations with early Soroban endpoints.
- **New (v13):** Horizon `Server` is dedicated to classic Stellar ledger queries, while `rpc.Server` handles Soroban RPC. `sorokit-core` manages this split transparently through `client.networkConfig`.

### B. Address and ScVal Handling
- **Old (v12):** Manipulated raw `xdr.ScAddress` or keypair buffers directly.
- **New (v13):** Uses `Address` and `nativeToScVal`:
  ```ts
  import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

  // Address conversion
  const scAddress = new xdr.ScVal.scvAddress(
    Address.fromString("GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV").toScAddress()
  );

  // BigInt conversion for i128
  const amountScVal = nativeToScVal(1000000n, { type: "i128" });
  ```

### C. Simulation Response Format
- **v13 Changes:** Simulation results provide granular resource bounds (CPU instructions, memory bytes, and ledger read/write bytes) and an explicit `auth` tree for authorization entries.

---

## 4. Migration Verification Checklist for Integrators

Follow these verification checks when upgrading your project's dependencies:

1. **Audit `package.json`**:
   - Ensure `@stellar/stellar-sdk` matches `^13.0.0` or `13.3.0`.
   - Ensure `@creit.tech/stellar-wallets-kit` is `>=1.0.0` if using browser wallet adapters.
2. **Verify XDR Serialization Roundtrip**:
   - Verify that all custom contract arguments convert to valid `xdr.ScVal` without runtime exceptions.
3. **Check Network Passphrases**:
   - Testnet: `"Test SDF Network ; September 2015"`
   - Mainnet: `"Public Global Stellar Network ; July 2015"`
4. **Execute Compatibility Tests**:
   - Run our automated test suite for XDR and version compatibility:
     ```bash
     npm test src/tests/stellarSdkMigration.test.ts
     ```

---

## 5. Related Test References

- [`src/tests/stellarSdkMigration.test.ts`](../src/tests/stellarSdkMigration.test.ts): Verifies ScVal conversions, XDR envelope parsing, and version boundary conditions.
- [`src/tests/validation.test.ts`](../src/tests/validation.test.ts): Validates address formats, hashes, and network configurations.
