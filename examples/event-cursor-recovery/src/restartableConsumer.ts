/**
 * Restartable contract event consumer (#45).
 *
 * Event consumers must resume from a durable position after a restart without
 * losing events or replaying an unbounded history. This example wires
 * `subscribeContractEvents` to a small pluggable cursor store: every delivered
 * batch advances a persisted "last processed ledger", and on the next start
 * the consumer passes that ledger as `startLedger` so the subscription recovers
 * the events after it (bounded by `recoveryWindowMs`) instead of starting at
 * the tip and silently skipping the gap, or replaying from genesis.
 *
 * This module is framework-agnostic and has no I/O of its own beyond the fetch
 * it passes through. `InMemoryCursorStore` is shown for the example and tests;
 * swap in a file, database, or KV store by implementing `CursorStore`.
 *
 * The example lives inside the sorokit-core repository, so it imports the SDK
 * from source. In your own app the imports below become:
 *
 *   import { subscribeContractEvents } from "sorokit-core/soroban";
 *   import type { ContractEvent, ContractEventSubscriptionOptions } from "sorokit-core/soroban";
 */

import { subscribeContractEvents } from "../../../src/soroban/subscribeContractEvents";
import type {
  ContractEvent,
  ContractEventSubscriptionOptions,
} from "../../../src/soroban/subscribeContractEvents";

/**
 * Durable store for the last ledger a consumer has fully processed.
 *
 * `save` is called after each batch is delivered, so a restart resumes from a
 * recent ledger. Persist atomically with your downstream processing so the
 * cursor only advances once the events have been handled (write-ahead log,
 * transactional outbox, or a flush after the batch is durably recorded).
 */
export interface CursorStore {
  /** The last ledger the consumer has processed, or `undefined` on first run. */
  load(): number | undefined;
  /** Record that the consumer has processed up to and including `ledger`. */
  save(ledger: number): void;
}

/** A minimal in-memory cursor store, for the example and tests. */
export class InMemoryCursorStore implements CursorStore {
  private ledger: number | undefined;

  load(): number | undefined {
    return this.ledger;
  }

  save(ledger: number): void {
    // Monotonic — never rewind the cursor to an older ledger.
    if (this.ledger === undefined || ledger > this.ledger) {
      this.ledger = ledger;
    }
  }
}

export interface RestartableConsumerOptions {
  horizonUrl: string;
  store: CursorStore;
  /** Polling interval. Defaults to the SDK's 1500 ms. */
  intervalMs?: number;
  /**
   * How far back to recover after a restart / reconnection. Bounds replay so a
   * long downtime never replays an unbounded history. Defaults to 60 s.
   */
  recoveryWindowMs?: number;
  /** Inject a fetch (e.g. a test double). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Optional observer invoked with every delivered batch. */
  onEvents?: (events: ContractEvent[]) => void;
}

export interface RestartableConsumer {
  /** Begin polling. Resumes from the cursor held by the store, if any. */
  start(): void;
  /** Stop polling and release the subscription. Safe to call once. */
  stop(): void;
}

/**
 * Create a restartable consumer for a contract's events.
 *
 * @example
 * const store = new InMemoryCursorStore();
 * const consumer = createRestartableConsumer("C...", {
 *   horizonUrl: "https://horizon-testnet.stellar.org",
 *   store,
 *   onEvents: (events) => console.log(events.length, "new events"),
 * });
 * consumer.start();
 * // ...process events; the store advances the cursor each batch...
 * // On restart, create another consumer with the same store: it resumes
 * // from the persisted ledger via startLedger.
 */
export function createRestartableConsumer(
  contractId: string,
  options: RestartableConsumerOptions,
): RestartableConsumer {
  let unsubscribe: (() => void) | undefined;

  const handleBatch = (events: ContractEvent[]): void => {
    let maxLedger = -Infinity;
    for (const event of events) {
      if (typeof event.ledger === "number" && event.ledger > maxLedger) {
        maxLedger = event.ledger;
      }
    }
    // Only advance the cursor once a batch carries a ledger sequence.
    if (Number.isFinite(maxLedger)) {
      options.store.save(maxLedger);
    }
    options.onEvents?.(events);
  };

  return {
    start(): void {
      if (unsubscribe) return;
      const cursor = options.store.load();

      // Build the subscription options without ever assigning `undefined` to
      // an optional field (exactOptionalPropertyTypes-safe), and resume from
      // the persisted cursor when one exists.
      const subOptions: ContractEventSubscriptionOptions = {
        horizonUrl: options.horizonUrl,
        ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
        ...(options.recoveryWindowMs !== undefined
          ? { recoveryWindowMs: options.recoveryWindowMs }
          : {}),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
        ...(cursor !== undefined ? { startLedger: cursor } : {}),
      };

      unsubscribe = subscribeContractEvents(contractId, undefined, handleBatch, subOptions);
    },

    stop(): void {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    },
  };
}
