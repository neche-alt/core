import { describe, expect, it } from "vitest";
import {
  resolveNetwork,
  NETWORK_DEFAULTS,
  SorokitErrorCode,
  createSorokitClient,
} from "../index";

describe("Network Configuration and Validation Reference (#60)", () => {
  it("resolves default configurations for mainnet, testnet, and futurenet", () => {
    for (const net of ["mainnet", "testnet", "futurenet"] as const) {
      const res = resolveNetwork(net);
      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.data.network).toBe(net);
        expect(res.data.horizonUrl).toBe(NETWORK_DEFAULTS[net].horizonUrl);
        expect(res.data.rpcUrl).toBe(NETWORK_DEFAULTS[net].rpcUrl);
        expect(res.data.networkPassphrase).toBe(NETWORK_DEFAULTS[net].networkPassphrase);
      }
    }
  });

  it("permits valid HTTPS overrides for remote endpoints", () => {
    const res = resolveNetwork("testnet", {
      horizonUrl: "https://custom-horizon.example.com",
      rpcUrl: "https://custom-rpc.example.com",
    });

    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.horizonUrl).toBe("https://custom-horizon.example.com");
      expect(res.data.rpcUrl).toBe("https://custom-rpc.example.com");
      expect(res.data.networkPassphrase).toBe(NETWORK_DEFAULTS.testnet.networkPassphrase);
    }
  });

  it("permits HTTP endpoints on localhost and 127.0.0.1 for local development", () => {
    const localRes = resolveNetwork("testnet", {
      horizonUrl: "http://localhost:8000",
      rpcUrl: "http://127.0.0.1:8000/soroban/rpc",
    });

    expect(localRes.status).toBe("ok");
    if (localRes.status === "ok") {
      expect(localRes.data.horizonUrl).toBe("http://localhost:8000");
      expect(localRes.data.rpcUrl).toBe("http://127.0.0.1:8000/soroban/rpc");
    }
  });

  it("rejects insecure HTTP endpoints on remote hosts with INVALID_CONFIG", () => {
    const insecureRes = resolveNetwork("mainnet", {
      rpcUrl: "http://remote-insecure-rpc.example.com",
    });

    expect(insecureRes.status).toBe("error");
    if (insecureRes.status === "error") {
      expect(insecureRes.error.code).toBe(SorokitErrorCode.INVALID_CONFIG);
      expect(insecureRes.error.message).toContain("rpcUrl");
    }
  });

  it("rejects malformed URLs or non-HTTP protocols with INVALID_CONFIG", () => {
    const badUrlRes = resolveNetwork("testnet", {
      rpcUrl: "not-a-valid-url",
    });
    expect(badUrlRes.status).toBe("error");
    if (badUrlRes.status === "error") {
      expect(badUrlRes.error.code).toBe(SorokitErrorCode.INVALID_CONFIG);
    }

    const ftpRes = resolveNetwork("testnet", {
      horizonUrl: "ftp://files.example.com",
    });
    expect(ftpRes.status).toBe("error");
    if (ftpRes.status === "error") {
      expect(ftpRes.error.code).toBe(SorokitErrorCode.INVALID_CONFIG);
    }
  });

  it("rejects unsupported network type identifiers with INVALID_NETWORK", () => {
    // @ts-expect-error testing runtime invalid network
    const badNetRes = resolveNetwork("customnet");
    expect(badNetRes.status).toBe("error");
    if (badNetRes.status === "error") {
      expect(badNetRes.error.code).toBe(SorokitErrorCode.INVALID_NETWORK);
      expect(badNetRes.error.message).toContain("customnet");
    }
  });

  it("createSorokitClient integrates network resolution and validation seamlessly", () => {
    const validClient = createSorokitClient({ network: "testnet" });
    expect(validClient.status).toBe("ok");

    // Insecure remote URL fails during client creation
    const invalidClient = createSorokitClient({
      network: "testnet",
      rpcUrl: "http://insecure-remote.example.com",
    });
    expect(invalidClient.status).toBe("error");
    if (invalidClient.status === "error") {
      expect(invalidClient.error.code).toBe(SorokitErrorCode.INVALID_CONFIG);
    }
  });
});
