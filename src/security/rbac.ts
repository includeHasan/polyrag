/**
 * Role-based access control.
 *
 * Roles form a strict hierarchy: `super_admin > admin > editor > viewer`.
 * `hasRole(user, "viewer")` is true for any user with at least a viewer
 * role; `hasRole(user, "admin")` is true only for admins and super_admins.
 *
 * Phase 5 adds:
 *   - `enforceRole`     — throws on insufficient role.
 *   - `requirePermission` — checks a fine-grained action against the
 *      role-permission matrix (super_admin: all + tenant ops; admin: all;
 *      editor: ingest, query, reindex, search, view; viewer: query, search, view).
 *   - `requireSameTenant` — enforces tenant isolation (bypassed for super_admin).
 */
import type { UserPayload } from "./auth.js";
import { AuthorizationError } from "../shared/errors.js";

export type Role = "super_admin" | "admin" | "editor" | "viewer";

/** Numeric rank for hierarchical comparisons. Higher = more privileged. */
const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  super_admin: 4,
};

/** All known roles in ascending order of privilege. */
export const ROLES: readonly Role[] = ["viewer", "editor", "admin", "super_admin"] as const;

/** Action names recognised by `requirePermission`. */
export type PermissionAction =
  | "ingest"
  | "query"
  | "reindex"
  | "search"
  | "view"
  | "delete"
  | "manage_users"
  | "manage_billing"
  | "manage_tenants"
  | "manage_tenant_config"
  | string;

/**
 * Role → set of permitted actions. The wildcard `"*"` represents
 * unrestricted access (admin and above).
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<string>> = {
  super_admin: new Set<string>(["*", "manage_tenants", "manage_tenant_config", "manage_users", "manage_billing"]),
  admin: new Set<string>(["*"]),
  editor: new Set<string>(["ingest", "query", "reindex", "search", "view"]),
  viewer: new Set<string>(["query", "search", "view"]),
};

/**
 * Return `true` iff the user has *at least* the privilege of `requiredRole`.
 *
 * Accepts a `UserPayload` (from a verified JWT) or a plain `roles: string[]`
 * for places where the full payload is unavailable. Unknown roles in the
 * user's role list are ignored (treated as no privilege).
 */
export function hasRole(
  user: UserPayload | { roles: readonly string[] } | null | undefined,
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
  user: UserPayload | { roles: readonly string[] } | null | undefined,
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
  user: UserPayload | { roles: readonly string[] } | null | undefined,
  requiredRole: Role,
): void {
  if (!hasRole(user, requiredRole)) {
    throw new AuthorizationError(
      `Requires role '${requiredRole}' (user has: [${user?.roles?.join(", ") ?? ""}])`,
    );
  }
}

/**
 * Throwing variant of `hasRole` — identical to `requireRole` but with a
 * name that reads better in calling code (e.g. `enforceRole(user, "admin")`).
 */
export function enforceRole(
  user: UserPayload | { roles: readonly string[] } | null | undefined,
  requiredRole: Role,
): void {
  if (!user) {
    throw new AuthorizationError(`Requires role '${requiredRole}' (no authenticated user)`);
  }
  requireRole(user, requiredRole);
}

/**
 * Check that the user's highest role permits the given action. Throws
 * `AuthorizationError` if not. Admins are permitted everything (their
 * permission set is the wildcard `*`).
 */
export function requirePermission(
  user: UserPayload | { roles: readonly string[] } | null | undefined,
  action: PermissionAction,
): void {
  if (!user) {
    throw new AuthorizationError(`Requires permission '${action}' (no authenticated user)`);
  }
  const role = highestRole(user);
  if (!role) {
    throw new AuthorizationError(
      `Requires permission '${action}' (user has no recognised role)`,
    );
  }
  const perms = ROLE_PERMISSIONS[role];
  if (perms.has("*") || perms.has(action)) return;
  throw new AuthorizationError(
    `Requires permission '${action}' (role '${role}' does not permit it)`,
  );
}

/** Pure (non-throwing) variant of `requirePermission` for use in pipelines. */
export function hasPermission(
  user: UserPayload | { roles: readonly string[] } | null | undefined,
  action: PermissionAction,
): boolean {
  if (!user) return false;
  const role = highestRole(user);
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  return perms.has("*") || perms.has(action);
}

/**
 * Enforce tenant isolation for the given target tenant. Super_admin users
 * may access any tenant; all other users must belong to the same tenant.
 */
export function requireSameTenant(user: UserPayload, targetTenantId: string): void {
  if (hasRole(user, "super_admin")) return;
  if (user.tenantId !== targetTenantId) {
    throw new AuthorizationError("Cannot access resources of another tenant");
  }
}
