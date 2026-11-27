/**
 * HTTP 429 response helper for rate-limit signals (#146).
 *
 * Maps a structured RateLimitSignal to a plain HTTP 429 response descriptor
 * that server code can use to reply to its own clients with a correct
 * Retry-After header.
 */

import type { RateLimitSignal } from "./adaptiveRateLimiter";

export interface RateLimitHttpResponse {
  status: 429;
  headers: { "Retry-After": string };
  body: {
    error: string;
    retryAfterMs: number;
    reason: string;
  };
}

/**
 * Convert a RateLimitSignal into an HTTP 429 response descriptor.
 *
 * The `Retry-After` header value is expressed in whole seconds (ceiling of
 * `retryAfterMs / 1000`), as required by RFC 7231.
 *
 * @example
 * const signal = limiter.getSignal(endpoint);
 * if (signal) {
 *   const { status, headers, body } = rateLimitSignalToResponse(signal);
 *   res.set(headers).status(status).json(body);
 * }
 */
export function rateLimitSignalToResponse(
  signal: RateLimitSignal,
): RateLimitHttpResponse {
  const retryAfterSeconds = Math.ceil(signal.retryAfterMs / 1000);
  return {
    status: 429,
    headers: {
      "Retry-After": String(retryAfterSeconds),
    },
    body: {
      error: "Too Many Requests",
      retryAfterMs: signal.retryAfterMs,
      reason: signal.reason,
    },
  };
}
