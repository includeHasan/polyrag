/**
 * Metrics endpoint — route wiring only. The snapshot access lives in
 * `controllers/metrics.controller.ts` and `services/metrics.service.ts`.
 * No auth, intended to be scraped by Prometheus / pulled by ops dashboards.
 */
import type { FastifyInstance } from "fastify";
import { metrics } from "../controllers/metrics.controller.js";

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/metrics",
    {
      schema: {
        tags: ["Health"],
        summary: "Metrics snapshot",
        description:
          "Public in-process metrics snapshot, intended to be scraped by Prometheus or pulled by ops dashboards. No authentication required.",
      },
    },
    metrics,
  );
}
