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
import { billingRoutes } from "./billing.js";
import { oauth2Routes } from "./oauth2.js";
import { adminTenantRoutes } from "./admin/tenants.js";
import { adminConfigRoutes } from "./admin/config.js";

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
    billingRoutes(app),
    oauth2Routes(app),
  ]);
  await app.register(adminTenantRoutes);
  await app.register(adminConfigRoutes);
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
  billingRoutes,
  oauth2Routes,
  adminTenantRoutes,
  adminConfigRoutes,
};
