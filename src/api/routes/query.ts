/**
 * POST /api/query — route wiring only. The handler logic (validation, auth,
 * rate limit, graph orchestration, SSE) lives in the query controller and
 * service.
 */
import type { FastifyInstance } from "fastify";
import { rateLimitPreHandler } from "../middleware/rateLimit.js";
import { query } from "../controllers/query.controller.js";

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/query",
    {
      preHandler: rateLimitPreHandler({ action: "query" }),
      schema: {
        tags: ["Query"],
        summary: "Run a RAG query",
        description:
          "Run a retrieval-augmented generation query. Supports Server-Sent Events (SSE) streaming when `stream=true`. Tenant-scoped: requires authentication and applies multi-tenant filters based on the caller's tenant.",
        security: [{ bearerAuth: [] }],
      },
    },
    query,
  );
}
