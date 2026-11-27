/**
 * Browser bundle smoke fixture (#116).
 *
 * Imports only from the SDK's documented public entry points and exercises
 * each import enough to surface missing exports or Node-only dependency leaks
 * at build time. The `runSmoke` function is called by the CI smoke check and
 * by the focused Vitest test.
 */

import { createEndpointRegistry } from "../../src/network/endpointRegistry";
import { EndpointPool } from "../../src/network/endpointFailover";
import { validateTelemetryConfig } from "../../src/performance/telemetry";
import { ok, err, SorokitErrorCode } from "../../src/shared/response";
import type { SorokitResult } from "../../src/shared/response";

export interface SmokeResult {
  ok: true;
  checks: string[];
}

/**
 * Run all smoke checks. Returns `{ ok: true }` when every public import
 * resolves and behaves as documented. Throws on the first failure so the
 * CI step exits non-zero with a clear message.
 */
export function runSmoke(): SmokeResult {
  const checks: string[] = [];

  // ── EndpointRegistry ──────────────────────────────────────────────────────
  const registry = createEndpointRegistry();
  const reg = registry.registerEndpoint("horizon", "https://horizon.stellar.org");
  if (reg.status !== "ok") throw new Error("registerEndpoint returned error");
  checks.push("EndpointRegistry.registerEndpoint");

  const scores = registry.getHealthScores("horizon");
  if (!Array.isArray(scores) || scores.length !== 1) {
    throw new Error("getHealthScores returned unexpected result");
  }
  checks.push("EndpointRegistry.getHealthScores");

  // ── EndpointPool ──────────────────────────────────────────────────────────
  const pool = new EndpointPool(["https://horizon.stellar.org", "https://horizon-testnet.stellar.org"]);
  if (typeof pool.current !== "string") throw new Error("EndpointPool.current is not a string");
  checks.push("EndpointPool.current");

  pool.markSuccess("https://horizon.stellar.org", 42);
  pool.markFailure("https://horizon-testnet.stellar.org");
  checks.push("EndpointPool.markSuccess / markFailure");

  // ── TelemetryConfig validation ────────────────────────────────────────────
  const telemetryError = validateTelemetryConfig({ serviceName: "smoke-test" });
  if (telemetryError !== null) throw new Error("validateTelemetryConfig rejected valid config");
  checks.push("validateTelemetryConfig (valid)");

  const telemetryInvalid = validateTelemetryConfig({ serviceName: "" });
  if (telemetryInvalid === null) throw new Error("validateTelemetryConfig should reject empty serviceName");
  checks.push("validateTelemetryConfig (invalid)");

  // ── SorokitResult helpers ─────────────────────────────────────────────────
  const okResult: SorokitResult<number> = ok(42);
  if (okResult.status !== "ok") throw new Error("ok() helper broken");
  checks.push("ok() result helper");

  const errResult: SorokitResult<number> = err(SorokitErrorCode.NETWORK_ERROR, "smoke");
  if (errResult.status !== "error") throw new Error("err() helper broken");
  checks.push("err() result helper");

  return { ok: true, checks };
}
