/**
 * Circuit breaker for RPC endpoint failures.
 *
 * Wraps the retry layer so that a consistently failing endpoint stops being
 * called immediately (fail-fast) instead of retrying for 30+ seconds.
 *
 * State machine:
 *   CLOSED    ──(failureThreshold consecutive transient failures)──▶  OPEN
 *   OPEN      ──(recoveryWindowMs + jitter)──────────────────────▶  HALF_OPEN
 *   HALF_OPEN ──(successThreshold consecutive probe successes)───▶  CLOSED
 *   HALF_OPEN ──(any probe failure)──────────────────────────────▶  OPEN
 *
 * Half-open state allows up to halfOpenMaxProbes concurrent probe requests.
 * Jittered cooldown prevents synchronized re-opening across endpoints.
 *
 * The circuit breaker is intentionally stateful: create one instance per
 * endpoint and reuse it across calls.
 */

import { isTransientError } from "../shared/errors";
import { createLogger } from "../infrastructure/logger";
import { recordOperationError, traceSpan } from "../performance/telemetry";

// ─── Public types ─────────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /**
   * Number of consecutive transient failures required to trip the circuit.
   * @default 5
   */
  failureThreshold?: number;
  /**
   * Milliseconds to wait in OPEN state before transitioning to HALF_OPEN.
   * @default 60_000
   */
  recoveryWindowMs?: number;
  /**
   * Maximum number of probe requests allowed concurrently in HALF_OPEN state.
   * The circuit closes only after successThreshold of them succeed.
   * @default 1
   */
  halfOpenMaxProbes?: number;
  /**
   * Number of consecutive probe successes in HALF_OPEN required to close
   * the circuit. Must not exceed halfOpenMaxProbes.
   * @default 1
   */
  successThreshold?: number;
  /**
   * Maximum random jitter added to the recovery window on each OPEN→HALF_OPEN
   * transition. Prevents synchronized re-opening when multiple breakers share
   * the same recoveryWindowMs.
   * Set to 0 to disable jitter (useful in tests).
   * @default 5_000
   */
  cooldownJitterMs?: number;
  /**
   * Optional callback invoked on every state transition.
   * Useful for metrics, logging, and alerting.
   */
  onStateChange?: (event: CircuitStateChangeEvent) => void;
}

export interface CircuitStateChangeEvent {
  endpoint: string;
  from: CircuitState;
  to: CircuitState;
  at: number;
  consecutiveFailures: number;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveProbeSuccesses: number;
  totalFailures: number;
  totalSuccesses: number;
  activeProbes: number;
  /** Epoch ms when the circuit was last opened, or null if never opened. */
  lastOpenedAt: number | null;
  /** Epoch ms when the circuit last transitioned to any state. */
  lastTransitionAt: number;
}

/** Thrown when a call is attempted while the circuit is OPEN. */
export class CircuitOpenError extends Error {
  readonly endpoint: string;
  readonly openedAt: number;

  constructor(endpoint: string, openedAt: number) {
    super(
      `Circuit breaker OPEN for "${endpoint}" — failing fast. ` +
        `Opened at ${new Date(openedAt).toISOString()}.`,
    );
    this.name = "CircuitOpenError";
    this.endpoint = endpoint;
    this.openedAt = openedAt;
  }
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RECOVERY_WINDOW_MS = 60_000;
const DEFAULT_HALF_OPEN_MAX_PROBES = 1;
const DEFAULT_SUCCESS_THRESHOLD = 1;
const DEFAULT_COOLDOWN_JITTER_MS = 5_000;

const logger = createLogger("circuit-breaker", "info");

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Circuit breaker state machine for a single RPC endpoint.
 *
 * @example
 * const cb = new CircuitBreaker("https://soroban-testnet.stellar.org", {
 *   halfOpenMaxProbes: 2,
 *   successThreshold: 2,
 *   cooldownJitterMs: 3000,
 * });
 *
 * const result = await cb.call(() => rpc.simulateTransaction(tx));
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private consecutiveProbeSuccesses = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private activeProbes = 0;
  private lastOpenedAt: number | null = null;
  private lastTransitionAt: number = Date.now();
  /** Epoch ms when the OPEN→HALF_OPEN transition is due (includes jitter). */
  private recoveryDueAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly recoveryWindowMs: number;
  private readonly halfOpenMaxProbes: number;
  private readonly successThreshold: number;
  private readonly cooldownJitterMs: number;
  private readonly onStateChange:
    | ((event: CircuitStateChangeEvent) => void)
    | undefined;

  constructor(
    readonly endpoint: string,
    config: CircuitBreakerConfig = {},
  ) {
    this.failureThreshold =
      config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.recoveryWindowMs =
      config.recoveryWindowMs ?? DEFAULT_RECOVERY_WINDOW_MS;
    this.halfOpenMaxProbes = Math.max(
      1,
      config.halfOpenMaxProbes ?? DEFAULT_HALF_OPEN_MAX_PROBES,
    );
    this.successThreshold = Math.min(
      this.halfOpenMaxProbes,
      Math.max(1, config.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD),
    );
    this.cooldownJitterMs = Math.max(
      0,
      config.cooldownJitterMs ?? DEFAULT_COOLDOWN_JITTER_MS,
    );
    this.onStateChange = config.onStateChange ?? undefined;
  }

  // ─── State queries ──────────────────────────────────────────────────────────

  get currentState(): CircuitState {
    this.checkRecovery();
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.currentState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveProbeSuccesses: this.consecutiveProbeSuccesses,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      activeProbes: this.activeProbes,
      lastOpenedAt: this.lastOpenedAt,
      lastTransitionAt: this.lastTransitionAt,
    };
  }

  // ─── Core call wrapper ──────────────────────────────────────────────────────

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - CLOSED: execute normally; track failures and successes.
   * - OPEN: throw `CircuitOpenError` immediately without calling `fn`.
   * - HALF_OPEN: allow up to halfOpenMaxProbes concurrent probes;
   *   close after successThreshold consecutive successes, reopen on failure.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.checkRecovery();

    if (this.state === "OPEN") {
      throw new CircuitOpenError(this.endpoint, this.lastOpenedAt!);
    }

    if (this.state === "HALF_OPEN" && this.activeProbes >= this.halfOpenMaxProbes) {
      // Probe slots exhausted — treat as open until a slot frees up.
      throw new CircuitOpenError(this.endpoint, this.lastOpenedAt!);
    }

    if (this.state === "HALF_OPEN") {
      this.activeProbes += 1;
    }

    return traceSpan(
      `circuit-breaker.call`,
      async () => {
        try {
          const result = await fn();
          this.onSuccess();
          return result;
        } catch (error) {
          if (isTransientError(error)) {
            this.onFailure();
          }
          throw error;
        } finally {
          if (this.state === "HALF_OPEN" || this.activeProbes > 0) {
            this.activeProbes = Math.max(0, this.activeProbes - 1);
          }
        }
      },
      { attributes: { endpoint: this.endpoint, state: this.state } },
    );
  }

  // ─── Manual reset ───────────────────────────────────────────────────────────

  /** Force the circuit back to CLOSED. Useful for tests or manual recovery. */
  reset(): void {
    this.consecutiveProbeSuccesses = 0;
    this.activeProbes = 0;
    this.recoveryDueAt = null;
    this.transition("CLOSED");
    this.consecutiveFailures = 0;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * If the circuit is OPEN and the jittered recovery window has elapsed,
   * transition to HALF_OPEN to allow probe requests.
   */
  private checkRecovery(): void {
    if (
      this.state === "OPEN" &&
      this.recoveryDueAt !== null &&
      Date.now() >= this.recoveryDueAt
    ) {
      this.consecutiveProbeSuccesses = 0;
      this.activeProbes = 0;
      this.transition("HALF_OPEN");
    }
  }

  private onSuccess(): void {
    this.totalSuccesses += 1;

    if (this.state === "HALF_OPEN") {
      this.consecutiveProbeSuccesses += 1;
      if (this.consecutiveProbeSuccesses >= this.successThreshold) {
        // Enough consecutive probe successes — close the circuit.
        this.consecutiveFailures = 0;
        this.consecutiveProbeSuccesses = 0;
        this.activeProbes = 0;
        this.transition("CLOSED");
      }
      return;
    }

    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    this.totalFailures += 1;
    this.consecutiveFailures += 1;

    if (this.state === "HALF_OPEN") {
      // Any probe failure reopens the circuit with a fresh jittered cooldown.
      this.consecutiveProbeSuccesses = 0;
      this.openCircuit();
      return;
    }

    if (
      this.state === "CLOSED" &&
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.openCircuit();
    }
  }

  /** Trip the circuit open and arm the jittered recovery timer. */
  private openCircuit(): void {
    this.lastOpenedAt = Date.now();
    const jitter =
      this.cooldownJitterMs > 0
        ? Math.floor(Math.random() * this.cooldownJitterMs)
        : 0;
    this.recoveryDueAt = this.lastOpenedAt + this.recoveryWindowMs + jitter;
    this.transition("OPEN");
    recordOperationError("circuit_breaker", {
      endpoint: this.endpoint,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;
    this.lastTransitionAt = Date.now();

    logger.info(`Circuit breaker transition: ${from} → ${to}`, {
      operationId: "circuit-breaker",
      network: this.endpoint,
      consecutiveFailures: this.consecutiveFailures,
      at: new Date(this.lastTransitionAt).toISOString(),
    });

    this.onStateChange?.({
      endpoint: this.endpoint,
      from,
      to,
      at: this.lastTransitionAt,
      consecutiveFailures: this.consecutiveFailures,
    });
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * A lightweight registry that creates and reuses `CircuitBreaker` instances
 * keyed by endpoint URL.
 *
 * @example
 * const registry = new CircuitBreakerRegistry({ halfOpenMaxProbes: 2 });
 * const result = await registry.call(rpcUrl, () => rpc.simulateTransaction(tx));
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = config;
  }

  /** Get or create the breaker for a given endpoint. */
  getBreakerFor(endpoint: string): CircuitBreaker {
    let breaker = this.breakers.get(endpoint);
    if (!breaker) {
      breaker = new CircuitBreaker(endpoint, this.config);
      this.breakers.set(endpoint, breaker);
    }
    return breaker;
  }

  /** Convenience wrapper: call `fn` through the breaker for `endpoint`. */
  async call<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    return this.getBreakerFor(endpoint).call(fn);
  }

  /** Metrics snapshot for all tracked endpoints. */
  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const result: Record<string, CircuitBreakerMetrics> = {};
    for (const [endpoint, breaker] of this.breakers) {
      result[endpoint] = breaker.getMetrics();
    }
    return result;
  }

  /** Reset all breakers — useful between tests. */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
