# Amount precision and formatting

Stellar amounts are stored as 64-bit signed integers (stroops) on the network. One XLM equals 10,000,000 stroops. JavaScript's `number` type cannot represent the full stroop range without precision loss because `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) is smaller than the Stellar maximum of 9,223,372,036,854,775,807 stroops. Sorokit Core avoids `number` internally and uses `bigint` and string representations to keep every calculation exact.

---

## Representations

| Representation | Type | Example | Use |
|----------------|------|---------|-----|
| XLM decimal string | `string` | `"100.0000000"` | Input to build operations, display |
| Stroop integer string | `string` | `"1000000000"` | Serialisation, Horizon API |
| Stroop bigint | `bigint` | `1000000000n` | Internal arithmetic |

Always use strings or `bigint` when passing amounts across API boundaries. Never use `number` for amounts that may exceed `Number.MAX_SAFE_INTEGER` (roughly 900,000 XLM expressed in stroops).

---

## Precision constraints

- Stellar classic assets support **at most 7 decimal places** (stroop precision).
- Soroban token contracts may define their own decimal precision; pass the token's `decimals` field to `formatAmount` explicitly.
- The maximum representable amount is `922337203685.4775807` XLM (`MAX_AMOUNT`).
- The minimum positive amount is `0.0000001` XLM (1 stroop).

---

## Validation helpers

### `validateAmount(value)`

Accepts a decimal string or number. Rejects zero, negative values, amounts with more than 7 decimal places, and amounts above `MAX_AMOUNT`.

```ts
import { validateAmount } from "sorokit-core";

validateAmount("100.5");          // ok  → "100.5"
validateAmount("100.12345678");   // error: more than 7 decimal places
validateAmount("0");              // error: must be greater than zero
validateAmount("-5");             // error: must be greater than zero
validateAmount("922337203686");   // error: exceeds Stellar maximum
```

### `validateStroop(value)`

Accepts a non-negative integer (string, number, or bigint). Rejects negative values and values above the int64 maximum.

```ts
import { validateStroop } from "sorokit-core";

validateStroop("1000000000");     // ok  → "1000000000"
validateStroop(0n);               // ok  → "0"
validateStroop("-1");             // error: must be non-negative
```

---

## Conversion helpers

### `xlmToStroops(value)` and `stroopsToXlm(value)`

```ts
import { xlmToStroops, stroopsToXlm } from "sorokit-core";

const stroops = xlmToStroops("100.5");
// ok → "1005000000"

const xlm = stroopsToXlm("1005000000");
// ok → "100.5"

// Round-trip is lossless for any valid amount
const original = "100.1234567";
const roundTripped = stroopsToXlm(xlmToStroops(original).data!).data;
// roundTripped === "100.1234567"
```

Both return `SorokitResult<string>` — check `.status` before accessing `.data`.

---

## Arithmetic helpers

The helpers in `sorokit-core/amounts` (also re-exported from `sorokit-core`) operate on XLM decimal strings and use exact bigint arithmetic internally. They are safe for amounts that overflow `Number.MAX_SAFE_INTEGER`.

```ts
import { addAmounts, subtractAmounts, multiplyAmount, divideAmount } from "sorokit-core";

addAmounts("100", "0.5");                 // "100.5"
subtractAmounts("100.5", "0.5");          // "100"
multiplyAmount("100", "1.5");             // "150"
divideAmount("100", "3");                 // "33.3333333"  (7-decimal precision, half-up rounding)
```

Rounding uses half-up at the 7th decimal place. The `addAmounts` / `subtractAmounts` functions accept any decimal string with up to 7 decimal places and throw `RangeError` on invalid input.

---

## Display formatting

`formatAmount` converts a raw stroop integer into a locale-formatted decimal string. It never routes the full amount through a JavaScript `number`, so it stays exact for any value up to the int64 maximum.

```ts
import { formatAmount } from "sorokit-core";

// Basic formatting — 1,000,000,000 stroops = 100 XLM
formatAmount("1000000000");
// ok → "100.00"

// With symbol
formatAmount("1000000000", { showSymbol: true });
// ok → "100.00 XLM"

// German locale
formatAmount("1000000000", { locale: "de-DE" });
// ok → "100,00"

// Explicit precision
formatAmount("1000000000", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// ok → "100"

// Soroban token with 6 decimals
formatAmount("100000000", { decimals: 6, showSymbol: true, symbol: "USDC" });
// ok → "100.00 USDC"
```

`formatAmount` returns `SorokitResult<string>`. On error (invalid locale, out-of-range `decimals`), `result.status === "error"` and `result.error.message` explains the problem.

### Precision option reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `decimals` | `number` | `7` | Decimal places of the token (7 for classic Stellar assets) |
| `locale` | `string` | `"en-US"` | BCP 47 locale tag |
| `showSymbol` | `boolean` | `false` | Append the asset symbol after the number |
| `symbol` | `string` | `asset.code \|\| "XLM"` | Explicit symbol override |
| `minimumFractionDigits` | `number` | `2` | Always show at least this many decimals |
| `maximumFractionDigits` | `number` | `decimals` | Round excess precision; ≥ `minimumFractionDigits` |

---

## Safe patterns

**Do**: always pass amounts as strings or bigints.

```ts
// ✅ safe — string input, no float rounding
buildPaymentTransaction(horizonUrl, network, sourceKey, {
  destination: destinationKey,
  amount: "100.5",
  sequenceNumber,
  estimatedFee: "100",
});
```

**Do not**: pass a computed JavaScript `number` for large amounts.

```ts
// ❌ risky — loses precision beyond MAX_SAFE_INTEGER
const amountNumber = 9999999999 * 1e7; // loses mantissa bits
buildPaymentTransaction(..., { amount: String(amountNumber) });

// ✅ correct — keep the value as bigint until conversion
import { stroopsToXlm } from "sorokit-core";
const stroops = 99999999990000000n;
const amount = stroopsToXlm(stroops).data!; // exact string
buildPaymentTransaction(..., { amount });
```

**Do not**: add amounts with `+` on number types.

```ts
// ❌ risky
const total = parseFloat(a) + parseFloat(b);

// ✅ correct
import { addAmounts } from "sorokit-core";
const total = addAmounts(a, b); // exact bigint arithmetic
```

---

## Common pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Passing `number` for large amounts | Display shows rounded or truncated value | Use `string` or `bigint` throughout |
| Formatting with `toLocaleString(number)` | Precision lost for amounts > 900k XLM | Use `formatAmount` |
| Hardcoding `decimals: 7` for Soroban tokens | Wrong display for tokens with non-standard precision | Read `decimals` from the token contract spec and pass it to `formatAmount` |
| Arithmetic with `parseFloat` | Drift at the 7th decimal place | Use `addAmounts`, `subtractAmounts`, `multiplyAmount`, `divideAmount` |
| Submitting an amount with 8+ decimal places | `VALIDATION` error from `validateAmount` | Round to 7 places before passing |
