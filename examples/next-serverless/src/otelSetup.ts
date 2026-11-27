/**
 * OpenTelemetry exporter setup for the next-serverless example (#155).
 *
 * Wire this once at server startup — in `_app.tsx` on the server side, in a
 * custom `server.js`, or at the top of your Lambda handler before the first
 * request is processed.
 *
 * In a real app, replace the relative paths below with the published package:
 *   import { initTelemetry, createOtelApiExporter } from "sorokit-core";
 */

import {
  initTelemetry,
  createOtelApiExporter,
  createOtelApiExporterFromProviders,
} from "../../../src/performance/telemetry";

// ── Option A: rely on a globally-registered @opentelemetry/api ───────────────
//
// The most common setup: your server already initialises the OTel SDK (e.g.
// @opentelemetry/sdk-node) which registers a global TracerProvider and
// MeterProvider. `createOtelApiExporter` picks them up automatically.
//
// Prerequisites:
//   npm install @opentelemetry/api @opentelemetry/sdk-node
//
// At process start (before any routes run):
//   import "@opentelemetry/sdk-node"; // registers global providers
//
// Then call this once:
export async function setupTelemetryFromGlobalProviders(): Promise<void> {
  // Build the exporter from whatever global OTel providers are registered.
  const exporterResult = await createOtelApiExporter({
    serviceName: "next-serverless-example",
  });

  if (exporterResult.status === "error") {
    // @opentelemetry/api is not installed or no provider is registered.
    // Telemetry is simply skipped — the SDK works without it.
    console.warn("[sorokit] OTel exporter unavailable:", exporterResult.error.message);
    return;
  }

  // Initialise the SDK's telemetry pipeline with the exporter.
  const initResult = initTelemetry({
    enabled: true,
    serviceName: "next-serverless-example",
    customExporter: exporterResult.data,
  });

  if (initResult.status === "error") {
    console.warn("[sorokit] Telemetry init failed:", initResult.error.message);
  }
}

// ── Option B: supply your own Tracer and Meter instances ─────────────────────
//
// Use this when you hold explicit provider references instead of relying on the
// global registration — for example in a monorepo where multiple services share
// one process.
//
// import { trace, metrics } from "@opentelemetry/api";
//
// const tracer = trace.getTracer("next-serverless-example", "1.0.0");
// const meter  = metrics.getMeter("next-serverless-example", "1.0.0");
//
// const exporter = createOtelApiExporterFromProviders(tracer, meter, {
//   serviceName: "next-serverless-example",
// });
//
// initTelemetry({
//   enabled: true,
//   serviceName: "next-serverless-example",
//   customExporter: exporter,
// });

// Re-export helpers so the rest of the example can import them from one place.
export { createOtelApiExporterFromProviders };
