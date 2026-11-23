import { recordThrottleEvent } from "../performance/telemetry";

export interface RateLimitState {
  endpoint: string;
  retryAfterMs: number;
  consecutive429s: number;
  updatedAt: number;
}

/**
 * Structured backoff signal returned to callers when an endpoint is throttled.
 * Carries enough information for a server to synthesise a downstream HTTP 429.
 */
export interface RateLimitSignal {
  /** Why throttling was applied. */
  reason: "server-429" | "congestion" | "budget-exceeded" | "proactive";
  /**
   * Milliseconds the caller should wait before retrying.
   * Always in [0, maxDelayMs].
   */
  retryAfterMs: number;
  /**
   * Fraction of the request budget still available, in [0, 1].
   * 0 means fully exhausted; 1 means entirely unaffected.
   */
  remainingBudget: number;
  /** The endpoint this signal applies to. */
  endpoint: string;
  /** Epoch ms when the signal was generated. */
  triggeredAt: number;
}

export interface AdaptiveRateLimiterOptions {
  /** Initial delay between requests to an endpoint. */
  initialDelayMs?: number;
  /** Maximum delay imposed by server feedback. */
  maxDelayMs?: number;
  /** Optional clock for deterministic tests. */
  now?: () => number;
}

export interface RateLimitedResponse {
  status: number;
  headers?: { get(name: string): string | null };
}

const DEFAULT_INITIAL_DELAY_MS = 0;
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000;

/** Budget decay: each consecutive 429 reduces remaining budget linearly, floored at 0. */
function computeRemainingBudget(consecutive429s: number): number {
  return Math.max(0, 1 - consecutive429s / 10);
}

/**
 * Adaptive client-side throttling for Horizon and Soroban RPC endpoints.
 * A 429 response updates only the endpoint that produced it; unrelated
 * endpoints continue at their own pace.
 */
export class AdaptiveRateLimiter {
  private readonly states = new Map<string, RateLimitState>();
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly signals = new Map<string, RateLimitSignal>();

  constructor(options: AdaptiveRateLimiterOptions = {}) {
    this.initialDelayMs = Math.max(0, options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
    this.maxDelayMs = Math.max(this.initialDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
    this.now = options.now ?? Date.now;
  }

  /** Return the current server-imposed delay for an endpoint. */
  getDelay(endpoint: string): number {
    const state = this.states.get(endpoint);
    const serverDelay = state?.retryAfterMs ?? this.initialDelayMs;
    return Math.max(0, Math.max(serverDelay, (this.nextAllowedAt.get(endpoint) ?? 0) - this.now()));
  }

  /** Wait until a request to the endpoint is allowed. */
  async acquire(endpoint: string): Promise<void> {
    const delay = this.getDelay(endpoint);
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    this.nextAllowedAt.set(endpoint, this.now() + this.initialDelayMs);
  }

  /** Record response feedback, including Retry-After on a 429 response. */
  recordResponse(endpoint: string, response: RateLimitedResponse): void {
    if (response.status !== 429) {
      this.states.delete(endpoint);
      this.signals.delete(endpoint);
      return;
    }
    const previous = this.states.get(endpoint);
    const retryAfterMs = Math.min(
      this.maxDelayMs,
      parseRetryAfter(response.headers?.get("Retry-After"), this.now()) ??
        Math.min(this.maxDelayMs, Math.max(1000, (previous?.retryAfterMs ?? 1000) * 2)),
    );
    const consecutive429s = (previous?.consecutive429s ?? 0) + 1;
    this.states.set(endpoint, {
      endpoint,
      retryAfterMs,
      consecutive429s,
      updatedAt: this.now(),
    });
    this.nextAllowedAt.set(endpoint, this.now() + retryAfterMs);

    const signal: RateLimitSignal = {
      reason: "server-429",
      retryAfterMs,
      remainingBudget: computeRemainingBudget(consecutive429s),
      endpoint,
      triggeredAt: this.now(),
    };
    this.signals.set(endpoint, signal);
    recordThrottleEvent(endpoint, signal.reason, retryAfterMs);
  }

  getState(endpoint: string): RateLimitState | undefined {
    const state = this.states.get(endpoint);
    return state ? { ...state } : undefined;
  }

  /**
   * Returns the current throttle signal for an endpoint, or undefined when
   * the endpoint is not currently throttled.
   */
  getSignal(endpoint: string): RateLimitSignal | undefined {
    const signal = this.signals.get(endpoint);
    if (!signal) return undefined;
    // Clear stale signals whose window has passed.
    if (this.now() >= signal.triggeredAt + signal.retryAfterMs) {
      this.signals.delete(endpoint);
      return undefined;
    }
    return { ...signal };
  }

  reset(endpoint?: string): void {
    if (endpoint === undefined) {
      this.states.clear();
      this.nextAllowedAt.clear();
      this.signals.clear();
    } else {
      this.states.delete(endpoint);
      this.nextAllowedAt.delete(endpoint);
      this.signals.delete(endpoint);
    }
  }

  /** Execute a request with endpoint-specific throttling and feedback handling. */
  async fetch<T extends RateLimitedResponse>(
    endpoint: string,
    request: () => Promise<T>,
  ): Promise<T> {
    await this.acquire(endpoint);
    const response = await request();
    this.recordResponse(endpoint, response);
    return response;
  }
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

export const adaptiveRateLimiter = new AdaptiveRateLimiter();
export default AdaptiveRateLimiter;
