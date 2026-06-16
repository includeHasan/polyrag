/**
 * Role-based access control.
 *
 * Roles form a strict hierarchy: `admin > editor > viewer`.
 * `hasRole(user, "viewer")` is true for any user with at least a viewer
 * role; `hasRole(user, "admin")` is true only for admins.
 */
import type { UserPayload } from "./auth.js";

export type Role = "admin" | "editor" | "viewer";

/** Numeric rank for hierarchical comparisons. Higher = more privileged. */
const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

/** All known roles in ascending order of privilege. */
export const ROLES: readonly Role[] = ["viewer", "editor", "admin"] as const;

/**
 * Return `true` iff the user has *at least* the privilege of `requiredRole`.
 *
 * Accepts a `UserPayload` (from a verified JWT) or a plain `roles: string[]`
 * for places where the full payload is unavailable. Unknown roles in the
 * user's role list are ignored (treated as no privilege).
 */
export function hasRole(
  user: UserPayload | { roles: readonly string[] },
  requiredRole: Role,
): boolean {
  if (!user || !Array.isArray(user.roles)) return false;
  const required = ROLE_RANK[requiredRole];
  let best = 0;
  for (const r of user.roles) {
    if (r in ROLE_RANK) {
      const rank = ROLE_RANK[r as Role];
      if (rank > best) best = rank;
    }
  }
  return best >= required;
}

/**
 * Return the highest-privilege role the user holds, or `null` if none of the
 * user's roles are recognised.
 */
export function highestRole(
  user: UserPayload | { roles: readonly string[] },
): Role | null {
  if (!user || !Array.isArray(user.roles)) return null;
  let best: Role | null = null;
  let bestRank = 0;
  for (const r of user.roles) {
    if (r in ROLE_RANK) {
      const rank = ROLE_RANK[r as Role];
      if (rank > bestRank) {
        bestRank = rank;
        best = r as Role;
      }
    }
  }
  return best;
}

/**
 * Throw `AuthorizationError` if the user doesn't satisfy `requiredRole`.
 * Convenience wrapper for route handlers.
 */
export function requireRole(
  user: UserPayload | { roles: readonly string[] },
  requiredRole: Role,
): void {
  if (!hasRole(user, requiredRole)) {
    // Local import to avoid a circular dep with `auth.ts`.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AuthorizationError } = require("../shared/errors.js") as typeof import("../shared/errors.js");
    throw new AuthorizationError(
      `Requires role '${requiredRole}' (user has: [${user?.roles?.join(", ") ?? ""}])`,
    );
  }
}
