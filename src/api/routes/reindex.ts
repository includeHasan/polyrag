/**
 * POST /api/reindex — Phase 1 stub.
 *
 * In Phase 3 this will pause the query graph with `interrupt()` and
 * run a full re-index over the specified document (or all documents).
 * For now it returns 501 with a clear "not implemented" message.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getObservability } from "../deps.js";
import { ConfigurationError } from "@/shared/errors.js";

const ReindexRequestSchema = z.object({
  documentId: z.string().min(1),
});

export async function reindexRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/reindex", async (request) => {
    const parsed = ReindexRequestSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    try {
      const obs = await getObservability();
      obs.incrCounter("reindexRequestsTotal");
    } catch {
      // best-effort
    }
    request.log.info(
      { documentId: parsed.data.documentId },
      "reindex request received (not yet implemented)",
    );
    throw new ConfigurationError(
      "Reindex is not implemented in Phase 1. Scheduled for Phase 3.",
    );
  });
}
