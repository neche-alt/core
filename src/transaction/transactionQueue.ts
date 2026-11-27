/**
 * Transaction queue with prioritized scheduling and batch submission.
 *
 * Supports multiple priority levels (low, normal, high, critical), automatic
 * scheduling of eligible transactions, grouping compatible submissions, and
 * preservation of ordering for dependent transactions.
 */

import { err, ok } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import { SorokitErrorCategory, SorokitErrorCode } from "../shared/response";

/**
 * Priority level for queue scheduling.
 *
 * Kept separate from the fee-estimation `TransactionPriority` (which uses
 * "urgent" rather than "critical").
 */
export type QueuePriority = "low" | "normal" | "high" | "critical";

/**
 * Queue item status.
 */
export type QueueItemStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Queued transaction.
 */
export interface QueuedTransaction {
  /** Unique transaction identifier */
  id: string;
  /** Transaction envelope XDR */
  envelopeXdr: string;
  /** Priority level */
  priority: QueuePriority;
  /** Current status */
  status: QueueItemStatus;
  /** Dependencies on other transaction IDs */
  dependsOn?: string[] | undefined;
  /** When this transaction was queued (Unix milliseconds) */
  queuedAt: number;
  /** When processing started (Unix milliseconds) */
  processingStartedAt?: number | undefined;
  /** When processing completed (Unix milliseconds) */
  completedAt?: number | undefined;
  /** Error message if failed */
  error?: string | undefined;
  /** Number of retry attempts */
  retryCount: number;
  /** Maximum retry attempts allowed */
  maxRetries: number;
  /** Result hash if transaction was submitted successfully */
  resultHash?: string | undefined;
}

/**
 * Queue state snapshot.
 */
export interface QueueState {
  /** Pending transactions waiting to be processed */
  pending: number;
  /** Transactions currently being processed */
  processing: number;
  /** Successfully completed transactions */
  completed: number;
  /** Failed transactions */
  failed: number;
}

/**
 * Batch submission result.
 */
export interface BatchSubmissionResult {
  /** Batch identifier */
  batchId: string;
  /** Transaction IDs included in this batch */
  transactionIds: string[];
  /** Submission timestamp */
  submittedAt: number;
  /** Individual transaction results */
  results: Map<string, { success: boolean; hash?: string; error?: string }>;
}

/**
 * Retry policy configuration.
 */
export interface RetryPolicy {
  /** Maximum retry attempts per transaction */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
  /** Exponential backoff multiplier for retries */
  backoffMultiplier?: number;
}

/**
 * Weight multipliers controlling how many slots each priority level receives
 * per drain cycle. Higher weight = more slots allocated proportionally.
 */
export interface PriorityWeights {
  low: number;
  normal: number;
  high: number;
  critical: number;
}

/**
 * Observable metrics for the transaction queue.
 */
export interface QueueMetrics {
  /** Total number of pending transactions */
  depth: number;
  /** Pending transaction count per priority level */
  byPriority: Record<QueuePriority, number>;
  /** Number of transactions currently in-flight */
  processing: number;
  /** Average time (ms) pending transactions have been waiting */
  avgWaitMs: number;
  /** Whether the concurrent submission cap is currently reached */
  backpressureActive: boolean;
}

/**
 * Queue configuration options.
 */
export interface TransactionQueueConfig {
  /** Maximum batch size for submission */
  batchSize?: number;
  /** Scheduling interval in milliseconds */
  schedulingIntervalMs?: number;
  /** Retry policy for failed transactions */
  retryPolicy?: RetryPolicy;
  /** Maximum queue size before rejecting new items */
  maxQueueSize?: number;
  /** Maximum number of concurrently in-flight (processing) transactions. Default: 10 */
  maxConcurrentSubmissions?: number;
  /**
   * When `maxConcurrentSubmissions` is reached:
   * - `'reject'` returns an error immediately.
   * - `'defer'` allows the enqueue and the item waits pending until capacity frees.
   * Default: `'reject'`
   */
  backpressureMode?: "reject" | "defer";
  /**
   * Weight multipliers for draining — higher weight = more slots per drain cycle.
   * Default: `{ low: 1, normal: 2, high: 4, critical: 8 }`
   */
  priorityWeights?: PriorityWeights;
}

// Default configuration
const DEFAULT_CONFIG: Required<TransactionQueueConfig> = {
  batchSize: 10,
  schedulingIntervalMs: 5000,
  retryPolicy: {
    maxRetries: 3,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
  },
  maxQueueSize: 1000,
  maxConcurrentSubmissions: 10,
  backpressureMode: "reject",
  priorityWeights: { low: 1, normal: 2, high: 4, critical: 8 },
};

/**
 * Transaction queue with priority scheduling.
 *
 * Manages transaction submissions with configurable priorities, automatic
 * batching, retry logic, and dependency tracking.
 */
export class TransactionQueue {
  private queue: Map<string, QueuedTransaction> = new Map();
  private config: Required<TransactionQueueConfig>;
  private processingScheduleId?: NodeJS.Timeout | undefined;
  private batchCounter: number = 0;

  /**
   * Create a new transaction queue.
   *
   * @param config - Queue configuration (optional)
   */
  constructor(config?: TransactionQueueConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a transaction to the queue.
   *
   * @param id - Unique transaction ID
   * @param envelopeXdr - Transaction envelope XDR
   * @param priority - Priority level (default: "normal")
   * @param dependsOn - Optional dependency on other transaction IDs
   * @returns Queue item or error
   */
  enqueue(
    id: string,
    envelopeXdr: string,
    priority: QueuePriority = "normal",
    dependsOn?: string[],
  ): SorokitResult<QueuedTransaction> {
    try {
      // Check for duplicates
      if (this.queue.has(id)) {
        return err(
          SorokitErrorCode.INVALID_CONFIG,
          "Transaction with this ID already exists in queue",
          undefined,
          undefined,
          {
            context: {
              operation: "enqueue",
              parameters: { id },
            },
          },
        );
      }

      // Check queue size limit
      if (this.queue.size >= this.config.maxQueueSize) {
        return err(
          SorokitErrorCode.TX_SUBMIT_FAILED,
          "Queue is full",
          undefined,
          undefined,
          {
            context: {
              operation: "enqueue",
              parameters: { queueSize: this.queue.size },
            },
          },
        );
      }

      // Backpressure: reject immediately when concurrent submission cap is hit.
      if (this.config.backpressureMode === "reject") {
        let processingCount = 0;
        for (const tx of this.queue.values()) {
          if (tx.status === "processing") processingCount++;
        }
        if (processingCount >= this.config.maxConcurrentSubmissions) {
          return err(
            SorokitErrorCode.TX_SUBMIT_FAILED,
            "Queue capacity exceeded; backpressure active",
            undefined,
            undefined,
            {
              context: {
                operation: "enqueue",
                parameters: { processing: processingCount, maxConcurrentSubmissions: this.config.maxConcurrentSubmissions },
              },
            },
          );
        }
      }

      // Validate dependencies exist
      if (dependsOn) {
        for (const depId of dependsOn) {
          if (!this.queue.has(depId)) {
            return err(
              SorokitErrorCode.INVALID_CONFIG,
              `Dependency transaction ${depId} not found in queue`,
              undefined,
              undefined,
              {
                context: {
                  operation: "enqueue",
                  parameters: { id, dependsOn },
                },
              },
            );
          }
        }
      }

      const transaction: QueuedTransaction = {
        id,
        envelopeXdr,
        priority,
        status: "pending",
        dependsOn,
        queuedAt: Date.now(),
        retryCount: 0,
        maxRetries: this.config.retryPolicy.maxRetries,
      };

      this.queue.set(id, transaction);
      return ok(transaction);
    } catch (error) {
      return err(
        SorokitErrorCode.INTERNAL,
        "Failed to enqueue transaction",
        error,
        undefined,
        {
          context: {
            operation: "enqueue",
          },
        },
      );
    }
  }

  /**
   * Get current queue state.
   *
   * @returns Queue state with counts
   */
  getState(): QueueState {
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const tx of this.queue.values()) {
      switch (tx.status) {
        case "pending":
          pending++;
          break;
        case "processing":
          processing++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
      }
    }

    return { pending, processing, completed, failed };
  }

  /**
   * Get next batch of transactions ready to submit.
   *
   * Transactions are drained using weighted priority: each priority level is
   * allocated slots proportional to its weight so higher-priority work is
   * never starved by bulk low-priority submissions, while lower-priority
   * transactions still make progress.
   *
   * The returned batch is also bounded by `maxConcurrentSubmissions` minus
   * the current in-flight count so the submission cap is never exceeded.
   *
   * @returns Array of ready transactions ordered highest-priority first.
   */
  getNextBatch(): QueuedTransaction[] {
    const weights = this.config.priorityWeights;
    const priorities: QueuePriority[] = ["critical", "high", "normal", "low"];

    // Collect ready (pending + dependencies met) transactions per priority.
    const buckets: Record<QueuePriority, QueuedTransaction[]> = {
      critical: [],
      high: [],
      normal: [],
      low: [],
    };

    for (const tx of this.queue.values()) {
      if (tx.status !== "pending") continue;

      if (tx.dependsOn && tx.dependsOn.length > 0) {
        const allMet = tx.dependsOn.every(
          (depId) => this.queue.get(depId)?.status === "completed",
        );
        if (!allMet) continue;
      }

      buckets[tx.priority].push(tx);
    }

    // Respect concurrent submission cap.
    let processingCount = 0;
    for (const tx of this.queue.values()) {
      if (tx.status === "processing") processingCount++;
    }
    const capacityRemaining = Math.max(
      0,
      this.config.maxConcurrentSubmissions - processingCount,
    );
    const slotLimit = Math.min(this.config.batchSize, capacityRemaining);

    if (slotLimit === 0) return [];

    // Weighted round-robin: allocate slots proportional to weight.
    const totalWeight = priorities.reduce((sum, p) => sum + weights[p], 0);
    const batch: QueuedTransaction[] = [];

    // Compute per-bucket slot allocations (floor, then distribute remainder).
    const rawAllocs = priorities.map((p) =>
      Math.floor((weights[p] / totalWeight) * slotLimit),
    );
    let allocated = rawAllocs.reduce((s, n) => s + n, 0);
    // Distribute remaining slots to buckets with the largest fractional parts.
    const fracs = priorities.map((p, i) => ({
      p,
      i,
      frac: (weights[p] / totalWeight) * slotLimit - rawAllocs[i]!,
    }));
    fracs.sort((a, b) => b.frac - a.frac);
    for (const { i } of fracs) {
      if (allocated >= slotLimit) break;
      rawAllocs[i]!++;
      allocated++;
    }

    for (let pi = 0; pi < priorities.length; pi++) {
      const p = priorities[pi]!;
      const slots = rawAllocs[pi]!;
      const bucket = buckets[p];
      for (let j = 0; j < slots && j < bucket.length; j++) {
        batch.push(bucket[j]!);
      }
    }

    // If some high-priority buckets were under-allocated (fewer items than
    // slots), redistribute leftover slots to lower buckets, highest first.
    let used = batch.length;
    if (used < slotLimit) {
      for (const p of priorities) {
        const bucket = buckets[p];
        for (const tx of bucket) {
          if (used >= slotLimit) break;
          if (!batch.includes(tx)) {
            batch.push(tx);
            used++;
          }
        }
        if (used >= slotLimit) break;
      }
    }

    return batch;
  }

  /**
   * Returns observable metrics for the current queue state.
   *
   * Use these values to feed telemetry (see `recordQueueDepth` and
   * `recordQueueWaitTime` in `src/performance/telemetry.ts`).
   */
  getQueueMetrics(): QueueMetrics {
    const byPriority: Record<QueuePriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };
    let processing = 0;
    let totalWaitMs = 0;
    let pendingCount = 0;
    const now = Date.now();

    for (const tx of this.queue.values()) {
      if (tx.status === "pending") {
        byPriority[tx.priority]++;
        totalWaitMs += now - tx.queuedAt;
        pendingCount++;
      } else if (tx.status === "processing") {
        processing++;
      }
    }

    return {
      depth: pendingCount,
      byPriority,
      processing,
      avgWaitMs: pendingCount > 0 ? totalWaitMs / pendingCount : 0,
      backpressureActive: processing >= this.config.maxConcurrentSubmissions,
    };
  }

  /**
   * Mark a transaction as completed.
   *
   * @param id - Transaction ID
   * @param resultHash - Optional transaction result hash
   * @returns Success or error
   */
  markCompleted(id: string, resultHash?: string): SorokitResult<void> {
    const tx = this.queue.get(id);
    if (!tx) {
      return err(
        SorokitErrorCode.TX_NOT_FOUND,
        `Transaction ${id} not found in queue`,
        undefined,
        undefined,
        {
          context: {
            operation: "markCompleted",
            parameters: { id },
          },
        },
      );
    }

    tx.status = "completed";
    tx.completedAt = Date.now();
    if (resultHash) {
      tx.resultHash = resultHash;
    }

    return ok(undefined);
  }

  /**
   * Mark a transaction as failed and potentially retry.
   *
   * @param id - Transaction ID
   * @param error - Error message
   * @returns Success, retry scheduled, or error
   */
  markFailed(id: string, error: string): SorokitResult<"retry" | "failed"> {
    const tx = this.queue.get(id);
    if (!tx) {
      return err(
        SorokitErrorCode.TX_NOT_FOUND,
        `Transaction ${id} not found in queue`,
        undefined,
        undefined,
        {
          context: {
            operation: "markFailed",
            parameters: { id },
          },
        },
      );
    }

    tx.error = error;
    tx.retryCount++;

    if (tx.retryCount < tx.maxRetries) {
      tx.status = "pending";
      return ok("retry");
    }

    tx.status = "failed";
    return ok("failed");
  }

  /**
   * Get a specific transaction from the queue.
   *
   * @param id - Transaction ID
   * @returns Queued transaction or undefined
   */
  get(id: string): QueuedTransaction | undefined {
    return this.queue.get(id);
  }

  /**
   * Cancel a transaction in the queue.
   *
   * Removes pending transactions (cannot cancel processing/completed ones).
   *
   * @param id - Transaction ID
   * @returns Success or error
   */
  cancel(id: string): SorokitResult<void> {
    const tx = this.queue.get(id);
    if (!tx) {
      return err(
        SorokitErrorCode.TX_NOT_FOUND,
        `Transaction ${id} not found in queue`,
        undefined,
        undefined,
        {
          context: {
            operation: "cancel",
            parameters: { id },
          },
        },
      );
    }

    if (tx.status !== "pending") {
      return err(
        SorokitErrorCode.INVALID_CONFIG,
        "Can only cancel pending transactions",
        undefined,
        undefined,
        {
          context: {
            operation: "cancel",
            parameters: { id, status: tx.status },
          },
        },
      );
    }

    this.queue.delete(id);
    return ok(undefined);
  }

  /**
   * Clear all transactions from the queue.
   *
   * Optionally filter by status.
   *
   * @param status - Filter by status (optional)
   */
  clear(status?: QueueItemStatus): void {
    if (!status) {
      this.queue.clear();
    } else {
      for (const [id, tx] of this.queue.entries()) {
        if (tx.status === status) {
          this.queue.delete(id);
        }
      }
    }
  }

  /**
   * Start automatic scheduling (for testing).
   *
   * @param submissionFn - Function to call for batch submission
   */
  startScheduling(
    submissionFn: (
      batch: QueuedTransaction[],
    ) => Promise<BatchSubmissionResult>,
  ): void {
    if (this.processingScheduleId) return;

    this.processingScheduleId = setInterval(() => {
      const batch = this.getNextBatch();
      if (batch.length > 0) {
        // Mark as processing
        for (const tx of batch) {
          tx.status = "processing";
          tx.processingStartedAt = Date.now();
        }

        submissionFn(batch)
          .then((batchResult) => {
            // Correlate results back to queued transactions by ID, not by
            // array index.  Results may arrive out of order when the
            // submissionFn executes operations concurrently, so we always
            // look up each transaction by its stable queue ID rather than
            // relying on positional correspondence.
            for (const tx of batch) {
              const result = batchResult.results.get(tx.id);
              if (result === undefined) {
                // submissionFn did not report a result for this ID — treat
                // as a failure so the transaction can be retried.
                this.markFailed(tx.id, "No result returned for transaction");
              } else if (result.success) {
                this.markCompleted(tx.id, result.hash);
              } else {
                this.markFailed(tx.id, result.error ?? "Submission failed");
              }
            }
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            for (const tx of batch) {
              this.markFailed(tx.id, message);
            }
          });
      }
    }, this.config.schedulingIntervalMs);
  }

  /**
   * Stop automatic scheduling.
   */
  stopScheduling(): void {
    if (this.processingScheduleId) {
      clearInterval(this.processingScheduleId);
      this.processingScheduleId = undefined;
    }
  }
}
