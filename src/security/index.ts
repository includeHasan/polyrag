/**
 * Security layer — public surface.
 *
 *  - `auth`           — JWT signing / verification (HS256).
 *  - `rbac`           — role hierarchy + `hasRole` / `requireRole`.
 *  - `documentPerms`  — per-chunk tenant/ACL filtering (Phase 5 placeholder).
 */
export * from "./auth.js";
export * from "./rbac.js";
export * from "./documentPerms.js";
