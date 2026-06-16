/**
 * Billing service — HTTP-agnostic usage/quota aggregation for a tenant.
 *
 * Pulls the current-month usage summary from the usage meter
 * (`@/platform/observability/metering.ts`) and the monthly token cap from
 * the ambient tenant context (`@/platform/tenancy/context.ts`).
 */
import { getUsageMeter } from "@/platform/observability/metering.js";
import { getTenantContext } from "@/platform/tenancy/context.js";
import { logger } from "@/core/shared/logger.js";

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

/** Current usage vs the tenant's monthly token cap. */
export async function getBillingQuota(tenantId: string): Promise<BillingQuotaResponse> {
  const ctx = getTenantContext();
  const monthlyTokenCap = ctx?.config.quotas.monthlyTokenCap ?? null;

  const { start } = currentMonthRangeUtc();
  const meter = getUsageMeter();
  const summary = await meter.getTenantUsage(tenantId, start);
  const used = summary.totalTokens;
  const remaining = monthlyTokenCap !== null ? Math.max(0, monthlyTokenCap - used) : null;

  return { used, cap: monthlyTokenCap, remaining };
}

/** Per-action usage breakdown for the tenant's current calendar month. */
export async function getBillingUsage(tenantId: string): Promise<BillingUsageResponse> {
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
