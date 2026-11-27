/**
 * WASM validation for contract deployment (#44).
 *
 * Deployment failures caused by malformed WASM are costly to diagnose after an
 * upload attempt reaches the network. `validateContractWasm` performs every
 * locally-checkable structural test before any I/O; `buildContractDeploy` runs
 * the same checks. These tests cover each malformed case (failure) and the
 * boundary cases, and assert that invalid inputs fail BEFORE network submission.
 */
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SorokitErrorCode } from "../shared/response";
import { buildContractDeploy } from "../soroban/deployContract";
import {
  MAX_WASM_SIZE,
  validateContractWasm,
} from "../soroban/validateContractWasm";

const networkConfig = {
  network: "testnet" as const,
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
};

const deployer = Keypair.random().publicKey();
const deployOptions = {
  rpcUrl: networkConfig.rpcUrl,
  horizonUrl: networkConfig.horizonUrl,
  networkConfig,
};

// Build a WASM module from a list of [sectionId, bodyBytes] sections.
function wasmWithSections(
  sections: Array<[number, Buffer]> = [],
): Buffer {
  const header = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const parts: Buffer[] = [header];
  for (const [id, body] of sections) {
    // LEB128 length of the body. Bodies here are small, so a single byte suffices.
    parts.push(Buffer.from([id, body.length]));
    parts.push(body);
  }
  return Buffer.concat(parts);
}

const headerOnly = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

describe("validateContractWasm", () => {
  it("accepts a valid module with only the header (zero sections)", () => {
    const result = validateContractWasm(headerOnly);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.byteLength).toBe(8);
      expect(result.data.sectionCount).toBe(0);
    }
  });

  it("accepts a valid module with custom and known sections", () => {
    const result = validateContractWasm(
      wasmWithSections([
        [0, Buffer.from([])], // custom section, empty body
        [1, Buffer.from([])], // type section
      ]),
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.sectionCount).toBe(2);
    }
  });

  it("allows repeated custom sections (id 0)", () => {
    const result = validateContractWasm(
      wasmWithSections([
        [0, Buffer.from([])],
        [0, Buffer.from([])],
      ]),
    );
    expect(result.status).toBe("ok");
  });

  it("rejects a non-Buffer input", () => {
    const result = validateContractWasm({} as unknown as Buffer);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
      expect(result.error.message).toContain("must be a Buffer");
    }
  });

  it("rejects an empty buffer with an actionable message", () => {
    const result = validateContractWasm(Buffer.alloc(0));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
      expect(result.error.message).toContain("missing or empty");
    }
  });

  it("rejects a module larger than the deploy limit", () => {
    const result = validateContractWasm(Buffer.alloc(MAX_WASM_SIZE + 1));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
      expect(result.error.message).toContain("exceeds max size");
    }
  });

  it("rejects a buffer too short to contain the header", () => {
    const result = validateContractWasm(
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("too short to contain the magic and version header");
    }
  });

  it("rejects a buffer with the wrong magic bytes", () => {
    const result = validateContractWasm(
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0x01, 0x00, 0x00, 0x00]),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("missing magic bytes");
    }
  });

  it("rejects a buffer with an unsupported version", () => {
    const result = validateContractWasm(
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("unsupported version");
    }
  });

  it("rejects a section whose length encoding is truncated", () => {
    // header + section id 1, but no length byte.
    const result = validateContractWasm(Buffer.concat([headerOnly, Buffer.from([0x01])]));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("truncated section length");
    }
  });

  it("rejects a section whose declared length exceeds the remaining buffer", () => {
    // header + section id 1 declaring 5 bytes, with no body.
    const result = validateContractWasm(
      Buffer.concat([headerOnly, Buffer.from([0x01, 0x05])]),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("declares 5 bytes but only 0 remain");
    }
  });

  it("rejects an unknown section id", () => {
    const result = validateContractWasm(
      Buffer.concat([headerOnly, Buffer.from([0x0d, 0x00])]),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("unknown section id 13");
    }
  });

  it("rejects a duplicate known section", () => {
    const result = validateContractWasm(
      wasmWithSections([
        [1, Buffer.from([])],
        [1, Buffer.from([])],
      ]),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toContain("duplicate section id 1");
    }
  });
});

// ---------------------------------------------------------------------------
// buildContractDeploy — invalid inputs fail BEFORE network submission
// ---------------------------------------------------------------------------

const { mockCreateSorobanServer } = vi.hoisted(() => ({
  mockCreateSorobanServer: vi.fn(() => {
    throw new Error("network-blocked-in-test");
  }),
}));

vi.mock("../shared/serverFactory", () => ({
  createSorobanServer: mockCreateSorobanServer,
  createHorizonServer: vi.fn(() => {
    throw new Error("network-blocked-in-test");
  }),
  setTracedFetch: vi.fn(),
  getTracedFetch: vi.fn(),
  setSorobanSimulator: vi.fn(),
}));

describe("buildContractDeploy rejects malformed WASM before network submission", () => {
  beforeEach(() => {
    mockCreateSorobanServer.mockClear();
  });

  it.each([
    ["empty buffer", Buffer.alloc(0), "missing or empty"],
    ["oversized", Buffer.alloc(MAX_WASM_SIZE + 1), "exceeds max size"],
    ["bad magic", Buffer.from([0x01, 0x02, 0x03, 0x04, 0x01, 0x00, 0x00, 0x00]), "missing magic bytes"],
    ["bad version", Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]), "unsupported version"],
    ["truncated length", Buffer.concat([headerOnly, Buffer.from([0x01])]), "truncated section length"],
    ["length overflow", Buffer.concat([headerOnly, Buffer.from([0x01, 0x05])]), "declares 5 bytes but only 0 remain"],
    ["unknown section id", Buffer.concat([headerOnly, Buffer.from([0x0d, 0x00])]), "unknown section id 13"],
    ["duplicate section", wasmWithSections([[1, Buffer.from([])], [1, Buffer.from([])]]), "duplicate section id 1"],
  ] as Array<[string, Buffer, string]>)("fails for %s without contacting the RPC", async (_label, wasm, expectedSubstring) => {
    const result = await buildContractDeploy(wasm, deployer, deployOptions);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.TX_BUILD_FAILED);
      expect(result.error.message).toContain(expectedSubstring);
    }
    // The malformed WASM must be rejected before any network call is made.
    expect(mockCreateSorobanServer).not.toHaveBeenCalled();
  });

  it("proceeds to the network only when the WASM is valid", async () => {
    const result = await buildContractDeploy(headerOnly, deployer, deployOptions);
    // Valid WASM passes validation and enters the network block; the mocked
    // RPC throws, so the result is an error from the catch — but the RPC WAS
    // reached, proving validation did not short-circuit.
    expect(mockCreateSorobanServer).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
  });
});
