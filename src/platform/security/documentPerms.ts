/**
 * Per-document / per-chunk permission filtering.
 *
 * Phase 5: applies the platform's tenant + ACL policy:
 *   - Admins see every chunk.
 *   - Other users only see chunks whose `documentId` is in their
 *     `document_permissions` rows with `canRead = true`.
 *   - If a user has no `document_permissions` rows, they see nothing
 *     (deny by default — Phase 5 multi-tenant mode).
 *
 * The function is async because it may need to hit Postgres; we expose
 * `filterChunksForUser` (awaitable) and a synchronous fallback
 * `filterChunksForUserSync` for hot paths that already have a cached
 * allowed-ids list.
 */
import { PrismaClient } from "@prisma/client";
import type { Chunk } from "@/core/shared/types.js";
import type { UserPayload } from "./auth.js";
import { hasRole } from "./rbac.js";
import { logger } from "@/core/shared/logger.js";

// ---------------------------------------------------------------------------
// Prisma client (singleton, lazy)
// ---------------------------------------------------------------------------

let _prisma: PrismaClient | undefined;

/** Lazy singleton Prisma client used by the permission layer. */
export function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

/** Test helper: close + reset the singleton. */
export async function resetPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = undefined;
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Return the list of `documentId`s the user is allowed to read.
 * - Admins receive `null` (the sentinel meaning "no restriction").
 * - Other users receive the union of their `canRead` permission rows.
 *
 * Returns `[]` (not `null`) for non-admins who have no permission rows.
 */
export async function getAllowedDocumentIds(
  user: UserPayload | null | undefined,
): Promise<string[] | null> {
  if (!user) return [];
  if (hasRole(user, "admin")) return null;

  const userId = user.userId ?? user.sub;
  if (!userId) return [];

  try {
    const prisma = getPrisma();
    const rows = await prisma.documentPermission.findMany({
      where: { userId, canRead: true, ...(user.tenantId ? { tenantId: user.tenantId } : {}) },
      select: { documentId: true },
    });
    return rows.map((r) => r.documentId);
  } catch (cause) {
    // Soft-fail: log and return an empty set. A misconfigured DB must not
    // silently elevate privileges — least-privilege default is "deny".
    logger.error(
      { err: cause, userId },
      "documentPerms: getAllowedDocumentIds failed; denying all",
    );
    return [];
  }
}

/**
 * Filter a list of chunks down to those the user is permitted to see.
 *
 * - Admin → returns the input unchanged.
 * - Non-admin with no `documentId` rows in `document_permissions` → returns `[]`.
 * - Non-admin otherwise → returns the subset whose `documentId` is in
 *   `getAllowedDocumentIds(user)`.
 */
export async function filterChunksForUser(
  user: UserPayload | null | undefined,
  chunks: Chunk[],
): Promise<Chunk[]> {
  if (!user) return [];
  if (hasRole(user, "admin")) return chunks;

  const allowed = await getAllowedDocumentIds(user);
  if (!allowed || allowed.length === 0) return [];

  const allowedSet = new Set(allowed);
  let filtered = chunks.filter((c) => allowedSet.has(c.documentId));
  if (user.tenantId) {
    filtered = filtered.filter(
      (c) => !c.metadata?.tenantId || c.metadata.tenantId === user.tenantId,
    );
  }
  return filtered;
}

/**
 * Synchronous variant for callers that have already resolved the allowed
 * document-id list. Behaviour mirrors `filterChunksForUser` exactly.
 */
export function filterChunksForUserSync(
  user: UserPayload | null | undefined,
  chunks: Chunk[],
  allowedDocumentIds: string[] | null,
): Chunk[] {
  if (!user) return [];
  if (hasRole(user, "admin")) return chunks;
  if (!allowedDocumentIds || allowedDocumentIds.length === 0) return [];
  const allowedSet = new Set(allowedDocumentIds);
  let filtered = chunks.filter((c) => allowedSet.has(c.documentId));
  if (user.tenantId) {
    filtered = filtered.filter(
      (c) => !c.metadata?.tenantId || c.metadata.tenantId === user.tenantId,
    );
  }
  return filtered;
}

/**
 * Convenience: did the user (after filtering) end up with at least one chunk?
 */
export async function hasVisibleChunks(
  user: UserPayload | null,
  chunks: Chunk[],
): Promise<boolean> {
  return (await filterChunksForUser(user, chunks)).length > 0;
}
