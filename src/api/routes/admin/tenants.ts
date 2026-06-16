/**
 * Admin tenant routes — route wiring only. Auth/permission checks and
 * validation live in `controllers/adminTenants.controller.ts`; persistence in
 * `services/adminTenants.service.ts`.
 */
import type { FastifyInstance } from "fastify";
import {
  createTenant,
  listTenants,
  getTenant,
  updateTenant,
  assignAdmin,
} from "../../controllers/adminTenants.controller.js";

export async function adminTenantRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/admin/tenants",
    {
      schema: {
        tags: ["Admin"],
        summary: "Create a tenant",
        description: "Platform-admin only (super_admin).",
        security: [{ bearerAuth: [] }],
      },
    },
    createTenant,
  );

  app.get(
    "/api/admin/tenants",
    {
      schema: {
        tags: ["Admin"],
        summary: "List tenants",
        security: [{ bearerAuth: [] }],
      },
    },
    listTenants,
  );

  app.get(
    "/api/admin/tenants/:id",
    {
      schema: {
        tags: ["Admin"],
        summary: "Get a tenant + its config",
        security: [{ bearerAuth: [] }],
      },
    },
    getTenant,
  );

  app.patch(
    "/api/admin/tenants/:id",
    {
      schema: {
        tags: ["Admin"],
        summary: "Update tenant name/status",
        security: [{ bearerAuth: [] }],
      },
    },
    updateTenant,
  );

  app.post(
    "/api/admin/tenants/:id/admins",
    {
      schema: {
        tags: ["Admin"],
        summary: "Assign a user to a tenant",
        security: [{ bearerAuth: [] }],
      },
    },
    assignAdmin,
  );
}
