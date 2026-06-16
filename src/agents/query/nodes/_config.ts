import { getTenantContext } from "@/platform/tenancy/context.js"
import { tenantConfigService } from "@/platform/tenancy/configService.js"
import { buildGlobalDefaults } from "@/platform/tenancy/resolve.js"
import type { ResolvedTenantConfig } from "@/platform/tenancy/resolve.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveNodeConfig(state: Record<string, any>): ResolvedTenantConfig {
  const tenantId: string | null = state.tenantId ?? state.user?.tenantId ?? null
  const version: number | undefined = state.tenantConfigKey ? Number(state.tenantConfigKey) : undefined

  if (tenantId) {
    const cached = tenantConfigService.getEffectiveConfigSync(tenantId, version)
    if (cached) return cached
  }

  // Try ALS context (set by tenantContext middleware for non-graph paths)
  const ctx = getTenantContext()
  if (ctx) return ctx.config

  // Fall back to global defaults
  return buildGlobalDefaults()
}
