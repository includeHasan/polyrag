/**
 * Admin tenants controller — enforces the `manage_tenants` permission, validates
 * the request, and delegates persistence to `services/adminTenants.service.ts`.
 */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePermission } from "@/platform/security/rbac.js";
import type { UserPayload } from "@/platform/security/auth.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import * as tenantsService from "../services/adminTenants.service.js";

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

export async function createTenant(request: FastifyRequest) {
  if (!request.user) throw new AuthorizationError("Authentication required");
  requirePermission(request.user as unknown as UserPayload, "manage_tenants");

  const parsed = CreateTenantSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;

  return tenantsService.createTenant(parsed.data);
}

export async function listTenants(request: FastifyRequest) {
  if (!request.user) throw new AuthorizationError("Authentication required");
  requirePermission(request.user as unknown as UserPayload, "manage_tenants");

  return tenantsService.listTenants();
}

export async function getTenant(request: FastifyRequest) {
  if (!request.user) throw new AuthorizationError("Authentication required");
  requirePermission(request.user as unknown as UserPayload, "manage_tenants");

  const { id } = request.params as { id: string };
  return tenantsService.getTenant(id);
}

export async function updateTenant(request: FastifyRequest) {
  if (!request.user) throw new AuthorizationError("Authentication required");
  requirePermission(request.user as unknown as UserPayload, "manage_tenants");

  const { id } = request.params as { id: string };
  const parsed = UpdateTenantSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;

  const data: { name?: string; status?: "ACTIVE" | "SUSPENDED" } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  return tenantsService.updateTenant(id, data);
}

export async function assignAdmin(request: FastifyRequest) {
  if (!request.user) throw new AuthorizationError("Authentication required");
  requirePermission(request.user as unknown as UserPayload, "manage_tenants");

  const { id: tenantId } = request.params as { id: string };
  const parsed = AssignAdminSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;

  return tenantsService.assignTenantAdmin(tenantId, parsed.data);
}
