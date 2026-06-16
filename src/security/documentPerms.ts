/**
 * Per-document / per-chunk permission filtering.
 *
 * Phase 1: pass-through — no filtering is performed.
 * Phase 5: will apply tenant + ACL filtering based on:
 *   - chunk.metadata.tenantId
 *   - chunk.metadata.ownerId
 *   - chunk.metadata.visibility
 *   - chunk.metadata.allowedRoles
 *   - user.tenantId / user.roles
 *
 * The function signature is fixed so call sites don't have to change in
 * Phase 5 — only the implementation body will.
 */
import type { Chunk } from "../shared/types.js";
import type { UserPayload } from "./auth.js";

/**
 * Filter a list of chunks down to those the user is permitted to see.
 *
 * @param user   the authenticated user (may be `null` for anonymous flows)
 * @param chunks the candidate chunks (e.g. from a retriever)
 * @returns      the subset the user is allowed to consume
 */
export function filterChunksForUser(
  user: UserPayload | null,
  chunks: Chunk[],
): Chunk[] {
  // Phase 1: no filtering. Return as-is.
  // TODO(phase-5): implement tenant + ACL filtering.
  //
  // Sketch:
  //   for each chunk:
  //     if chunk.metadata.tenantId && chunk.metadata.tenantId !== user?.tenantId
  //       → drop
  //     if chunk.metadata.ownerId && chunk.metadata.ownerId !== user?.userId
  //       → drop unless user is admin
  //     if chunk.metadata.visibility === "private" && owner mismatch → drop
  //     if chunk.metadata.allowedRoles && none of user.roles satisfy → drop
  void user; // silence unused-param warning; used in Phase 5
  return chunks;
}

/**
 * Convenience: did the user (after filtering) end up with at least one chunk?
 */
export function hasVisibleChunks(
  user: UserPayload | null,
  chunks: Chunk[],
): boolean {
  return filterChunksForUser(user, chunks).length > 0;
}
