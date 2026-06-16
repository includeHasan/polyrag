/**
 * Rate-limit preHandler for Fastify.
 *
 * Looks up the active `RateLimiter` (process singleton), calls `check()`
 * against the request's tenant + user + action, and either:
 *   - 429s with `RateLimit-*` + `Retry-After` headers, or
 *   - sets `RateLimit-*` headers on the eventual response and continues.
 *
 * The actual `consume()` call is performed by the route after a successful
 * invocation — this middleware only gates admission and stamps headers.
 *
 * Soft-fail: a rate-limiter fault is logged and the request is allowed
 * through (matches the `RateLimiter.check()` fail-open contract).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { getRateLimiter, RateLimiter, type RateLimitDecision } from "@/security/rateLimit.js";
import { logger } from "@/shared/logger.js";
import { getTenantContext } from "@/tenancy/context.js";

export interface RateLimitPreHandlerOptions {
  /** Logical action name, e.g. "query", "ingest". Defaults to the URL path. */
  action?: string | ((request: FastifyRequest) => string);
  /** Override the default rate limiter (mostly for tests). */
  limiter?: RateLimiter;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Result of the most recent rate-limit check, if one ran. */
    rateLimit?: RateLimitDecision;
  }
}

/**
 * Build a Fastify preHandler that performs a rate-limit check.
 *
 * Usage:
 *   app.post("/api/query", {
 *     preHandler: rateLimitPreHandler({ action: "query" }),
 *   }, async (request, reply) => { ... });
 */
export function rateLimitPreHandler(opts: RateLimitPreHandlerOptions = {}) {
  const limiter = opts.limiter ?? getRateLimiter();

  return async function preHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const action =
      typeof opts.action === "function"
        ? opts.action(request)
        : opts.action ?? request.url;

    const user = request.user;
    const userId = (user?.sub as string | undefined) ?? null;
    const tenantId =
      (user?.tenantId as string | undefined) ??
      (user?.tenant_id as string | undefined) ??
      null;

    const ctx = getTenantContext();
    const limits = ctx
      ? { userPerMin: ctx.config.quotas.userPerMin, tenantPerMin: ctx.config.quotas.tenantPerMin }
      : undefined;

    let decision: RateLimitDecision;
    try {
      decision = await limiter.check(tenantId, userId, action, limits);
    } catch (cause) {
      // Defensive: RateLimiter.check() already fail-opens, but if a future
      // change makes it throw, we still never want a 500.
      logger.error(
        { err: cause, action, userId, tenantId },
        "rateLimitPreHandler: unexpected error; allowing request",
      );
      return;
    }

    request.rateLimit = decision;

    const headers = RateLimiter.headersFor(decision);
    for (const [k, v] of Object.entries(headers)) {
      reply.header(k, v);
    }

    if (!decision.allowed) {
      if (decision.retryAfterSeconds) {
        reply.header("Retry-After", String(Math.ceil(decision.retryAfterSeconds)));
      }
      reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded for action '${action}'${
            decision.deniedBy ? ` (denied by ${decision.deniedBy} bucket)` : ""
          }`,
        },
      });
    }
  };
}
