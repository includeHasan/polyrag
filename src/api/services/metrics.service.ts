/**
 * Metrics service — HTTP-agnostic access to the platform's in-process
 * metrics snapshot via the observability module.
 */
import { getObservability, type MetricsSnapshot } from "../deps.js";

/** Return the current in-process metrics snapshot. */
export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const obs = await getObservability();
  return obs.getMetrics();
}
