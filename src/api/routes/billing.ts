/**
 * Billing routes — route wiring only. Auth, tenant scoping, and the usage
 * aggregation live in `controllers/billing.controller.ts` and
 * `services/billing.service.ts`.
 *
 *   GET /api/billing/quota — current usage vs the monthly token cap.
 *   GET /api/billing/usage — per-action usage breakdown for the period
 *     `[start, end]` where `start` is the 1st of the current calendar month
 *     (UTC) and `end` is the 1st of the next month.
 */
import type { FastifyInstance } from "fastify";
import { billingQuota, billingUsage } from "../controllers/billing.controller.js";

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
    billingQuota,
  );

  app.get(
    "/api/billing/usage",
    {
      schema: {
        tags: ["Billing"],
        summary: "Usage breakdown for the tenant",
        security: [{ bearerAuth: [] }],
      },
    },
    billingUsage,
  );
}
