/**
 * GET /api/billing/usage — current-month usage for the caller's tenant.
 *
 * Requires an authenticated user (`request.user`). Returns aggregated
 * token + cost + per-action breakdown for the period `[start, end]`
 * where `start` is the 1st of the current calendar month (UTC) and
 * `end` is the 1st of the next month.
 */
import type { FastifyInstance } from "fastify";
import { getUsageMeter } from "@/platform/observability/metering.js";
import { requireUser } from "../middleware/auth.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import { getTenantContext } from "@/platform/tenancy/context.js";

export interface BillingQuotaResponse {
  used: number;
  cap: number | null;
  remaining: number | null;
}

export interface BillingUsageResponse {
  tenantId: string | null;
  totalTokens: number;
  totalCostUsd: number;
  totalCalls: number;
  byAction: Record<string, { count: number; tokens: number; costUsd: number }>;
  period: { start: string; end: string };
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/billing/quota",
    {
      schema: {
        tags: ["Billing"],
        summary: "Current usage vs monthly quota",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<BillingQuotaResponse> => {
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

    const ctx = getTenantContext();
    const monthlyTokenCap = ctx?.config.quotas.monthlyTokenCap ?? null;

    const { start } = currentMonthRangeUtc();
    const meter = getUsageMeter();
    const summary = await meter.getTenantUsage(tenantId, start);
    const used = summary.totalTokens;
    const remaining = monthlyTokenCap !== null ? Math.max(0, monthlyTokenCap - used) : null;

    return { used, cap: monthlyTokenCap, remaining };
  });

  app.get(
    "/api/billing/usage",
    {
      schema: {
        tags: ["Billing"],
        summary: "Usage breakdown for the tenant",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<BillingUsageResponse> => {
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

    const { start, end } = currentMonthRangeUtc();

    const meter = getUsageMeter();
    const summary = await meter.getTenantUsage(tenantId, start);

    logger.info(
      { tenantId, totalCalls: summary.totalCalls, period: { start, end } },
      "billing/usage fetched",
    );

    return {
      tenantId,
      totalTokens: summary.totalTokens,
      totalCostUsd: round2(summary.totalCost),
      totalCalls: summary.totalCalls,
      byAction: Object.fromEntries(
        Object.entries(summary.byAction).map(([k, v]) => [
          k,
          {
            count: v.count,
            tokens: v.tokens,
            costUsd: round2(v.cost),
          },
        ]),
      ),
      period: { start: start.toISOString(), end: end.toISOString() },
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MonthRange {
  start: Date;
  end: Date;
}

function currentMonthRangeUtc(): MonthRange {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
