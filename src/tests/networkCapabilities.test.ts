import { describe, expect, it, vi } from "vitest";
import {
  checkNetworkCapabilities,
  preflightDeploymentCapabilities,
  MIN_SOROBAN_PROTOCOL_VERSION,
} from "../soroban/networkCapabilities";
import { buildContractDeploy } from "../soroban/deployContract";
import { SorokitErrorCode } from "../shared/response";
import * as serverFactory from "../shared/serverFactory";

describe("Soroban Network Capability Checks (#54)", () => {
  const validWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const deployer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const networkConfig = {
    network: "testnet" as const,
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
  };

  it("exports MIN_SOROBAN_PROTOCOL_VERSION as 20", () => {
    expect(MIN_SOROBAN_PROTOCOL_VERSION).toBe(20);
  });

  it("returns INVALID_CONFIG when rpcUrl is missing or empty", async () => {
    const res = await checkNetworkCapabilities({ rpcUrl: "" });
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.INVALID_CONFIG);
      expect(res.error.message).toContain("rpcUrl is missing");
    }
  });

  it("handles supported capability response when protocol is >= 20 and passphrase matches", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockResolvedValue({
        protocolVersion: 21,
        passphrase: "Test SDF Network ; September 2015",
        friendbotUrl: "https://friendbot.stellar.org",
      }),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    const res = await checkNetworkCapabilities({
      rpcUrl: "https://soroban-testnet.stellar.org",
      expectedPassphrase: "Test SDF Network ; September 2015",
      minProtocolVersion: 20,
    });

    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.supported).toBe(true);
      expect(res.data.protocolVersion).toBe(21);
      expect(res.data.passphrase).toBe("Test SDF Network ; September 2015");
      expect(res.data.friendbotUrl).toBe("https://friendbot.stellar.org");
    }

    spy.mockRestore();
  });

  it("returns UNSUPPORTED_NETWORK when protocol version is below required minimum", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockResolvedValue({
        protocolVersion: 19, // Below protocol 20
        passphrase: "Test SDF Network ; September 2015",
      }),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    const res = await checkNetworkCapabilities({
      rpcUrl: "https://soroban-testnet.stellar.org",
      minProtocolVersion: 20,
    });

    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.UNSUPPORTED_NETWORK);
      expect(res.error.message).toContain("below minimum required 20");
      expect(res.error.cause).toMatchObject({
        protocolVersion: 19,
        minProtocolVersion: 20,
      });
    }

    spy.mockRestore();
  });

  it("returns UNSUPPORTED_NETWORK when network passphrase mismatches expected configuration", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockResolvedValue({
        protocolVersion: 20,
        passphrase: "Public Global Stellar Network ; September 2015", // Mainnet passphrase
      }),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    const res = await checkNetworkCapabilities({
      rpcUrl: "https://soroban-testnet.stellar.org",
      expectedPassphrase: "Test SDF Network ; September 2015",
    });

    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.UNSUPPORTED_NETWORK);
      expect(res.error.message).toContain("Network passphrase mismatch");
    }

    spy.mockRestore();
  });

  it("returns SERVICE_UNAVAILABLE when endpoint is unreachable or network times out", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    const res = await checkNetworkCapabilities({
      rpcUrl: "https://unreachable-soroban.example.com",
    });

    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error.code).toBe(SorokitErrorCode.SERVICE_UNAVAILABLE);
      expect(res.error.message).toContain("unavailable or unreachable");
    }

    spy.mockRestore();
  });

  it("preflightDeploymentCapabilities runs capability check using resolved network config", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockResolvedValue({
        protocolVersion: 20,
        passphrase: networkConfig.networkPassphrase,
      }),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    const res = await preflightDeploymentCapabilities({
      rpcUrl: networkConfig.rpcUrl,
      networkConfig,
    });

    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.supported).toBe(true);
      expect(res.data.protocolVersion).toBe(20);
    }

    spy.mockRestore();
  });

  it("buildContractDeploy aborts early with UNSUPPORTED_NETWORK when preflight fails", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockResolvedValue({
        protocolVersion: 18,
        passphrase: networkConfig.networkPassphrase,
      }),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    const result = await buildContractDeploy(validWasm, deployer, {
      rpcUrl: networkConfig.rpcUrl,
      horizonUrl: networkConfig.horizonUrl,
      networkConfig,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe(SorokitErrorCode.UNSUPPORTED_NETWORK);
      expect(result.error.message).toContain("below minimum required");
    }

    spy.mockRestore();
  });

  it("buildContractDeploy respects skipCapabilityPreflight option", async () => {
    const mockServer = {
      getNetwork: vi.fn().mockResolvedValue({
        protocolVersion: 18,
      }),
    };
    const spy = vi
      .spyOn(serverFactory, "createSorobanServer")
      .mockReturnValue(mockServer as any);

    // With skipCapabilityPreflight: true, it will proceed past preflight and attempt Horizon load
    // which fails with network error since horizonUrl is mocked/not running, but crucially NOT with UNSUPPORTED_NETWORK
    const result = await buildContractDeploy(validWasm, deployer, {
      rpcUrl: networkConfig.rpcUrl,
      horizonUrl: "http://127.0.0.1:9999",
      networkConfig,
      skipCapabilityPreflight: true,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).not.toBe(SorokitErrorCode.UNSUPPORTED_NETWORK);
    }

    spy.mockRestore();
  });
});
