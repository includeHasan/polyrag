/**
 * Billing controller — enforces an authenticated, tenant-scoped caller and
 * delegates the aggregation to `services/billing.service.ts`.
 */
import type { FastifyRequest } from "fastify";
import { requireUser } from "../middleware/auth.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import {
  getBillingQuota,
  getBillingUsage,
  type BillingQuotaResponse,
  type BillingUsageResponse,
} from "../services/billing.service.js";

export async function billingQuota(
  request: FastifyRequest,
): Promise<BillingQuotaResponse> {
  const user = requireUser(request);
  const tenantId =
    (user.tenantId as string | undefined) ??
    (user.tenant_id as string | undefined) ??
    null;

  if (!tenantId) {
    throw new AuthorizationError(
      "Billing quota requires a tenant-scoped user (missing tenantId claim)",
    );
  }

  return getBillingQuota(tenantId);
}

export async function billingUsage(
  request: FastifyRequest,
): Promise<BillingUsageResponse> {
  const user = requireUser(request);
  const tenantId =
    (user.tenantId as string | undefined) ??
    (user.tenant_id as string | undefined) ??
    null;

  if (!tenantId) {
    // Multi-tenant usage requires a tenant scope. Without one we'd be
    // double-counting users across all their tenants.
    throw new AuthorizationError(
      "Billing usage requires a tenant-scoped user (missing tenantId claim)",
    );
  }

  return getBillingUsage(tenantId);
}
