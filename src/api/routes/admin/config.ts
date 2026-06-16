import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { requirePermission, requireSameTenant } from "@/platform/security/rbac.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import { tenantConfigService } from "@/platform/tenancy/configService.js";
import type { TenantConfigOverrides } from "@/platform/tenancy/resolve.js";
import type { UserPayload } from "@/platform/security/auth.js";

let _prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

const TenantConfigOverridesSchema = z.object({
  persona: z.object({ domain: z.string() }).partial().optional(),
  prompts: z.record(z.string(), z.string()).optional(),
  models: z
    .object({
      generationModel: z.string(),
      evaluationModel: z.string(),
      rerankModel: z.string(),
    })
    .partial()
    .optional(),
  chunking: z
    .object({
      strategy: z.enum(["fixed", "recursive", "semantic", "agentic"]),
      chunkSize: z.number().int().positive(),
      chunkOverlap: z.number().int().nonnegative(),
    })
    .partial()
    .optional(),
  retrieval: z
    .object({
      topK: z.number().int().positive(),
      rerankTopK: z.number().int().positive(),
      rerankerEnabled: z.boolean(),
      hybridSearchEnabled: z.boolean(),
      kgEnabled: z.boolean(),
    })
    .partial()
    .optional(),
  quotas: z
    .object({
      userPerMin: z.number().int().positive(),
      tenantPerMin: z.number().int().positive(),
      monthlyTokenCap: z.number().int().positive().optional(),
    })
    .partial()
    .optional(),
});

export async function adminConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/tenants/:id/config", async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    const { id } = request.params as { id: string };

    let permitted = false;
    try {
      requirePermission(request.user as unknown as UserPayload, "manage_tenant_config");
      permitted = true;
    } catch {
      // fall through to same-tenant check
    }

    if (!permitted) {
      try {
        requireSameTenant(request.user as unknown as UserPayload, id);
        permitted = true;
      } catch {
        // no access via either path
      }
    }

    if (!permitted) {
      throw new AuthorizationError(
        "Requires 'manage_tenant_config' permission or same-tenant access",
      );
    }

    const prisma = getPrisma();
    const tenantConfig = await prisma.tenantConfig.findUnique({
      where: { tenantId: id },
      select: { config: true },
    });

    return (tenantConfig?.config ?? {}) as TenantConfigOverrides;
  });

  app.put("/api/admin/tenants/:id/config", async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    requirePermission(request.user as unknown as UserPayload, "manage_tenant_config");

    const { id } = request.params as { id: string };

    const userTenantId = request.user.tenantId as string | undefined;
    if (userTenantId) {
      requireSameTenant(request.user as unknown as UserPayload, id);
    }

    const parsed = TenantConfigOverridesSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;

    await tenantConfigService.updateConfig(id, parsed.data as TenantConfigOverrides);

    logger.info({ tenantId: id }, "admin: tenant config updated");
    return { tenantId: id, updated: true };
  });
}
