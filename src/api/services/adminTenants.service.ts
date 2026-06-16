/**
 * Admin tenants service — HTTP-agnostic CRUD over the `Tenant` model and
 * tenant/user role assignments. All Prisma access for the admin tenant routes
 * lives here behind a lazy client singleton.
 */
import { PrismaClient } from "@prisma/client";
import { AuthorizationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";

let _prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

export async function createTenant(input: { slug: string; name: string }) {
  const { slug, name } = input;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.create({
    data: { slug, name },
    select: { id: true, slug: true, name: true, status: true, createdAt: true },
  });

  logger.info({ tenantId: tenant.id, slug }, "admin: tenant created");
  return tenant;
}

export async function listTenants() {
  const prisma = getPrisma();
  return prisma.tenant.findMany({
    select: { id: true, slug: true, name: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getTenant(id: string) {
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
}

export async function updateTenant(
  id: string,
  data: { name?: string; status?: "ACTIVE" | "SUSPENDED" },
) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.update({
    where: { id },
    data,
    select: { id: true, slug: true, name: true, status: true, createdAt: true },
  });

  logger.info({ tenantId: id }, "admin: tenant updated");
  return tenant;
}

export async function assignTenantAdmin(
  tenantId: string,
  input: { userId: string; role: "ADMIN" | "EDITOR" | "VIEWER" },
) {
  const { userId, role } = input;
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
}
