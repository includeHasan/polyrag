/**
 * Metrics endpoint — exposes the platform's in-process metrics snapshot.
 * No auth, intended to be scraped by Prometheus / pulled by ops dashboards.
 */
import type { FastifyInstance } from "fastify";
import { getObservability } from "../deps.js";

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
    async (_request, reply) => {
    const obs = await getObservability();
    const snapshot = obs.getMetrics();
    // Plain JSON for now; swap to Prometheus exposition format later
    // (or run a separate /metrics endpoint with the prom-client encoder).
    reply.header("content-type", "application/json; charset=utf-8");
    return snapshot;
  });
}
