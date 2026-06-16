/**
 * OpenTelemetry hooks.
 *
 * Phase 1: stub. `setupOtel()` just logs a notice and returns. The real
 * exporter (OTLP gRPC/HTTP, prom-theus, etc.) and span/metric instrumentation
 * land in Phase 3.
 *
 * Keeping the surface stable now means the boot sequence can wire it up
 * without future churn.
 */
import { logger } from "../shared/logger.js";

let _initialized = false;

/**
 * Set up OpenTelemetry exporters / instrumentations.
 *
 * Idempotent: subsequent calls are no-ops. Safe to call from the app's
 * bootstrap code.
 */
export function setupOtel(): void {
  if (_initialized) return;
  _initialized = true;
  // TODO(phase-3): wire up @opentelemetry/sdk-node, register instrumentations
  // (http, fastify, langchain, pg, ioredis), and start an OTLP exporter to the
  // configured collector endpoint.
  logger.info("OpenTelemetry: Phase 1 stub — no exporter configured yet");
}

/**
 * Has `setupOtel()` already been called?
 */
export function isOtelInitialized(): boolean {
  return _initialized;
}
