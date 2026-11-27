# Wallet Adapter Selection Guide

A practical guide to choosing, configuring, and deploying wallet adapters in `sorokit-core`.

---

## Overview

Stellar applications interact with diverse wallet form factors: browser extensions, web popups, mobile QR handoffs, and hardware security modules. `sorokit-core` decouples connection management from transaction execution through framework-agnostic **Wallet Adapters**.

All adapters implement the unified `WalletAdapter` interface, returning `SorokitResult<T>` on every operation.

---

## Adapter Comparison Matrix

| Adapter | Primary Mechanism | Required Peer Dependencies | Platforms | Soroban Support | Multi-Sig | Best For |
|---|---|---|---|:---:|:---:|---|
| **FreighterAdapter** | Browser Extension | `@creit.tech/stellar-wallets-kit` | Desktop Browsers | âœ… Full | âœ… Yes | Default dApp standard for desktop users |
| **XBullAdapter** | Extension / Web App | `@creit.tech/stellar-wallets-kit` | Desktop & Mobile Web | âœ… Full | âœ… Yes | Users wanting extension or web-based fallback |
| **AlbedoAdapter** | Web Popup / URL bridge | None | All Browsers (Desktop & Mobile) | âš ï¸ Basic | âŒ No | Frictionless zero-install onboarding |
| **LobstrAdapter** | Mobile / Web | `@creit.tech/stellar-wallets-kit` | Mobile & Web | âœ… Full | âœ… Yes | Retail users and mobile push approvals |
| **HanaAdapter** | Browser Extension | `@creit.tech/stellar-wallets-kit` | Desktop Browsers | âœ… Full | âŒ No | Multi-chain users on desktop |
| **RabetAdapter** | Browser Extension | None (Direct window injection) | Desktop Browsers | âš ï¸ Standard | âŒ No | Legacy extension support |
| **WalletConnectAdapter** | QR Code / Deep Link | `@walletconnect/sign-client` | Mobile & Cross-device | âœ… Full | âœ… Yes | Mobile dApps connecting to mobile wallets |
| **LedgerAdapter** | WebUSB / WebHID | `@ledgerhq/hw-app-str`, `@ledgerhq/hw-transport-webusb` | Chrome, Edge, Node.js | âœ… Hash Sign | âœ… Yes | Institutional treasuries, cold storage |
| **TrezorAdapter** | Trezor Connect Bridge | `@trezor/connect-web` | Desktop Browsers | âš ï¸ Standard | âœ… Yes | High-security retail and cold storage |

---

## Detailed Adapter Profiles & Setup

### 1. Freighter (`FreighterAdapter`)

The reference browser extension for Stellar and Soroban development.

- **Required Peer:** `@creit.tech/stellar-wallets-kit`
- **Installation:**
  ```bash
  npm install @creit.tech/stellar-wallets-kit
  ```
- **Setup:**
  ```ts
  import { createSorokitClient, FreighterAdapter } from "sorokit-core";

  const client = createSorokitClient({ network: "testnet" }).data;
  const adapter = new FreighterAdapter(swkInstance);

  const conn = await client.wallet.connect(adapter);
  if (conn.status === "error") {
    console.error("Connection failed:", conn.error.message);
  } else {
    console.log("Connected account:", conn.data.publicKey);
  }
  ```
- **Capabilities & Strengths:**
  - Full Soroban authorization and transaction simulation signing.
  - Native multi-signature transaction approval.
  - Immediate injection via `window.freighter`.
- **Limitations:**
  - Desktop-only browser extension (Chrome, Firefox, Brave, Edge).
  - Cannot be run in headless Node.js or mobile browsers without the Freighter mobile app.

---

### 2. xBull (`XBullAdapter`)

A versatile wallet supporting both browser extensions and a standalone web application.

- **Required Peer:** `@creit.tech/stellar-wallets-kit`
- **Setup:**
  ```ts
  import { createSorokitClient, XBullAdapter } from "sorokit-core";

  const adapter = new XBullAdapter(swkInstance);
  const conn = await client.wallet.connect(adapter);
  ```
- **Capabilities & Strengths:**
  - Available as both a browser extension and a web wallet.
  - Hardware wallet bridging support.
- **Limitations:**
  - Requires user account creation in xBull infrastructure.

---

### 3. Albedo (`AlbedoAdapter`)

A web-based, URL-popup signer that requires no browser extension.

- **Required Peer:** None (uses web popup window)
- **Setup:**
  ```ts
  import { createSorokitClient, AlbedoAdapter } from "sorokit-core";

  const adapter = new AlbedoAdapter();
  const conn = await client.wallet.connect(adapter);
  ```
- **Capabilities & Strengths:**
  - Zero extension installation needed â€” works across iOS Safari, Android Chrome, and desktop browsers.
  - Great for immediate user onboarding.
- **Limitations:**
  - Browser popup blockers can intercept or block the signing window if not triggered directly by a user gesture.
  - Does **not** support silent background signing or headless automated runs.

---

### 4. WalletConnect (`WalletConnectAdapter`)

Enables mobile and cross-device connections via QR codes or native mobile deep links.

- **Required Peer:** `@walletconnect/sign-client`
- **Installation:**
  ```bash
  npm install @walletconnect/sign-client
  ```
- **Setup:**
  ```ts
  import { createSorokitClient, WalletConnectAdapter } from "sorokit-core";

  const adapter = new WalletConnectAdapter({
    projectId: "YOUR_WALLETCONNECT_PROJECT_ID",
    metadata: {
      name: "My Stellar App",
      description: "Decentralized application on Stellar",
      url: "https://myapp.example",
      icons: ["https://myapp.example/icon.png"],
    },
  });

  const conn = await client.wallet.connect(adapter);
  ```
- **Capabilities & Strengths:**
  - Allows mobile wallet users (LOBSTR, Vibrant) to interact with desktop web dApps.
  - Supports session persistence across reloads.
- **Limitations:**
  - Requires relay server connectivity (WalletConnect Cloud project ID required).
  - Subject to mobile OS app switching latency.

---

### 5. Ledger Hardware Wallet (`connectLedger` / `LedgerAdapter`)

Direct cryptographic signing on physical Ledger hardware (Nano S/X/S Plus, Stax).

- **Required Peers:** `@ledgerhq/hw-app-str`, `@ledgerhq/hw-transport-webusb` (or `@ledgerhq/hw-transport-node-hid`)
- **Installation:**
  ```bash
  npm install @ledgerhq/hw-app-str @ledgerhq/hw-transport-webusb
  ```
- **Setup:**
  ```ts
  import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
  import Str from "@ledgerhq/hw-app-str";
  import { connectLedger } from "sorokit-core/wallet";

  // 1. User gesture opens WebUSB connection
  const transport = await TransportWebUSB.create();
  const ledgerApp = new Str(transport);

  // 2. Connect via Sorokit
  const conn = await connectLedger(ledgerApp, { bip32Path: "44'/148'/0'" });
  if (conn.status === "ok") {
    console.log("Hardware Ledger address:", conn.data.publicKey);
  }
  ```
- **Capabilities & Strengths:**
  - Keys never leave the secure element.
  - On-device confirmation prevents host malware from stealing funds.
- **Limitations:**
  - Requires WebUSB/WebHID support (Chrome, Edge, Opera; not Safari or Firefox).
  - Soroban smart contract calls require the user to enable **"Hash signing"** or **"Blind signing"** in the Ledger Stellar app settings.

---

### 6. Trezor Hardware Wallet (`connectTrezor` / `TrezorAdapter`)

Trezor hardware signing via Trezor Connect bridge.

- **Required Peer:** `@trezor/connect-web`
- **Capabilities & Strengths:**
  - On-screen transaction detail decoding for classic Stellar operations.
- **Limitations:**
  - Opens Trezor Connect popup dialog for each signing interaction.

---

## Decision Tree: Which Adapter Should You Use?

```
Do you need maximum security for treasury/admin funds?
 â”œâ”€â”€ Yes â”€â”€â–¶ Use LedgerAdapter or TrezorAdapter
 â””â”€â”€ No
      â”‚
      Are your users primarily mobile web or do not have extensions?
       â”œâ”€â”€ Yes â”€â”€â–¶ Use AlbedoAdapter (web popup) or WalletConnectAdapter (QR / mobile deep link)
       â””â”€â”€ No  â”€â”€â–¶ Use FreighterAdapter or XBullAdapter via Stellar Wallets Kit modal
```

---

## Handling Connection and Signing Boundaries

Always inspect `SorokitResult` status to handle rejection or unsupported actions:

```ts
const signRes = await client.wallet.signTransaction(adapter, {
  transactionXdr: unsignedXdr,
  networkPassphrase: client.networkConfig.networkPassphrase,
});

if (signRes.status === "error") {
  switch (signRes.error.code) {
    case "WALLET_SIGN_FAILED":
      // User cancelled or hardware disconnected
      console.warn("Signing was cancelled or rejected by the wallet.");
      break;
    case "WALLET_NOT_CONNECTED":
      console.warn("Wallet session expired. Reconnect wallet.");
      break;
    default:
      console.error("Signing failed:", signRes.error.message);
  }
}
```

---

## Best Practices

1. **Never promise unsupported features:** Do not advertise background signing for hardware wallets or Albedo.
2. **Handle missing extensions gracefully:** Verify extension availability before prompting connection.
3. **Use the unified `client.wallet` API:** Keep application logic framework-agnostic by relying on the `WalletAdapter` interface.
