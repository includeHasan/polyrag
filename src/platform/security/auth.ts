/**
 * JWT helpers (HS256).
 *
 * OAuth2 / OIDC flow is planned for Phase 5 — for Phase 1 we issue and
 * verify short-lived HS256 tokens with the shared `JWT_SECRET`.
 *
 * Throws `AuthError` on malformed/expired/invalid tokens.
 */
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";

import { env } from "@/core/config/env.js";
import { AuthError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Role } from "./rbac.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role names recognized by the platform. Re-exported from `rbac.ts` to keep
 *  the source of truth in one place. */
export type { Role } from "./rbac.js";

/** Standard JWT claims plus our application-specific ones. */
export interface UserPayload extends JwtPayload {
  /** Subject (user id) — mirrored from `sub` for convenience. */
  userId: string;
  /** Roles assigned to the user. Includes "super_admin" for cross-tenant platform admins. */
  roles: Role[];
  /**
   * Optional tenant identifier for multi-tenant deployments.
   * super_admin users may omit this field because they operate across all tenants.
   */
  tenantId?: string;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const ALGORITHM = "HS256" as const;

/**
 * Sign a `UserPayload` and return a compact JWT string.
 *
 * The `exp` claim is set automatically from `env.JWT_EXPIRES_IN` (e.g. "24h",
 * "7d", or a numeric seconds string).
 */
export function signToken(payload: Omit<UserPayload, "iat" | "exp">): string {
  const options: SignOptions = {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  };
  const { userId, ...rest } = payload;
  const token = jwt.sign(
    { ...rest, sub: userId, userId },
    env.JWT_SECRET,
    options,
  );
  logger.debug({ userId }, "Signed JWT");
  return token;
}

/**
 * Verify a JWT and return its decoded `UserPayload`. Throws `AuthError` on
 * any verification failure (bad signature, expired, malformed, missing
 * required claims, etc.).
 *
 * All roles including "super_admin" are accepted; the caller is responsible
 * for enforcing role-specific constraints (e.g. tenant isolation).
 */
export function verifyToken(token: string): UserPayload {
  if (!token || typeof token !== "string") {
    throw new AuthError("Empty or non-string token");
  }

  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown verification error";
    logger.debug({ msg }, "JWT verification failed");
    throw new AuthError(`Invalid token: ${msg}`, err);
  }

  if (typeof decoded === "string" || !decoded) {
    throw new AuthError("Invalid token payload");
  }

  if (!decoded.userId || typeof decoded.userId !== "string") {
    throw new AuthError("Token missing required `userId` claim");
  }
  if (!Array.isArray(decoded.roles) || decoded.roles.length === 0) {
    throw new AuthError("Token missing required `roles` claim");
  }

  return decoded as UserPayload;
}

/**
 * Decode a token WITHOUT verifying the signature. Useful for logging /
 * diagnostics only — never use the result for authorization decisions.
 */
export function decodeTokenUnsafe(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  if (typeof decoded === "string") return null;
  return decoded;
}

// Re-exports
export { AuthError };
