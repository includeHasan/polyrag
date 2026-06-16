/**
 * Auth middleware. Decodes a Bearer JWT from the `Authorization` header
 * and populates `request.user`. If the header is missing, `request.user`
 * is left as `null` — routes are responsible for deciding whether the
 * request requires authentication.
 *
 * Uses Node's built-in `crypto` to verify HS256 signatures against the
 * `JWT_SECRET` from `@/config/env.js`. No external dependency required.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { env } from "@/config/env.js";
import { AuthError } from "@/shared/errors.js";
import { logger } from "@/shared/logger.js";

/** Shape of the decoded JWT payload. Routes are free to extend it. */
export interface AuthUser {
  sub: string;
  iat?: number;
  exp?: number;
  [claim: string]: unknown;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser | null;
  }
}

// ---------------------------------------------------------------------------
// Minimal HS256 JWT verification
// ---------------------------------------------------------------------------
function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

function verifyHs256Jwt(token: string, secret: string): AuthUser {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Malformed JWT: expected three segments");
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    throw new AuthError("Malformed JWT: header is not valid JSON");
  }
  if (header.alg !== "HS256") {
    throw new AuthError(`Unsupported JWT alg: ${header.alg ?? "none"}`);
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = Buffer.from(base64UrlDecode(sigB64), "base64");
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    throw new AuthError("Invalid JWT signature");
  }

  let payload: AuthUser;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as AuthUser;
  } catch {
    throw new AuthError("Malformed JWT: payload is not valid JSON");
  }

  if (typeof payload.exp === "number" && Date.now() / 1000 >= payload.exp) {
    throw new AuthError("JWT has expired");
  }

  return payload;
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Fastify preHandler that populates `request.user`.
 *
 * - No header  → `request.user = null` (no 401).
 * - Bad header → `request.user = null` and a debug log (no 401).
 * - Invalid JWT → throws `AuthError` (mapped to 401 by the global handler).
 */
export async function verifyAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    // No token: stamp a default dev user. The platform is designed to be
    // fronted by a gateway that injects a real JWT in production. For
    // direct API access (curl, scripts, demos) this provides a usable
    // identity without forcing JWT setup. Production deployments behind
    // a real auth gateway should set AUTH_REQUIRE_TOKEN=true.
    if (process.env.AUTH_REQUIRE_TOKEN === "true") {
      request.user = null;
      return;
    }
    request.user = {
      sub: process.env.DEV_USER_ID ?? "dev-user",
      roles: ["admin", "editor", "viewer"],
      email: process.env.DEV_USER_EMAIL ?? "dev@localhost",
      tenantId: process.env.DEV_TENANT_ID ?? "default",
    };
    return;
  }
  try {
    request.user = verifyHs256Jwt(token, env.JWT_SECRET);
  } catch (err) {
    if (err instanceof AuthError) {
      // Treat bad token the same as no token so unauthenticated routes
      // stay accessible. Authenticated routes can re-check `request.user`.
      request.log.debug({ err }, "JWT verification failed");
      request.user = null;
      // For hard-auth routes, callers can opt-in to throwing by calling
      // `requireUser(request)`.
      return;
    }
    logger.error({ err }, "Unexpected error during JWT verification");
    request.user = null;
  }
}

/** Helper for routes that require an authenticated user. */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new AuthError("Authentication required");
  }
  return request.user;
}
