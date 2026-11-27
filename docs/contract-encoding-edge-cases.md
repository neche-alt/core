# Contract Argument Encoding Edge Cases

Soroban values include nested and numeric types whose encoding errors can be
subtle across JavaScript and XDR representations. This guide covers supported
complex values, numeric boundaries, and precision constraints.

## Numeric types and boundaries

### u32 / i32

Standard 32-bit integers. Pass a JavaScript `number`.

| Type | Min | Max |
|------|-----|-----|
| `u32` | `0` | `4294967295` |
| `i32` | `-2147483648` | `2147483647` |

Values outside these ranges throw a `RangeError` from `encodeAbiValue`.

### u64 / i64

64-bit integers. Pass a `bigint` for values above `Number.MAX_SAFE_INTEGER`
(`2^53 - 1 = 9007199254740991`). JavaScript `number` is accepted as a
convenience for small values but loses precision beyond that threshold.

```ts
import { encodeAbiValue } from "sorokit-core/soroban";

// Safe: small value as number
encodeAbiValue("u64", 42, "amount");

// Required: large value as bigint
encodeAbiValue("u64", 10000000000000000n, "amount");
```

**Precision constraint:** passing a JavaScript `number` above
`Number.MAX_SAFE_INTEGER` as a `u64` or `i64` argument will silently produce
an incorrect XDR value because the number cannot represent all 64-bit integers
exactly. Always use `bigint` for u64/i64 values that may exceed `2^53`.

### u128 / i128

128-bit integers. `bigint` is required — JavaScript `number` is accepted only
for values representable within 53 bits.

| Type | Min | Max |
|------|-----|-----|
| `u128` | `0n` | `(1n << 128n) - 1n` |
| `i128` | `-(1n << 127n)` | `(1n << 127n) - 1n` |

```ts
// Round-trip a u128 at the boundary
import { encodeAbiValue, decodeContractValue } from "sorokit-core/soroban";

const max = (1n << 128n) - 1n;
const encoded = encodeAbiValue("u128", max, "max_u128");
const decoded = decodeContractValue(encoded); // → max (bigint)
```

## Complex and nested types

### vec (array)

Pass a JavaScript array. Use `elementType` to give each item a specific type.
Without `elementType`, items are encoded via `nativeToScVal` best-effort.

```ts
import { encodeAbiValue, decodeContractValue } from "sorokit-core/soroban";

// Typed vec of u32
const encoded = encodeAbiValue(
  { type: "vec", elementType: "u32" },
  [1, 2, 3],
  "scores",
);

// Nested vec of vecs
const nested = encodeAbiValue(
  { type: "vec", elementType: { type: "vec", elementType: "u32" } },
  [[1, 2], [3, 4]],
  "matrix",
);
```

### map

Pass a plain JavaScript object. Use `keyType` and `valueType` for typed maps.

```ts
const encoded = encodeAbiValue(
  { type: "map", keyType: "string", valueType: "u128" },
  { balance: 1000n, locked: 0n },
  "balances",
);
```

**Note:** `null` and arrays are rejected — only plain objects are valid map inputs.

### struct / custom

Structs are encoded as an `scvMap` keyed by symbol. Every declared field must
be present; extra fields in the JS object are ignored.

```ts
const encoded = encodeAbiValue(
  {
    type: "struct",
    fields: [
      { name: "amount",    type: "u128" },
      { name: "recipient", type: "string" },
      { name: "active",    type: "bool" },
    ],
  },
  { amount: 500n, recipient: "GABC...", active: true },
  "transfer",
);
```

Throws `TypeError` with a descriptive message when a required field is missing
or the input is not a plain object.

## Round-trip encode/decode

All supported types survive a round-trip through `encodeAbiValue` →
`decodeContractValue`:

```ts
import { encodeAbiValue, decodeContractValue } from "sorokit-core/soroban";

function roundTrip(type: string, value: unknown): unknown {
  return decodeContractValue(encodeAbiValue(type, value));
}

roundTrip("u128",  (1n << 127n) - 1n); // → same bigint
roundTrip("string", "héllo 🌍");        // → same string (UTF-8 preserved)
roundTrip("bool",   false);             // → false
roundTrip("void",   undefined);         // → undefined
```

## encodeContractArgs

`encodeContractArgs` takes a `ContractMethod` and an array of JS values aligned
positionally with the method's `inputs`. It throws if the count does not match.

```ts
import { encodeContractArgs } from "sorokit-core/soroban";
import type { ContractMethod } from "sorokit-core/soroban";

const method: ContractMethod = {
  name: "deposit",
  inputs: [
    { name: "amount",    type: "u128" },
    { name: "recipient", type: "string" },
  ],
  returnType: "void",
};

const args = encodeContractArgs(method, [1000n, "GABC..."]);
// → xdr.ScVal[] ready for prepareContractCall
```

## Supported types quick reference

| Type | JS input | XDR | Notes |
|------|----------|-----|-------|
| `bool` | `boolean` | `scvBool` | |
| `u32` | `number` | `scvU32` | Range: 0 – 2³²-1 |
| `i32` | `number` | `scvI32` | Range: -2³¹ – 2³¹-1 |
| `u64` | `number \| bigint` | `scvU64` | Use bigint above 2⁵³ |
| `i64` | `number \| bigint` | `scvI64` | Use bigint above 2⁵³ |
| `u128` | `number \| bigint` | `scvU128` | Use bigint |
| `i128` | `number \| bigint` | `scvI128` | Use bigint |
| `string` | `string` | `scvString` | UTF-8 encoded |
| `symbol` | `string` | `scvSymbol` | Max 32 chars |
| `bytes` | `Uint8Array \| Buffer` | `scvBytes` | |
| `address` | `string` (G.../C...) | `scvAddress` | |
| `vec` | `unknown[]` | `scvVec` | Use `elementType` for typed items |
| `map` | plain object | `scvMap` | Use `keyType`/`valueType` for typed maps |
| `struct` | plain object | `scvMap` | Fields encoded as symbol keys |
| `void` | `undefined \| null` | `scvVoid` | |
