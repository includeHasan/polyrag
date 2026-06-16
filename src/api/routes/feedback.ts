/**
 * POST /api/feedback — capture user feedback (thumbs, ratings, comments)
 * for a given query log entry. Phase 1 logs to the application logger
 * and acks; Phase 2 will persist to the `feedback` table in Postgres.
 */
import type { FastifyInstance } from "fastify";
import { FeedbackSchema } from "@/shared/types.js";
import { getObservability } from "../deps.js";
import { logger } from "@/shared/logger.js";

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/feedback", async (request) => {
    const parsed = FeedbackSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    const feedback = parsed.data;
    logger.info(
      {
        queryLogId: feedback.queryLogId,
        rating: feedback.rating,
        user: request.user?.sub ?? "anonymous",
      },
      "feedback received",
    );
    try {
      const obs = await getObservability();
      obs.incrCounter("feedbackTotal");
    } catch {
      // best-effort
    }
    return { ok: true };
  });
}
