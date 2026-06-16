import type { FastifyRequest, FastifyReply } from "fastify";
import { setTenantContext } from "@/platform/tenancy/context.js";
import { tenantConfigService } from "@/platform/tenancy/configService.js";
import { logger } from "@/core/shared/logger.js";

export async function tenantContextMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    return;
  }

  const user = request.user as Record<string, unknown>;

  const tenantId =
    (user["tenantId"] as string | undefined) ??
    (user["tenant_id"] as string | undefined) ??
    "default";

  const userId =
    (user["userId"] as string | undefined) ??
    (user["sub"] as string | undefined) ??
    null;

  const roles = (user["roles"] as string[] | undefined) ?? [];

  const config = await tenantConfigService.getEffectiveConfig(tenantId);

  setTenantContext({ tenantId, userId, roles, config, scope: "tenant" });

  logger.debug({ tenantId, userId }, "tenant context established");
}
