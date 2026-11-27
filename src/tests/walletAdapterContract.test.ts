import { describe, it, expect, vi, afterEach } from "vitest";
import { defineWalletAdapterContractTests } from "../testing/adapterContractSuite";
import { createMockWalletAdapter, MOCK_PUBLIC_KEY } from "../testing/mockClient";
import { FreighterAdapter } from "../wallet/adapters/freighter";
import { XBullAdapter } from "../wallet/adapters/xbull";
import { LobstrAdapter } from "../wallet/adapters/lobstr";
import { HanaAdapter } from "../wallet/adapters/hana";
import { RabetAdapter } from "../wallet/adapters/rabet";
import { WalletType, type SWKInstance } from "../wallet/types";
import { ok } from "../shared/response";

function makeMockKit(overrides: Partial<SWKInstance> = {}): SWKInstance {
  return {
    getPublicKey: vi.fn().mockResolvedValue(MOCK_PUBLIC_KEY),
    signTransaction: vi.fn().mockResolvedValue("AAAA...signed_xdr"),
    signAuthEntry: vi.fn().mockResolvedValue("signed_auth"),
    ...overrides,
  } as unknown as SWKInstance;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WalletAdapter contract enforcement (#74)", () => {
  // 1. Mock Adapter
  defineWalletAdapterContractTests({
    name: "createMockWalletAdapter",
    createAvailableAdapter: () => createMockWalletAdapter({ isAvailable: true }),
    createUnavailableAdapter: () => createMockWalletAdapter({ isAvailable: false }),
    createRejectingAdapter: () =>
      createMockWalletAdapter({
        connectThrows: "User rejected connection",
        signTransactionThrows: "User rejected signing",
      }),
    createMultiAccountAdapter: () => {
      const adapter = createMockWalletAdapter({ isAvailable: true });
      adapter.getAccounts = vi.fn().mockResolvedValue(
        ok([MOCK_PUBLIC_KEY, "GBZXN7PIRZGNMHGA728RGRFZAPPWN9G8K343LMS6K324N2522774Q44M"]),
      );
      adapter.setActiveAccount = vi.fn().mockImplementation((key: string) => ok(key));
      return adapter;
    },
  });

  // 2. FreighterAdapter
  defineWalletAdapterContractTests({
    name: "FreighterAdapter",
    createAvailableAdapter: () => {
      const adapter = new FreighterAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
    createUnavailableAdapter: () => {
      const adapter = new FreighterAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(false);
      return adapter;
    },
    createRejectingAdapter: () => {
      const kit = makeMockKit({
        getPublicKey: vi.fn().mockRejectedValue(new Error("User rejected the request")),
        signTransaction: vi.fn().mockRejectedValue(new Error("User rejected the request")),
      });
      const adapter = new FreighterAdapter(kit);
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
  });

  // 3. XBullAdapter
  defineWalletAdapterContractTests({
    name: "XBullAdapter",
    createAvailableAdapter: () => {
      const adapter = new XBullAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
    createUnavailableAdapter: () => {
      const adapter = new XBullAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(false);
      return adapter;
    },
    createRejectingAdapter: () => {
      const kit = makeMockKit({
        getPublicKey: vi.fn().mockRejectedValue(new Error("User rejected the request")),
        signTransaction: vi.fn().mockRejectedValue(new Error("User rejected the request")),
      });
      const adapter = new XBullAdapter(kit);
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
  });

  // 4. LobstrAdapter
  defineWalletAdapterContractTests({
    name: "LobstrAdapter",
    createAvailableAdapter: () => {
      const adapter = new LobstrAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
    createUnavailableAdapter: () => {
      const adapter = new LobstrAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(false);
      return adapter;
    },
    createRejectingAdapter: () => {
      const kit = makeMockKit({
        getPublicKey: vi.fn().mockRejectedValue(new Error("User rejected the request")),
        signTransaction: vi.fn().mockRejectedValue(new Error("User rejected the request")),
      });
      const adapter = new LobstrAdapter(kit);
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
  });

  // 5. HanaAdapter
  defineWalletAdapterContractTests({
    name: "HanaAdapter",
    createAvailableAdapter: () => {
      const adapter = new HanaAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
    createUnavailableAdapter: () => {
      const adapter = new HanaAdapter(makeMockKit());
      vi.spyOn(adapter, "isAvailable").mockReturnValue(false);
      return adapter;
    },
    createRejectingAdapter: () => {
      const kit = makeMockKit({
        getPublicKey: vi.fn().mockRejectedValue(new Error("User rejected the request")),
        signTransaction: vi.fn().mockRejectedValue(new Error("User rejected the request")),
      });
      const adapter = new HanaAdapter(kit);
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
  });

  // 6. RabetAdapter
  defineWalletAdapterContractTests({
    name: "RabetAdapter",
    createAvailableAdapter: () => {
      const provider = {
        connect: vi.fn().mockResolvedValue({ publicKey: MOCK_PUBLIC_KEY }),
        sign: vi.fn().mockResolvedValue({ xdr: "AAAA...signed_xdr" }),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
      const adapter = new RabetAdapter(provider);
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
    createUnavailableAdapter: () => {
      const adapter = new RabetAdapter();
      vi.spyOn(adapter, "isAvailable").mockReturnValue(false);
      return adapter;
    },
    createRejectingAdapter: () => {
      const provider = {
        connect: vi.fn().mockRejectedValue(new Error("User rejected the request")),
        sign: vi.fn().mockRejectedValue(new Error("User rejected the request")),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
      const adapter = new RabetAdapter(provider);
      vi.spyOn(adapter, "isAvailable").mockReturnValue(true);
      return adapter;
    },
  });
});
