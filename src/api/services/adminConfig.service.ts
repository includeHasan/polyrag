/**
 * Admin config service — HTTP-agnostic read/write of per-tenant config
 * overrides. Reads go straight to the `TenantConfig` model; writes are routed
 * through `tenantConfigService` so cache invalidation / validation stays
 * centralised.
 */
import { PrismaClient } from "@prisma/client";
import { logger } from "@/core/shared/logger.js";
import { tenantConfigService } from "@/platform/tenancy/configService.js";
import type { TenantConfigOverrides } from "@/platform/tenancy/resolve.js";

let _prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

export async function getConfig(id: string): Promise<TenantConfigOverrides> {
  const prisma = getPrisma();
  const tenantConfig = await prisma.tenantConfig.findUnique({
    where: { tenantId: id },
    select: { config: true },
  });

  return (tenantConfig?.config ?? {}) as TenantConfigOverrides;
}

export async function updateConfig(
  id: string,
  overrides: TenantConfigOverrides,
): Promise<void> {
  await tenantConfigService.updateConfig(id, overrides);
  logger.info({ tenantId: id }, "admin: tenant config updated");
}
