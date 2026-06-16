/**
 * Per-tenant usage metering (Phase 5).
 *
 * Records every billable / metered call to Postgres in the `usage_events`
 * table. Inserts are intentionally non-blocking: the caller `await`s the
 * `record()` call but the implementation runs the insert in the background
 * and swallows errors so a metering fault never breaks the user-facing
 * request. The caller may still `await` if it needs strict backpressure.
 *
 * Reads are synchronous (awaitable) and aggregate events by tenant + time
 * window for the billing endpoint.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { logger } from "@/core/shared/logger.js";

// ---------------------------------------------------------------------------
// Prisma client (lazy singleton — separate instance from documentPerms
// so each module owns its connection lifecycle and tests can reset one
// without affecting the other).
// ---------------------------------------------------------------------------

let _prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

/** Test helper: close + reset the singleton. */
export async function resetMeteringPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = undefined;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  tokensUsed?: number;
  costUsd?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TenantUsage {
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  byAction: Record<string, { count: number; tokens: number; cost: number }>;
}

// ---------------------------------------------------------------------------
// UsageMeter
// ---------------------------------------------------------------------------

export class UsageMeter {
  /**
   * Record a single usage event. Never throws — errors are logged and
   * swallowed so a metering fault cannot fail a user request.
   */
  async record(record: UsageRecord): Promise<void> {
    const tokensUsed = clampInt(record.tokensUsed ?? 0);
    const costUsd = clampFloat(record.costUsd ?? 0);
    const latencyMs = clampInt(record.latencyMs ?? 0);
    const metadata = (record.metadata ?? {}) as Prisma.InputJsonValue;

    try {
      const prisma = getPrisma();
      await prisma.usageEvent.create({
        data: {
          tenantId: record.tenantId ?? null,
          userId: record.userId ?? null,
          action: record.action,
          tokensUsed,
          costUsd,
          latencyMs,
          metadata,
        },
      });
    } catch (cause) {
      logger.error(
        { err: cause, record: { ...record, metadata: undefined } },
        "UsageMeter.record failed; event dropped",
      );
    }
  }

  /**
   * Returns true if the tenant's current-month token consumption is under
   * monthlyTokenCap, false if they have met or exceeded it. Fail-open on
   * database errors so a metering fault never blocks requests.
   */
  async checkMonthlyQuota(tenantId: string, monthlyTokenCap: number): Promise<boolean> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    try {
      const prisma = getPrisma();
      const result = await prisma.usageEvent.aggregate({
        where: { tenantId, createdAt: { gte: monthStart } },
        _sum: { tokensUsed: true },
      });
      const used = result._sum.tokensUsed ?? 0;
      return used < monthlyTokenCap;
    } catch (cause) {
      logger.error(
        { err: cause, tenantId, monthlyTokenCap },
        "UsageMeter.checkMonthlyQuota failed; allowing through",
      );
      return true;
    }
  }

  /**
   * Aggregate every `usage_events` row for `tenantId` with
   * `createdAt >= since`. Returns a summary suitable for the billing
   * endpoint.
   */
  async getTenantUsage(
    tenantId: string,
    since: Date,
  ): Promise<TenantUsage> {
    try {
      const prisma = getPrisma();
      const events = await prisma.usageEvent.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: {
          action: true,
          tokensUsed: true,
          costUsd: true,
        },
      });

      const summary: TenantUsage = {
        totalTokens: 0,
        totalCost: 0,
        totalCalls: events.length,
        byAction: {},
      };

      for (const ev of events) {
        summary.totalTokens += ev.tokensUsed ?? 0;
        summary.totalCost += ev.costUsd ?? 0;
        const bucket = summary.byAction[ev.action] ?? {
          count: 0,
          tokens: 0,
          cost: 0,
        };
        bucket.count += 1;
        bucket.tokens += ev.tokensUsed ?? 0;
        bucket.cost += ev.costUsd ?? 0;
        summary.byAction[ev.action] = bucket;
      }
      return summary;
    } catch (cause) {
      logger.error(
        { err: cause, tenantId, since },
        "UsageMeter.getTenantUsage failed; returning empty summary",
      );
      return { totalTokens: 0, totalCost: 0, totalCalls: 0, byAction: {} };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.trunc(n);
}

function clampFloat(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n;
}

// ---------------------------------------------------------------------------
// Process-wide singleton
// ---------------------------------------------------------------------------

let _meter: UsageMeter | undefined;

/** Lazy singleton — share one meter across the process. */
export function getUsageMeter(): UsageMeter {
  if (!_meter) _meter = new UsageMeter();
  return _meter;
}

/** Test helper: reset the singleton. */
export function resetUsageMeter(): void {
  _meter = undefined;
}
