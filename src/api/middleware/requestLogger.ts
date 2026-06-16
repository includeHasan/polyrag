/**
 * Request-scoped logger wiring. Fastify already ships with a pino child
 * logger attached to every request (`request.log`). This module adds
 * - a per-request id header passthrough
 * - onResponse latency logging
 * - a per-request timing start timestamp
 *
 * The onRequest hook adds `request.startTime` so handlers can compute
 * their own latency metrics without needing a separate library.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    startTime: number;
  }
}

export function registerRequestLogger(app: FastifyInstance): void {
  // Honour an inbound request id, otherwise mint one.
  app.addHook("onRequest", (request: FastifyRequest, _reply: FastifyReply, done) => {
    const inbound =
      (request.headers["x-request-id"] as string | undefined) ??
      (request.headers["x-correlation-id"] as string | undefined);
    request.id = inbound || request.id || randomUUID();
    request.startTime = Date.now();
    done();
  });

  // Per-response log line with latency.
  app.addHook("onResponse", (request, reply, done) => {
    const ms = Date.now() - (request.startTime ?? Date.now());
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        durationMs: ms,
      },
      "request completed",
    );
    done();
  });
}
