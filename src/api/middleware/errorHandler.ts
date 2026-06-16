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
} from "@/core/shared/errors.js";
import { getObservability } from "../deps.js";
import { logger } from "@/core/shared/logger.js";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function isZodIssueArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "code" in (value[0] as Record<string, unknown>) &&
    "path" in (value[0] as Record<string, unknown>)
  );
}

function statusFor(err: Error | FastifyError): number {
  // 1. Raw ZodError thrown from route handlers (e.g. `throw parsed.error`).
  if (err instanceof ZodError) return 400;
  // 2. Fastify's built-in body/params/query validation errors.
  const fastifyErr = err as FastifyError;
  if (fastifyErr.validation) return 400;
  if (typeof fastifyErr.code === "string" && fastifyErr.code.startsWith("FST_ERR_VALIDATION")) {
    return 400;
  }
  // 3. RagError with the VALIDATION_ERROR code (e.g. when a route wraps a Zod
  //    error in a RagError to keep the response shape consistent).
  if (err instanceof RagError && err.code === "VALIDATION_ERROR") return 400;
  // 4. Defensive: errors that have a ZodError `name` (e.g. when imported from
  //    a different bundle of zod and `instanceof` returns false).
  if (err.name === "ZodError") return 400;
  // 5. Errors that wrap a Zod error in an `issues` property (raw `SafeParseReturnType.error`-shaped).
  if (
    typeof (err as Error & { issues?: unknown }).issues !== "undefined" &&
    isZodIssueArray((err as Error & { issues?: unknown }).issues)
  ) {
    return 400;
  }
  // 6. RagError taxonomy mapping (unchanged).
  if (err instanceof AuthError) return 401;
  if (err instanceof AuthorizationError) return 403;
  if (err instanceof IngestionError) return 422;
  if (err instanceof RetrievalError) return 502;
  if (err instanceof GenerationError) return 502;
  if (err instanceof ConfigurationError) return 500;
  if (err instanceof RagError) return 500;
  return 500;
}

function codeFor(err: Error | FastifyError): string {
  if (err instanceof ZodError) return "VALIDATION_ERROR";
  const fastifyErr = err as FastifyError;
  if (fastifyErr.validation) return "VALIDATION_ERROR";
  if (typeof fastifyErr.code === "string" && fastifyErr.code.startsWith("FST_ERR_VALIDATION")) {
    return "VALIDATION_ERROR";
  }
  if (err instanceof RagError) return err.code;
  if (err.name === "ZodError") return "VALIDATION_ERROR";
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
    } else if (
      err.name === "ZodError" &&
      Array.isArray((err as Error & { issues?: unknown }).issues)
    ) {
      // Wrapped Zod error (e.g. re-thrown from another module where the
      // `instanceof ZodError` check fails but the shape is identical).
      body.error.details = { issues: (err as Error & { issues?: unknown }).issues };
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
