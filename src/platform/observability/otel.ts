/**
 * OpenTelemetry tracing — Phase 3 real implementation.
 *
 * Wires the OpenTelemetry Node SDK with auto-instrumentation for
 *   - HTTP (Fastify incoming + outgoing)
 *   - pg
 *   - ioredis
 *   - dns, net
 *
 * Exports traces via the OTLP HTTP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is set, otherwise falls back to a console exporter for local debugging.
 *
 * LangChain and LangGraph are NOT auto-instrumented (their span API is
 * private) — we surface spans manually via the `withSpan` helper in
 * observability/tracing.ts.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

import { env } from "@/core/config/env.js";
import { logger } from "@/core/shared/logger.js";

let sdk: NodeSDK | undefined;
let initialized = false;

/**
 * Initialise the OpenTelemetry SDK. Idempotent — calling twice is a no-op.
 *
 * Reads `OTEL_EXPORTER_OTLP_ENDPOINT` to decide:
 *   - set   → OTLP HTTP exporter
 *   - unset → console exporter (prints spans to stdout in dev)
 */
export function setupOtel(): void {
  if (initialized) return;
  initialized = true;

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const exporter: SpanExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: otlpEndpoint })
    : new ConsoleSpanExporter();

  sdk = new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs — too noisy in dev.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-ioredis": { enabled: true },
      }),
    ],
  });

  try {
    sdk.start();
    logger.info(
      {
        exporter: otlpEndpoint ? "otlp-http" : "console",
        endpoint: otlpEndpoint ?? "(stdout)",
        env: env.NODE_ENV,
      },
      "OpenTelemetry SDK started",
    );
  } catch (err) {
    logger.error({ err }, "Failed to start OpenTelemetry SDK");
  }

  // Graceful shutdown.
  const shutdown = async () => {
    try {
      await sdk?.shutdown();
      logger.info("OpenTelemetry SDK shut down");
    } catch (err) {
      logger.error({ err }, "Error shutting down OpenTelemetry");
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function isOtelInitialized(): boolean {
  return initialized;
}
