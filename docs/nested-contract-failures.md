# Nested Contract Failure Decoding

When a Soroban contract call fails, the error may contain nested sub-invocation failures
from inner contract calls. `decodeNestedContractFailure` traverses the full failure tree
so you can see exactly which invocation failed at which depth.

## Usage

```ts
import {
  decodeNestedContractFailure,
  formatNestedContractFailure,
} from "sorokit-core";

// simulationError may come from simulateTransaction or invokeContract
const tree = decodeNestedContractFailure(simulationError);

// Print a readable indented summary
console.log(formatNestedContractFailure(tree));
// [0] ROUTER_SLIPPAGE_EXCEEDED: The realized swap price exceeded the allowed slippage tolerance.
//   [1] ROUTER_INSUFFICIENT_LIQUIDITY: Insufficient liquidity in one or more pools along the route.

// Access the full tree programmatically
console.log(`Total failures: ${tree.totalFailures}`);
for (const node of tree.flat) {
  console.log(`${"  ".repeat(node.depth)}[${node.depth}] ${node.decoded.message}`);
  if (node.decoded.remediation) {
    console.log(`${"  ".repeat(node.depth)}  → ${node.decoded.remediation}`);
  }
}
```

## Tree structure

| Property | Description |
|---|---|
| `tree.root` | Root failure node (depth 0) |
| `tree.totalFailures` | Count of all nodes including children |
| `tree.flat` | Depth-first flat list, root first |
| `node.depth` | Call depth (0 = top-level invocation) |
| `node.decoded` | `DecodedContractError` from `decodeContractError` |
| `node.decoded.raw` | Original error value — never dropped |
| `node.children` | Direct sub-call failures |

## Custom error maps

Pass your own error map to decode application-specific contract errors:

```ts
const myMap = {
  POOL_LOCKED: { message: "Pool is locked for settlement.", remediation: "Wait for settlement to complete." },
};

const tree = decodeNestedContractFailure(error, myMap);
```

## Notes

- The original RPC response is preserved at every node via `decoded.raw`. Nothing is dropped.
- `causes` arrays inside error objects are traversed automatically.
- The function never throws on malformed or null input.
