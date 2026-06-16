import { PrismaClient } from "@prisma/client";
import { ConfigurationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import {
  type ResolvedTenantConfig,
  type TenantConfigOverrides,
  buildGlobalDefaults,
  deepMergeTenantConfig,
} from "./resolve.js";

let _prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

const MAX_CACHE_SIZE = 1000;

interface CacheEntry {
  config: ResolvedTenantConfig;
  version: number;
}

function assertNoEmbeddingOverrides(overrides: TenantConfigOverrides): void {
  const raw = overrides as Record<string, unknown>;
  if ("embeddingModel" in raw || "embeddingDim" in raw) {
    throw new ConfigurationError(
      "Embedding model and embedding dim are pinned platform-wide and cannot be overridden per tenant",
    );
  }
  if (overrides.models) {
    const models = overrides.models as Record<string, unknown>;
    if ("embeddingModel" in models || "embeddingDim" in models) {
      throw new ConfigurationError(
        "Embedding model and embedding dim are pinned platform-wide and cannot be overridden per tenant",
      );
    }
  }
}

class TenantConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  async getEffectiveConfig(tenantId: string): Promise<ResolvedTenantConfig> {
    const cached = this.cache.get(tenantId);
    if (cached) {
      return cached.config;
    }

    const prisma = getPrisma();
    const rows = await prisma.$queryRaw<Array<{ config: string; version: number }>>`
      SELECT config, version FROM tenant_configs WHERE "tenantId" = ${tenantId} LIMIT 1
    `;

    if (rows.length === 0) {
      const defaults = buildGlobalDefaults();
      this.setCache(tenantId, { config: defaults, version: 0 });
      return defaults;
    }

    const row = rows[0];
    const overrides: TenantConfigOverrides = JSON.parse(row.config);

    assertNoEmbeddingOverrides(overrides);

    const resolved = deepMergeTenantConfig(buildGlobalDefaults(), overrides);
    this.setCache(tenantId, { config: resolved, version: row.version });
    logger.debug({ tenantId, version: row.version }, "Tenant config loaded from DB");

    return resolved;
  }

  getEffectiveConfigSync(tenantId: string, version?: number): ResolvedTenantConfig | undefined {
    const entry = this.cache.get(tenantId);
    if (!entry) return undefined;
    if (version !== undefined && entry.version !== version) return undefined;
    return entry.config;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    logger.debug({ tenantId }, "Tenant config cache invalidated");
  }

  async updateConfig(tenantId: string, overrides: TenantConfigOverrides): Promise<void> {
    assertNoEmbeddingOverrides(overrides);

    const prisma = getPrisma();

    const existing = await prisma.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM tenant_configs WHERE "tenantId" = ${tenantId} LIMIT 1
    `;

    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;
    const configJson = JSON.stringify(overrides);

    if (existing.length > 0) {
      await prisma.$executeRaw`
        UPDATE tenant_configs
        SET config = ${configJson}, version = ${nextVersion}, "updatedAt" = NOW()
        WHERE "tenantId" = ${tenantId}
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO tenant_configs ("tenantId", config, version, "createdAt", "updatedAt")
        VALUES (${tenantId}, ${configJson}, ${nextVersion}, NOW(), NOW())
      `;
    }

    this.invalidate(tenantId);
    logger.info({ tenantId, version: nextVersion }, "Tenant config updated");
  }

  private setCache(tenantId: string, entry: CacheEntry): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(tenantId, entry);
  }
}

export const tenantConfigService = new TenantConfigService();
export { TenantConfigService };
