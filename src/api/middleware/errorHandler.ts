/**
 * Global error handler — maps `RagError` subclasses to HTTP status codes
 * and renders a stable JSON error envelope.
 *
 * Status mapping (per the platform spec):
 *   ConfigurationError     → 500
 *   AuthError              → 401
 *   AuthorizationError     → 403
 *   IngestionError         → 422
 *   RetrievalError         → 502
 *   GenerationError        → 502
 *   anything else          → 500
 *
 * Fastify's own validation errors are re-mapped to 400 with a readable
 * field map. Zod errors thrown by route handlers (e.g. when validate is
 * bypassed) are also caught and rendered as 400.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  AuthError,
  AuthorizationError,
  ConfigurationError,
  GenerationError,
  IngestionError,
  RagError,
  RetrievalError,
} from "@/shared/errors.js";
import { getObservability } from "../deps.js";
import { logger } from "@/shared/logger.js";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function statusFor(err: Error): number {
  if (err instanceof AuthError) return 401;
  if (err instanceof AuthorizationError) return 403;
  if (err instanceof IngestionError) return 422;
  if (err instanceof RetrievalError) return 502;
  if (err instanceof GenerationError) return 502;
  if (err instanceof ConfigurationError) return 500;
  if (err instanceof RagError) return 500;
  return 500;
}

function codeFor(err: Error): string {
  if (err instanceof RagError) return err.code;
  if (err instanceof ZodError) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

export function buildErrorHandler() {
  return async function errorHandler(
    err: Error | FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const status = statusFor(err);
    const code = codeFor(err);

    const body: ErrorEnvelope = {
      error: {
        code,
        message: err.message || "Internal Server Error",
      },
    };

    if (err instanceof ZodError) {
      body.error.details = err.flatten();
    } else if ((err as FastifyError).validation) {
      body.error.details = (err as FastifyError).validation;
    } else if ((err as FastifyError).code) {
      body.error.details = { fastifyCode: (err as FastifyError).code };
    }

    // 5xx — log full stack at error; 4xx — log at warn.
    if (status >= 500) {
      logger.error({ err, requestId: request.id, path: request.url }, "Request failed");
    } else {
      request.log.warn(
        { err: { code, message: err.message }, requestId: request.id, path: request.url },
        "Request rejected",
      );
    }

    try {
      const obs = await getObservability();
      obs.incrCounter(`http.errors.${status}`);
      obs.incrCounter(`http.errors.${code.toLowerCase()}`);
    } catch {
      // Never let metrics failure mask the error response.
    }

    await reply.status(status).send(body);
  };
}
