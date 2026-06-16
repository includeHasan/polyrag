/**
 * Route barrel — register all HTTP routes with the Fastify instance.
 */
import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { metricsRoutes } from "./metrics.js";
import { ingestRoutes } from "./ingest.js";
import { queryRoutes } from "./query.js";
import { searchRoutes } from "./search.js";
import { reindexRoutes } from "./reindex.js";
import { feedbackRoutes } from "./feedback.js";
import { evaluateRoutes } from "./evaluate.js";
import { sessionRoutes } from "./sessions.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await Promise.all([
    healthRoutes(app),
    metricsRoutes(app),
    ingestRoutes(app),
    queryRoutes(app),
    searchRoutes(app),
    reindexRoutes(app),
    feedbackRoutes(app),
    evaluateRoutes(app),
    sessionRoutes(app),
  ]);
}

export {
  healthRoutes,
  metricsRoutes,
  ingestRoutes,
  queryRoutes,
  searchRoutes,
  reindexRoutes,
  feedbackRoutes,
  evaluateRoutes,
  sessionRoutes,
};
