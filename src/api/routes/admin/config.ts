/**
 * Admin tenant-config routes — route wiring only. Auth/permission checks and
 * validation live in `controllers/adminConfig.controller.ts`; persistence in
 * `services/adminConfig.service.ts`.
 */
import type { FastifyInstance } from "fastify";
import {
  getTenantConfig,
  updateTenantConfig,
} from "../../controllers/adminConfig.controller.js";

export async function adminConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/tenants/:id/config",
    {
      schema: {
        tags: ["Admin"],
        summary: "Get tenant config overrides",
        security: [{ bearerAuth: [] }],
      },
    },
    getTenantConfig,
  );

  app.put(
    "/api/admin/tenants/:id/config",
    {
      schema: {
        tags: ["Admin"],
        summary: "Update tenant config overrides",
        security: [{ bearerAuth: [] }],
      },
    },
    updateTenantConfig,
  );
}
