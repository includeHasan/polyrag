/**
 * Shared HTTP helpers for controllers.
 *
 * Controllers are the HTTP layer: they pull identity/tenant off the request,
 * validate input, call a service, and shape the response. This module holds
 * the identity-extraction logic that was previously duplicated inline in
 * every route handler.
 */
import type { FastifyRequest } from "fastify";
import type { UserPayload } from "@/platform/security/auth.js";

export interface Identity {
  /** The authenticated principal, or null when unauthenticated. */
  user: UserPayload | null;
  /** User id (`userId` claim, falling back to `sub`), or null. */
  userId: string | null;
  /** Tenant id (`tenantId`/`tenant_id` claim), or null when absent. */
  tenantId: string | null;
}

/**
 * Extract identity from a request without throwing. Controllers decide
 * whether authentication is required and what default tenant (if any) to use.
 */
export function identity(request: FastifyRequest): Identity {
  const u = request.user as Record<string, unknown> | null | undefined;
  if (!u) return { user: null, userId: null, tenantId: null };
  const userId =
    (u["userId"] as string | undefined) ?? (u["sub"] as string | undefined) ?? null;
  const tenantId =
    (u["tenantId"] as string | undefined) ??
    (u["tenant_id"] as string | undefined) ??
    null;
  return { user: u as unknown as UserPayload, userId, tenantId };
}
