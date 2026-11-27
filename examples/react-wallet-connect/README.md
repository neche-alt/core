# react-wallet-connect

Connect a Stellar wallet with Freighter, fetch balances, and send a payment — using `sorokit-core` in a React app. On reload the app detects a persisted session and shows a consent prompt before reconnecting.

```
Connect wallet → Fetch balances → Build payment → Review summary → Confirm → Sign → Submit
```

## Patterns covered

- Wallet connection and disconnection with `FreighterAdapter`
- **Reconnect-on-reload with explicit consent** via `reconnectWithConsent`
  - Persists the session after a successful connect (`saveSession`)
  - On reload, detects the saved session and surfaces a consent prompt
  - Shows device trust level (from `deviceTrust.ts`) in the prompt
  - On rejection, clears the session (`clearSession`) and returns to idle
- Loading account balances with `client.account.getBalances`
- Building a payment with `client.transaction.buildPayment`
- **Showing a confirmation summary before the wallet prompt opens** (#105)
- Handling `SorokitResult<T>` in component state (no try/catch)
- Loading and error states per operation
- **Network identity badge** (`NetworkBadge`) showing network name and testnet/mainnet distinction
- **Mainnet confirmation guard** (`useMainnetGuard` + `MainnetConfirmDialog`) for risky mainnet actions

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment |
| `src/App.tsx` | UI: network badge, connect button, balance list, payment form |
| `src/NetworkBadge.tsx` | Network identity badge, mainnet guard hook, confirmation dialog |

## NetworkBadge component

`NetworkBadge` always displays the active network name alongside a recognisable
testnet/mainnet distinction. It updates immediately when the `network` prop changes.

```tsx
import { NetworkBadge } from "./NetworkBadge";
import type { NetworkType } from "sorokit-core/network";

<NetworkBadge network="testnet" />
// → "Testnet — Test network — no real assets"

<NetworkBadge network="mainnet" />
// → "Mainnet — Real assets — transactions are irreversible" (amber warning style)
```

## Mainnet confirmation guard

`useMainnetGuard` gates any action that moves real assets behind an explicit
user confirmation. On testnet and futurenet it resolves immediately without
showing any prompt.

```tsx
import { useMainnetGuard, MainnetConfirmDialog } from "./NetworkBadge";

const guard = useMainnetGuard(network); // "mainnet" | "testnet" | "futurenet"

async function handleSend() {
  const confirmed = await guard.requestConfirmation();
  if (!confirmed) return; // user cancelled or non-mainnet — guard already resolved
  await sendPayment(...);
}

// Render the confirmation dialog when guard.isPending is true
{guard.isPending && (
  <MainnetConfirmDialog
    actionDescription="Send 10 XLM to GDEST…"
    onConfirm={guard.confirm}
    onCancel={guard.cancel}
  />
)}
```

## Setup

```bash
npm install sorokit-core @creit.tech/stellar-wallets-kit
```

You need a Stellar Wallets Kit instance. Create it once at app startup:

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});
```

Then pass it to `useSorokit`:

```ts
const {
  walletState,
  connect,
  balances,
  sendPayment,
  pendingSummary,
  confirmPayment,
  cancelPayment,
} = useSorokit(kit, "testnet");
```

## Accessibility

### Reduced motion

The example listens to `prefers-reduced-motion` via `window.matchMedia` and removes CSS transitions when the user prefers reduced motion. The `motionSafeTransition` helper in `src/a11y.ts` returns `"none"` when reduced motion is active.

### Color contrast and color-only indicators

Status colors (success, error, neutral) use dark foreground tokens that meet WCAG AA (4.5:1 on white). No status is communicated by color alone — each state also carries `role="alert"` or `role="status"` and visible text.

When `forced-colors` or `prefers-contrast: more` is active, all status colors fall back to the CSS system keyword `ButtonText`, which the browser maps to the user's high-contrast foreground color.

### Checks used

| Check | Method |
|---|---|
| Reduced motion respected | `window.matchMedia("(prefers-reduced-motion: reduce)")` with live listener |
| High contrast respected | `window.matchMedia("(forced-colors: active)")` and `prefers-contrast: more` |
| Status not color-only | Each state has `role`, `aria-label`, and text in addition to color |
| Color contrast | Tokens verified manually against WCAG AA (4.5:1 on white) |

## Running

Because this example lives inside the sorokit-core repo, its imports point to
`../../../src/...`. In your own app they become `import { ... } from "sorokit-core"`.

Type-check the example against the SDK source:

```bash
yarn typecheck:examples
```

## Localization

All user-facing strings in this example are routed through `src/shared/i18n.ts`
using `i18n.t("key")` calls. No raw string literals appear in rendered JSX.

### Adding a locale

1. Open `src/shared/i18n.ts` and add an entry for your locale alongside
   `EN_TRANSLATIONS` and `ES_TRANSLATIONS`:

   ```ts
   export const FR_TRANSLATIONS: Required<TranslationCatalog> = {
     "ui.app.title": "sorokit-core — Portefeuille React",
     "ui.wallet.connect_button": "Connecter Freighter",
     // ... all ui.* keys
   };
   ```

2. Register it with `createI18n`:

   ```ts
   const i18n = createI18n({ locale: "fr" }).withTranslations({ fr: FR_TRANSLATIONS });
   ```

3. Run the extraction script to verify no key is missing:

   ```bash
   node scripts/extract-i18n.mjs
   ```

   The script exits with code `1` if any key used in a component is absent
   from `EN_TRANSLATIONS`. Add the key there before proceeding.

4. The generated `scripts/messages.en.json` lists every key with its English
   default — hand this file to translators as the source catalog.
