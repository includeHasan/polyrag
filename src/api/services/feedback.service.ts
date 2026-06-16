/**
 * Feedback service — HTTP-agnostic capture of user feedback (thumbs, ratings,
 * comments) for a given query log entry. Phase 1 logs to the application
 * logger and acks; Phase 2 will persist to the `feedback` table in Postgres.
 */
import type { Feedback } from "@/core/shared/types.js";
import { logger } from "@/core/shared/logger.js";

export interface FeedbackResult {
  ok: true;
}

/** Record a feedback submission on behalf of `user`. */
export async function submitFeedback(
  feedback: Feedback,
  user: string,
): Promise<FeedbackResult> {
  logger.info(
    {
      queryLogId: feedback.queryLogId,
      rating: feedback.rating,
      user,
    },
    "feedback received",
  );
  return { ok: true };
}
