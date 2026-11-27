# Security Model, Trust Boundaries & Key-Handling Guide

A comprehensive security architecture reference for `sorokit-core` integrators, detailing trust boundaries, secret handling, automated redaction, and mainnet safeguards.

---

## 1. The Four Trust Boundaries

When building applications on Stellar and Soroban, execution spans distinct trust zones with fundamentally different security guarantees:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” 
â”‚  1. Browser Client Boundary (Untrusted Runtime)                   â”‚
â”‚  â€¢ Operates on public keys (G...) and contract IDs (C...) only     â”‚
â”‚  â€¢ Zero secret key (S...) or mnemonic storage                      â”‚
â”‚  â€¢ Signing delegated to external wallet extensions via XDR         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â”‚
               unsigned XDR       â”‚       signed XDR
              â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¶
                                  â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” 
â”‚  2. Server-Side Execution Boundary (Trusted Infrastructure)       â”‚
â”‚  â€¢ Hardware security modules (KMS/HSM) or injected environment vars â”‚
â”‚  â€¢ Relayer accounts, automated keepers, and backend signers       â”‚
â”‚  â€¢ Strict isolation from public web endpoints                     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” 
â”‚  3. Diagnostics & Telemetry Boundary (Logging/Monitoring)         â”‚
â”‚  â€¢ Automatic redaction of seeds, secret keys, passwords, tokens   â”‚
â”‚  â€¢ Structured context sanitization (sanitizeErrorContext)         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” 
â”‚  4. Network & Mainnet Safeguard Boundary (Ledger Protection)      â”‚
â”‚  â€¢ Network passphrase validation                                 â”‚
â”‚  â€¢ Mandatory preflight simulation before broadcast                â”‚
â”‚  â€¢ Strict address and checksum verification                       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 2. Browser Client Trust Boundary

Frontend applications operate in an untrusted environment where browser extensions, malicious scripts, and devtools can inspect memory.

### Rules for Frontend Integrators

1. **Never load or store raw secret seeds (`S...`) or mnemonics in the browser.**
   - Do not store secret keys in `localStorage`, `sessionStorage`, cookies, or component state.
   - Do not pass secret keys to browser bundle compilation.
2. **Delegate all signing to connected wallet adapters.**
   - Web applications should construct unsigned transactions and request signatures via `client.wallet.signTransaction(adapter, ...)`.
   - The private key remains secure within the user's wallet extension or hardware device.
3. **Validate public keys received from the wallet.**
   - Ensure the user's public key matches valid Stellar format (`G...`, 56 characters, valid CRC16 checksum).

---

## 3. Server-Side Execution & Secret Handling

Server-side workloads (e.g. payment relays, automated market-maker bots, oracle feeders) require signing keys.

### Secure Key-Handling Patterns

1. **Environment Variables**:
   - Store server keys in encrypted secret managers (AWS Secrets Manager, Google Secret Manager, HashiCorp Vault) and inject as `STELLAR_SECRET_KEY` at runtime.
2. **Ephemeral Memory Usage**:
   - Instantiate keypairs in isolated execution scopes:
     ```ts
     import { Keypair } from "@stellar/stellar-sdk";

     // Load from server-only environment variable
     const serverKeypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!);
     ```
3. **Encrypted Storage with `sorokit-core/security`**:
   - For backend workflows needing key encryption, use `encryptKey()` and `decryptKey()` which implement AES-256-GCM with PBKDF2 key derivation (100,000 iterations).

---

## 4. Telemetry, Diagnostics & Redaction Safeguards

`sorokit-core` enforces automatic sensitive key redaction in error contexts and logging transports.

### Redaction Rules

- Context keys matching `/(secret|password|token|mnemonic|private|seed|authorization|api[-_]?key)/i` are automatically replaced with `"[REDACTED]"` via `sanitizeErrorContext`.
- Diagnostic loggers mask raw secret seed values (regex `^S[A-Z0-9]{55}$`) to prevent accidental leaks in log aggregators (Datadog, CloudWatch, Sentry).

```ts
import { sanitizeErrorContext } from "sorokit-core";

const sanitized = sanitizeErrorContext({
  operation: "wallet.connect",
  context: {
    secretKey: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    publicKey: "GBZXN7PIRZGNMHGA728VY3CW2QEMPLPDGQDPO4P7TXA7SM7DPRWMI2CV",
  },
});
// Result: { operation: "wallet.connect", context: { secretKey: "[REDACTED]", publicKey: "GBZXN7..." } }
```

---

## 5. Mainnet Safeguards & Defensive Defaults

To prevent catastrophic accidental transactions or cross-network fund loss:

1. **Passphrase Mismatch Detection**:
   - Transactions built for Testnet (`Test SDF Network ; September 2015`) will be rejected by Mainnet nodes due to network ID cryptographic binding.
2. **Simulation Preflight**:
   - Every Soroban write invocation (`client.soroban.invoke`) simulates the transaction before requesting wallet authorization, catching logic errors before gas is consumed.
3. **Address Checksum Verification**:
   - All addresses are strictly validated with `StrKey` encoding prior to transaction building.

---

## 6. Review of Examples

All consumer-facing examples in `examples/` (`next-serverless`, `react-wallet-connect`, `router-swap`, `transaction-dashboard`, `vue-soroban`) have been reviewed to ensure:
- Zero secret keys or seeds are present in browser code.
- All signing operations use wallet adapters or serverless environment variables.
- Console logs never print unredacted sensitive payloads.
