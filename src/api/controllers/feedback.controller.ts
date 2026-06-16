/**
 * Feedback controller — validates the request, resolves the submitting user,
 * delegates to the feedback service, and records metrics (best-effort).
 */
import type { FastifyRequest } from "fastify";
import { FeedbackSchema } from "@/core/shared/types.js";
import { getObservability } from "../deps.js";
import { submitFeedback } from "../services/feedback.service.js";
import { identity } from "./_context.js";

export async function feedback(request: FastifyRequest) {
  const parsed = FeedbackSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;

  const { user } = identity(request);
  const body = await submitFeedback(parsed.data, user?.sub ?? "anonymous");

  try {
    const obs = await getObservability();
    obs.incrCounter("feedbackTotal");
  } catch {
    // best-effort
  }
  return body;
}
