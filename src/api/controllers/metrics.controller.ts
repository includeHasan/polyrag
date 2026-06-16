/**
 * Metrics controller — serves the in-process metrics snapshot as JSON.
 * No auth, intended to be scraped by Prometheus / pulled by ops dashboards.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { getMetricsSnapshot } from "../services/metrics.service.js";

export async function metrics(_request: FastifyRequest, reply: FastifyReply) {
  const snapshot = await getMetricsSnapshot();
  // Plain JSON for now; swap to Prometheus exposition format later
  // (or run a separate /metrics endpoint with the prom-client encoder).
  reply.header("content-type", "application/json; charset=utf-8");
  return snapshot;
}
