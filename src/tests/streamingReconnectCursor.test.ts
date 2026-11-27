import { describe, expect, it, vi } from "vitest";
import {
  createControllableStream,
  createMockHorizonStreamFetch,
} from "../testing/mockStream";
import {
  MemoryCursorStore,
  PersistentEventDeduplicationStore,
} from "../streaming/cursorStore";

describe("streaming reconnect and cursor integration tests (#79)", () => {
  it("advances cursor monotonically as new records arrive", async () => {
    const stream = createControllableStream<string>();
    const cursorStore = new MemoryCursorStore();
    const storageKey = "account:stream:cursor";

    stream.emit("tx_1", "cursor_101", "id_1");
    stream.emit("tx_2", "cursor_102", "id_2");
    stream.emit("tx_3", "cursor_103", "id_3");

    const received: string[] = [];
    const cursors: string[] = [];

    for await (const { record, cursor } of stream.consume()) {
      received.push(record.data);
      cursors.push(cursor);
      await cursorStore.save(storageKey, cursor);

      if (received.length === 3) break;
    }

    expect(received).toEqual(["tx_1", "tx_2", "tx_3"]);
    expect(cursors).toEqual(["cursor_101", "cursor_102", "cursor_103"]);

    const finalSaved = await cursorStore.load(storageKey);
    expect(finalSaved).toBe("cursor_103");
  });

  it("resumes from last saved cursor after disconnect without skipping or replaying", async () => {
    const onDisconnect = vi.fn();
    const onConnect = vi.fn();
    const stream = createControllableStream<string>({
      onConnect,
      onDisconnect,
    });

    const cursorStore = new MemoryCursorStore();
    const storageKey = "account:tx:cursor";

    // 1. Emit first batch
    stream.emit("tx_1", "c1", "id_1");
    stream.emit("tx_2", "c2", "id_2");

    const processed: string[] = [];

    // Phase 1: consume until caught up with initial batch
    for await (const { record, cursor } of stream.consume()) {
      processed.push(record.data);
      await cursorStore.save(storageKey, cursor);
      if (processed.length === 2) break;
    }

    expect(processed).toEqual(["tx_1", "tx_2"]);
    expect(await cursorStore.load(storageKey)).toBe("c2");

    // 2. More events arrive on server side
    stream.emit("tx_3", "c3", "id_3");
    stream.emit("tx_4", "c4", "id_4");

    // 3. Simulate transport disconnect
    stream.disconnect(new Error("Connection reset by peer"));
    expect(stream.isDisconnected).toBe(true);
    expect(onDisconnect).toHaveBeenCalled();

    // 4. Simulate consumer reconnect workflow:
    // Consumer reconnects using the saved cursor position
    stream.reconnect();
    expect(stream.isDisconnected).toBe(false);

    const savedCursor = await cursorStore.load(storageKey);
    expect(savedCursor).toBe("c2");

    const reconnectedStream = stream.consume({ cursor: savedCursor });

    for await (const { record, cursor } of reconnectedStream) {
      processed.push(record.data);
      await cursorStore.save(storageKey, cursor);
      if (processed.length === 4) break;
    }

    // Asserts: exactly items 3 and 4 received after reconnect, no duplicates, no missing items
    expect(processed).toEqual(["tx_1", "tx_2", "tx_3", "tx_4"]);
    expect(await cursorStore.load(storageKey)).toBe("c4");
    expect(onConnect).toHaveBeenCalledWith("c2");
  });

  it("handles duplicate replay on boundary using PersistentEventDeduplicationStore", async () => {
    const stream = createControllableStream<string>();
    const dedupStore = new PersistentEventDeduplicationStore(100, 60_000);
    const cursorStore = new MemoryCursorStore();
    const storageKey = "wallet:stream:cursor";

    stream.emit("tx_alpha", "cursor_1", "tx_alpha");
    stream.emit("tx_beta", "cursor_2", "tx_beta");

    const seen: string[] = [];
    const duplicateFlags: boolean[] = [];

    // Process initial events
    for await (const { record, cursor, isDuplicate } of stream.consume({
      deduplicationStore: dedupStore,
    })) {
      seen.push(record.data);
      duplicateFlags.push(isDuplicate);
      await cursorStore.save(storageKey, cursor);
      if (seen.length === 2) break;
    }

    expect(seen).toEqual(["tx_alpha", "tx_beta"]);
    expect(duplicateFlags).toEqual([false, false]);

    // Simulate server replaying tx_beta on reconnect (common at-least-once edge case)
    stream.emit("tx_beta", "cursor_2", "tx_beta");
    stream.emit("tx_gamma", "cursor_3", "tx_gamma");

    const resumedSeen: string[] = [];
    const resumedDuplicates: boolean[] = [];

    // Reconnect starting from cursor_1 (so tx_beta is re-delivered)
    for await (const { record, cursor, isDuplicate } of stream.consume({
      cursor: "cursor_1",
      deduplicationStore: dedupStore,
    })) {
      if (!isDuplicate) {
        resumedSeen.push(record.data);
      }
      resumedDuplicates.push(isDuplicate);
      await cursorStore.save(storageKey, cursor);
      if (resumedDuplicates.length === 2) break;
    }

    // tx_beta was flagged as duplicate; tx_gamma was accepted
    expect(resumedDuplicates).toEqual([true, false]);
    expect(resumedSeen).toEqual(["tx_gamma"]);
    expect(await cursorStore.load(storageKey)).toBe("cursor_3");
  });

  it("cleans up resources and listeners on consumer AbortSignal cancel", async () => {
    const onCleanup = vi.fn();
    const stream = createControllableStream<string>({ onCleanup });

    expect(stream.activeConsumers).toBe(0);

    const controller = new AbortController();
    const consumer = stream.consume({ signal: controller.signal });

    // Start consuming in the background
    const consumptionPromise = (async () => {
      const records: string[] = [];
      for await (const { record } of consumer) {
        records.push(record.data);
      }
      return records;
    })();

    // Stream currently has 1 active consumer waiting
    expect(stream.activeConsumers).toBe(1);

    // Abort the stream
    controller.abort();

    const result = await consumptionPromise;
    expect(result).toEqual([]);

    // Verify cleanup
    expect(stream.activeConsumers).toBe(0);
    expect(onCleanup).toHaveBeenCalled();
  });

  it("rejects waiting consumers when disconnect occurs mid-await", async () => {
    const stream = createControllableStream<string>();

    const consumer = stream.consume();
    const nextPromise = consumer.next();

    // Disconnect while consumer is suspended awaiting next item
    const disconnectError = new Error("Transport reset");
    stream.disconnect(disconnectError);

    await expect(nextPromise).rejects.toThrow("Transport reset");
    expect(stream.activeConsumers).toBe(0);
  });

  it("reconnects with mock Horizon stream fetch advancing cursor and avoiding skips", async () => {
    const mockHorizon = createMockHorizonStreamFetch({
      pages: [
        [
          { hash: "tx_h1", paging_token: "h_token_1" },
          { hash: "tx_h2", paging_token: "h_token_2" },
        ],
        [
          { hash: "tx_h3", paging_token: "h_token_3" },
        ],
      ],
      disconnectAfterCalls: 1,
    });

    // First poll (poll 1)
    const resp1 = await mockHorizon.fetch("https://horizon.example.com/accounts/GABC/transactions?cursor=0");
    const json1 = (await resp1.json()) as { _embedded: { records: Array<{ hash: string; paging_token: string }> } };
    expect(json1._embedded.records).toHaveLength(2);
    expect(json1._embedded.records[1]?.paging_token).toBe("h_token_2");

    // Second poll fails due to disconnect
    await expect(
      mockHorizon.fetch("https://horizon.example.com/accounts/GABC/transactions?cursor=h_token_2"),
    ).rejects.toThrow("Horizon connection dropped");

    // Reconnect and poll with saved cursor
    mockHorizon.reconnect();
    const resp2 = await mockHorizon.fetch("https://horizon.example.com/accounts/GABC/transactions?cursor=h_token_2");
    const json2 = (await resp2.json()) as { _embedded: { records: Array<{ hash: string; paging_token: string }> } };
    expect(json2._embedded.records).toHaveLength(1);
    expect(json2._embedded.records[0]?.hash).toBe("tx_h3");
    expect(mockHorizon.getLastRequestedCursor()).toBe("h_token_2");
  });

  it("handles empty stream close cleanly", async () => {
    const stream = createControllableStream<string>();
    const consumer = stream.consume();

    const nextPromise = consumer.next();
    stream.close();

    const result = await nextPromise;
    expect(result.done).toBe(true);
    expect(stream.isClosed).toBe(true);
  });
});
