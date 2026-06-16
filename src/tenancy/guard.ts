import { RagError } from "@/shared/errors.js"
import { getTenantContext } from "@/tenancy/context.js"

// Sentinel: pass as tenantId to explicitly opt out of the guard (super-admin cross-tenant calls)
export const SYSTEM_SCOPE = "SYSTEM"

export class TenantIsolationError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("TENANT_ISOLATION_ERROR", message, cause)
    this.name = "TenantIsolationError"
  }
}

/**
 * Assert that a tenant-scoped operation has a tenantId filter.
 * Pass SYSTEM_SCOPE as tenantId to bypass (super-admin cross-tenant).
 */
export function assertTenantFilter(tenantId: string | null | undefined): void {
  if (tenantId === SYSTEM_SCOPE) return // explicit opt-out
  const ctx = getTenantContext()
  if (!ctx) return // no ALS context = outside a request (e.g. startup, tests) — allow
  if (ctx.scope === "system") return // system scope = super-admin
  if (!tenantId) {
    throw new TenantIsolationError(
      "Tenant-scoped operation attempted without tenantId filter. " +
      "Pass SYSTEM_SCOPE to explicitly allow cross-tenant access."
    )
  }
}
