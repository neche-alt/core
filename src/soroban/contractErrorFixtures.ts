/**
 * contractErrorFixtures — sanitized regression fixtures for Soroban RPC
 * and contract error responses.
 *
 * Provides stable, sanitized fixtures representing known, unknown, partial,
 * and malformed error shapes encountered across Stellar RPC providers.
 */

/** Mimics stellar-sdk HostError shape (`codes()` accessor). */
export class MockHostError extends Error {
  constructor(private readonly hostCodes: unknown[]) {
    super(`HostError: Error(Contract, #${hostCodes.at(-1)})`);
    this.name = "HostError";
  }
  codes(): unknown[] {
    return this.hostCodes;
  }
}

/** Known error response fixtures */
export const SANITIZED_KNOWN_ERROR_FIXTURES = {
  hostErrorFactoryPairExists: {
    input: new MockHostError(["Contract", 1]),
    expectedCode: "1",
    expectedSymbol: "PAIR_ALREADY_EXISTS",
  },
  hostErrorRouterSlippage: {
    input: new MockHostError(["Contract", 3]),
    expectedCode: "3",
    expectedSymbol: "ROUTER_SLIPPAGE_EXCEEDED",
  },
  jsonRpcSimulationFailure: {
    input: {
      jsonrpc: "2.0",
      id: "req_sim_1",
      error: {
        code: -32600,
        message: "HostError: Error(Contract, #1)",
        data: {
          events: ["AAAAFAAAAAAAAAAAAAAA..."],
          diagnosticXdr: "AAAAEgAAAAAAAAAAAAAA...",
        },
      },
    },
    expectedCode: "1",
    expectedSymbol: "PAIR_ALREADY_EXISTS",
  },
  symbolicRouterError: {
    input: {
      code: "ROUTER_INVALID_PATH",
      message: "The swap path is invalid — it must contain at least two assets.",
      detail: { pathLength: 1, hops: [] },
    },
    expectedCode: "ROUTER_INVALID_PATH",
  },
  namespacedFactoryUnauthorized: {
    input: {
      code: "FACTORY_5",
      message: "Caller is not authorized to perform this factory operation.",
      detail: { caller: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA" },
    },
    expectedCode: "FACTORY_5",
  },
  simulateTransactionErrorString: {
    input: {
      status: "FAILED",
      error: "Error(Contract, #7)",
      events: [{ contractId: "CCONTRACT", topics: ["swap"] }],
    },
    expectedCode: "7",
  },
};

/** Unknown error response fixtures */
export const SANITIZED_UNKNOWN_ERROR_FIXTURES = {
  unmappedNumericHostError: {
    input: new MockHostError(["Contract", 9999]),
    expectedCode: "9999",
  },
  unmappedSymbolicError: {
    input: {
      code: "VAULT_LOCK_ACTIVE",
      message: "Vault lock active until unlock ledger",
      data: { unlockLedger: 1234567 },
    },
    expectedCode: "VAULT_LOCK_ACTIVE",
  },
  jsonRpcInternalServerError: {
    input: {
      jsonrpc: "2.0",
      id: 99,
      error: {
        code: -32001,
        message: "Node internal storage verification error",
        data: { traceId: "trace-soroban-001" },
      },
    },
    expectedCode: "-32001",
  },
  unmappedBareNumber: {
    input: 8888,
    expectedCode: "8888",
  },
};

/** Partial error response fixtures */
export const SANITIZED_PARTIAL_ERROR_FIXTURES = {
  codeWithoutMessage: {
    input: {
      code: "FACTORY_2",
      detail: { asset: "USDC" },
    },
    expectedCode: "FACTORY_2",
  },
  messageWithoutCode: {
    input: {
      message: "Transaction execution reverted by Soroban host",
      detail: { gasUsed: 45000 },
    },
  },
  nestedEmptyError: {
    input: {
      error: {
        code: "ROUTER_2",
        data: { reserves: { tokenA: "0", tokenB: "100" } },
      },
    },
    expectedCode: "ROUTER_2",
  },
  nullMessageField: {
    input: {
      code: "ROUTER_4",
      message: null,
      detail: { deadline: 1700000000 },
    },
    expectedCode: "ROUTER_4",
  },
  rpcPayloadWithDiagnosticEvents: {
    input: {
      error: "Contract execution failed",
      events: [{ id: "evt_1", topics: ["error"] }],
    },
  },
};

/** Malformed error response fixtures */
export const SANITIZED_MALFORMED_ERROR_FIXTURES = {
  nullInput: null,
  undefinedInput: undefined,
  booleanInput: false,
  numberPrimitive: 500,
  emptyObject: {},
  htmlErrorString: "<html><head><title>504 Gateway Timeout</title></head><body><h1>504</h1></body></html>",
  throwingGetter: {
    get code(): string {
      throw new Error("Accessing code throws");
    },
    get message(): string {
      throw new Error("Accessing message throws");
    },
  },
  circularReference: (() => {
    const circular: Record<string, unknown> = {
      code: "ROUTER_1",
      message: "Circular reference fixture",
    };
    circular.self = circular;
    return circular;
  })(),
  junkArray: [Symbol("junk"), () => "noop"],
};
