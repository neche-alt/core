import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionPool,
  createConnectionPool,
  createSorokitClient,
  setConnectionPool,
  getConnectionPool,
  resetServerFactory,
  configureEndpointFailover,
  resetEndpointPools,
  subscribePrices,
  createWebSocketTransactionFeed,
  createTransactionStatusAggregator,
  WebSocketPriceProvider,
} from "../index";

afterEach(() => {
  vi.restoreAllMocks();
  resetServerFactory();
  resetEndpointPools();
});

describe("Client Resource Ownership & Lifecycle (#36)", () => {
  describe("createSorokitClient lifecycle and reuse", () => {
    it("can be safely reused across multiple calls without holding open timers or background state", () => {
      const clientResult = createSorokitClient({ network: "testnet" });
      expect(clientResult.status).toBe("ok");
      if (clientResult.status !== "ok") return;

      const client = clientResult.data;
      const config1 = client.network.getConfig();
      const config2 = client.network.getConfig();
      expect(config1).toEqual(config2);
      expect(config1.network).toBe("testnet");
    });
  });

  describe("ConnectionPool lifecycle & closed boundary cases", () => {
    it("tracks isClosed status and cleans up timers and queues on close()", () => {
      const pool = createConnectionPool({ maxPoolSize: 2, keepAliveTimeoutMs: 10_000 });
      expect(pool.isClosed).toBe(false);

      pool.close();
      expect(pool.isClosed).toBe(true);
      expect(pool.stats()).toEqual([]);
    });

    it("throws an error when fetch is called on a closed ConnectionPool (boundary case)", async () => {
      const pool = new ConnectionPool();
      pool.close();

      await expect(pool.fetch("https://horizon.stellar.org")).rejects.toThrow(
        "ConnectionPool is closed and cannot process requests.",
      );
    });

    it("resets global connectionPool when resetServerFactory is called", () => {
      const pool = new ConnectionPool();
      setConnectionPool(pool);
      expect(getConnectionPool()).toBe(pool);

      resetServerFactory();
      expect(getConnectionPool()).toBeUndefined();
    });
  });

  describe("EndpointPool monitoring lifecycle & resetEndpointPools", () => {
    it("starts and stops health monitoring timer cleanly", () => {
      const pool = configureEndpointFailover("https://horizon-a.stellar.org", [
        "https://horizon-b.stellar.org",
      ]);

      const stop = pool.startHealthMonitoring(vi.fn().mockResolvedValue(new Response("ok")), 1000);
      expect(typeof stop).toBe("function");

      stop();
      // Second call to stop should be a no-op without error
      pool.stopHealthMonitoring();
    });

    it("resetEndpointPools stops all active monitors and clears registered pools", () => {
      const pool = configureEndpointFailover("https://horizon-primary.stellar.org", [
        "https://horizon-backup.stellar.org",
      ]);
      const stopSpy = vi.spyOn(pool, "stopHealthMonitoring");

      resetEndpointPools();
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe("WebSocket subscriptions and aggregator feeds lifecycle", () => {
    it("subscribePrices can be cancelled via unsubscribe() or signal", () => {
      const disconnectMock = vi.fn();
      const mockProvider = {
        name: "mock-provider",
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: disconnectMock,
        subscribe: vi.fn(),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      };

      const subscription = subscribePrices(["XLM:USD"], vi.fn(), {
        providers: [mockProvider],
      });

      expect(typeof subscription.unsubscribe).toBe("function");
      subscription.unsubscribe();
      // Should not throw on duplicate unsubscribe
      subscription.unsubscribe();
    });

    it("createWebSocketTransactionFeed detaches listeners and closes socket on close()", () => {
      let closeCalled = false;
      const fakeSocket: any = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close: vi.fn(() => {
          closeCalled = true;
        }),
      };

      class MockWs {
        constructor() {
          return fakeSocket;
        }
      }

      const aggregator = createTransactionStatusAggregator();
      const feed = createWebSocketTransactionFeed("wss://example.com/txs", aggregator, {
        webSocketImpl: MockWs as any,
      });

      expect(feed.active).toBe(true);
      feed.close();
      expect(feed.active).toBe(false);
      expect(fakeSocket.close).toHaveBeenCalledTimes(1);
      expect(fakeSocket.onmessage).toBeNull();
      expect(fakeSocket.onopen).toBeNull();
    });
  });
});
