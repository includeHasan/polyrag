/**
 * POST /api/search — route wiring only. Validation, retrieval, and response
 * shaping live in `controllers/search.controller.ts` and
 * `services/search.service.ts`.
 */
import type { FastifyInstance } from "fastify";
import { search } from "../controllers/search.controller.js";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/search",
    {
      schema: {
        tags: ["Query"],
        summary: "Raw retrieval (no generation)",
        description:
          "Pure retrieval with no generation. Useful for previews and for tools that want the raw context without paying the LLM cost. Requires authentication.",
        security: [{ bearerAuth: [] }],
      },
    },
    search,
  );
}

// Re-export schema for documentation/tests.
export { SearchResponseSchema } from "../services/search.service.js";
