import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { requirePermission } from "@/platform/security/rbac.js";
import type { UserPayload } from "@/platform/security/auth.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";

let _prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

const CreateTenantSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(255),
});

const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

const AssignAdminSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

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
    async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    requirePermission(request.user as unknown as UserPayload, "manage_tenants");

    const parsed = CreateTenantSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    const { slug, name } = parsed.data;

    const prisma = getPrisma();
    const tenant = await prisma.tenant.create({
      data: { slug, name },
      select: { id: true, slug: true, name: true, status: true, createdAt: true },
    });

    logger.info({ tenantId: tenant.id, slug }, "admin: tenant created");
    return tenant;
  });

  app.get(
    "/api/admin/tenants",
    {
      schema: {
        tags: ["Admin"],
        summary: "List tenants",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    requirePermission(request.user as unknown as UserPayload, "manage_tenants");

    const prisma = getPrisma();
    const tenants = await prisma.tenant.findMany({
      select: { id: true, slug: true, name: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return tenants;
  });

  app.get(
    "/api/admin/tenants/:id",
    {
      schema: {
        tags: ["Admin"],
        summary: "Get a tenant + its config",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    requirePermission(request.user as unknown as UserPayload, "manage_tenants");

    const { id } = request.params as { id: string };
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        config: { select: { config: true } },
      },
    });

    if (!tenant) {
      throw new AuthorizationError(`Tenant not found: ${id}`);
    }

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      config: tenant.config?.config ?? {},
    };
  });

  app.patch(
    "/api/admin/tenants/:id",
    {
      schema: {
        tags: ["Admin"],
        summary: "Update tenant name/status",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    requirePermission(request.user as unknown as UserPayload, "manage_tenants");

    const { id } = request.params as { id: string };
    const parsed = UpdateTenantSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;

    const data: { name?: string; status?: "ACTIVE" | "SUSPENDED" } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;

    const prisma = getPrisma();
    const tenant = await prisma.tenant.update({
      where: { id },
      data,
      select: { id: true, slug: true, name: true, status: true, createdAt: true },
    });

    logger.info({ tenantId: id }, "admin: tenant updated");
    return tenant;
  });

  app.post(
    "/api/admin/tenants/:id/admins",
    {
      schema: {
        tags: ["Admin"],
        summary: "Assign a user to a tenant",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
    if (!request.user) throw new AuthorizationError("Authentication required");
    requirePermission(request.user as unknown as UserPayload, "manage_tenants");

    const { id: tenantId } = request.params as { id: string };
    const parsed = AssignAdminSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    const { userId, role } = parsed.data;

    const prisma = getPrisma();
    const [assignment] = await prisma.$transaction([
      prisma.userRoleAssignment.create({
        data: { userId, role },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { tenantId },
      }),
    ]);

    logger.info({ tenantId, userId, role }, "admin: user assigned to tenant");
    return assignment;
  });
}
