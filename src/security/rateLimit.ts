/**
 * Redis-backed token-bucket rate limiter.
 *
 * Two independent buckets are maintained for every request:
 *   - per-user  (key: `rl:u:<userId>:<action>:<window>`)
 *   - per-tenant (key: `rl:t:<tenantId>:<action>:<window>`)
 *
 * The user's effective allowance is `min(userRemaining, tenantRemaining)`.
 * When the smaller bucket is empty the request is denied. The bucket
 * windows are aligned to wall-clock minutes so a tenant's quota resets
 * predictably at the top of every minute.
 *
 * Defaults (overridable via env):
 *   - `RATE_LIMIT_PER_USER_PER_MIN`   → 60
 *   - `RATE_LIMIT_PER_TENANT_PER_MIN` → 600
 *
 * The limiter never throws on Redis errors — a transient outage is logged
 * and the request is allowed through (fail-open). All callers can
 * `consume()` only after a successful `check()`.
 */
import { getRedis } from "../database/redis.js";
import { logger } from "../shared/logger.js";

// ---------------------------------------------------------------------------
// Env / defaults
// ---------------------------------------------------------------------------

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_USER_PER_MIN = readIntEnv("RATE_LIMIT_PER_USER_PER_MIN", 60);
const DEFAULT_TENANT_PER_MIN = readIntEnv("RATE_LIMIT_PER_TENANT_PER_MIN", 600);

/** Window size in seconds (always one minute for v1). */
const WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
  /** Bucket that tripped the limit, if denied. */
  deniedBy?: "user" | "tenant";
  /** Optional `Retry-After` hint (seconds). */
  retryAfterSeconds?: number;
}

export interface RateLimitHeaders {
  "RateLimit-Limit": string;
  "RateLimit-Remaining": string;
  "RateLimit-Reset": string;
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly userPerMin: number;
  private readonly tenantPerMin: number;

  constructor(opts?: { userPerMin?: number; tenantPerMin?: number }) {
    this.userPerMin = opts?.userPerMin ?? DEFAULT_USER_PER_MIN;
    this.tenantPerMin = opts?.tenantPerMin ?? DEFAULT_TENANT_PER_MIN;
  }

  /**
   * Inspect the current state of both buckets. Does NOT increment them —
   * call `consume()` to actually debit a token.
   *
   * If Redis is unavailable the call is logged and returns
   * `{ allowed: true, ... }` (fail-open).
   */
  async check(
    tenantId: string | null | undefined,
    userId: string | null | undefined,
    action: string,
    limits?: { userPerMin?: number; tenantPerMin?: number },
  ): Promise<RateLimitDecision> {
    const effectiveUserPerMin = limits?.userPerMin ?? this.userPerMin;
    const effectiveTenantPerMin = limits?.tenantPerMin ?? this.tenantPerMin;

    const window = currentWindow();
    const resetAt = new Date((window + 1) * WINDOW_SECONDS * 1000);
    const limit = effectiveUserPerMin;
    const retryAfterSeconds = Math.max(1, resetAt.getTime() - Date.now()) / 1000;

    // Anonymous / no-id traffic: still get a tenant-bucket (or global fallback)
    // so we don't blow through the database.
    const effectiveUserId = userId ?? "anon";
    const effectiveTenantId = tenantId ?? `user:${effectiveUserId}`;

    try {
      const redis = getRedis();
      const userKey = `rl:u:${effectiveUserId}:${action}:${window}`;
      const tenantKey = `rl:t:${effectiveTenantId}:${action}:${window}`;

      const [userCount, tenantCount] = await Promise.all([
        redis.get(userKey).then((v) => (v ? Number.parseInt(v, 10) : 0)),
        redis.get(tenantKey).then((v) => (v ? Number.parseInt(v, 10) : 0)),
      ]);

      const userRemaining = Math.max(0, effectiveUserPerMin - userCount);
      const tenantRemaining = Math.max(0, effectiveTenantPerMin - tenantCount);

      if (userCount >= effectiveUserPerMin) {
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          limit: effectiveUserPerMin,
          deniedBy: "user",
          retryAfterSeconds,
        };
      }
      if (tenantCount >= effectiveTenantPerMin) {
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          limit: effectiveTenantPerMin,
          deniedBy: "tenant",
          retryAfterSeconds,
        };
      }
      return {
        allowed: true,
        remaining: Math.min(userRemaining, tenantRemaining),
        resetAt,
        limit,
      };
    } catch (cause) {
      // Fail-open: never block the request because of a rate-limiter fault.
      logger.error(
        { err: cause, tenantId, userId, action },
        "rateLimit.check failed; allowing request through",
      );
      return {
        allowed: true,
        remaining: effectiveUserPerMin,
        resetAt,
        limit: effectiveUserPerMin,
      };
    }
  }

  /**
   * Atomically increment both buckets. Should be called only after
   * `check()` returns `allowed: true`. Uses `INCR` + `EXPIRE` so the TTL
   * is set on the very first hit and never grows stale.
   */
  async consume(
    tenantId: string | null | undefined,
    userId: string | null | undefined,
    action: string,
    limits?: { userPerMin?: number; tenantPerMin?: number },
  ): Promise<void> {
    const window = currentWindow();
    const effectiveUserId = userId ?? "anon";
    const effectiveTenantId = tenantId ?? `user:${effectiveUserId}`;

    try {
      const redis = getRedis();
      const userKey = `rl:u:${effectiveUserId}:${action}:${window}`;
      const tenantKey = `rl:t:${effectiveTenantId}:${action}:${window}`;

      // Pipeline: INCR + EXPIRE for each key. ioredis `multi` gives us
      // atomicity; EXPIRE is idempotent so resetting the TTL is fine.
      await redis
        .multi()
        .incr(userKey)
        .expire(userKey, WINDOW_SECONDS + 5)
        .incr(tenantKey)
        .expire(tenantKey, WINDOW_SECONDS + 5)
        .exec();
    } catch (cause) {
      // Don't throw — failing to debit a bucket should not affect the user.
      logger.error(
        { err: cause, tenantId, userId, action },
        "rateLimit.consume failed; bucket not debited",
      );
    }
  }

  /**
   * Convenience: convert a `RateLimitDecision` to Fastify reply headers.
   */
  static headersFor(decision: RateLimitDecision): RateLimitHeaders {
    return {
      "RateLimit-Limit": String(decision.limit),
      "RateLimit-Remaining": String(Math.max(0, decision.remaining)),
      "RateLimit-Reset": String(Math.floor(decision.resetAt.getTime() / 1000)),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Floor of (now / WINDOW_SECONDS) — i.e. the current minute index. */
function currentWindow(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
}

// ---------------------------------------------------------------------------
// Process-wide singleton
// ---------------------------------------------------------------------------

let _limiter: RateLimiter | undefined;

/** Lazy singleton — share one limiter across the process. */
export function getRateLimiter(): RateLimiter {
  if (!_limiter) _limiter = new RateLimiter();
  return _limiter;
}

/** Test helper: reset the singleton so new env values are picked up. */
export function resetRateLimiter(): void {
  _limiter = undefined;
}
