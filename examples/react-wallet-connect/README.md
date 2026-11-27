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
- Distinguishing user rejection from transport or contract failure

## Handling wallet rejection

When a user declines a wallet prompt, `useSorokit` sets `error` to a calm, actionable message rather than a generic failure string. The UI renders these notices with an amber background (`#fff8e1`) so users understand they made a deliberate decision and know what to do next.

| Error code | Displayed message |
|---|---|
| `WALLET_SIGN_REJECTED` | "You declined the transaction. When you're ready, press Send again to review and approve it." |
| `WALLET_CONNECT_FAILED` + rejection keyword | "Connection declined. Select a wallet and try again." |
| Any other failure | Original SDK error message |

The SDK utility `walletErrorMessage` from `sorokit-core/wallet` handles this mapping. Rejection messages never suggest automatic resubmission.

## Files

| File | Purpose |
|---|---|
| `src/useSorokit.ts` | Custom hook: client setup, wallet state, account ops, payment flow |
| `src/App.tsx` | UI: connect button, balance list, payment form, confirmation summary |
| `src/TransactionConfirmationSummary.tsx` | Reusable summary panel shown before signing |

## Confirmation summary (#105)

A demo should teach integrators to show users what they are approving before
the wallet extension opens. This example enforces a two-step flow:

1. The user fills in the payment form and clicks **Review & send**.
2. `useSorokit` builds the transaction XDR and fetches a fee estimate (if
   available), then sets `pendingSummary` — it does **not** open the wallet.
3. `App.tsx` renders `TransactionConfirmationSummary`, which displays:
   - Network (e.g. `testnet`)
   - Destination address
   - Operation summary (e.g. "Send 10 XLM to GDEST000…")
   - Asset
   - Amount
   - Estimated fee in stroops (labelled "—" when unavailable)
4. The user clicks **Confirm & open wallet** → `confirmPayment()` is called →
   the wallet extension opens for signing → the transaction is submitted.
5. If the user clicks **Cancel** → `cancelPayment()` discards the pending XDR
   without opening the wallet extension.

```tsx
// In your own component:
{pendingSummary && (
  <TransactionConfirmationSummary
    summary={pendingSummary}
    onConfirm={confirmPayment}
    onCancel={cancelPayment}
  />
)}
```

Fields that cannot be determined (e.g. fee estimation fails) are set to `null`
in the summary and rendered as "—" in the panel — they are never hidden.

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
