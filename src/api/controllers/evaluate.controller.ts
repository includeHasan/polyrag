/**
 * Evaluate controller — validates the request, delegates to the evaluation
 * service, and records metrics (best-effort).
 */
import type { FastifyRequest } from "fastify";
import { getObservability } from "../deps.js";
import {
  EvaluationRequestSchema,
  evaluate as evaluateService,
  type EvaluationRequest,
} from "../services/evaluate.service.js";

export async function evaluate(request: FastifyRequest) {
  const start = Date.now();
  const parsed = EvaluationRequestSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;
  const body: EvaluationRequest = parsed.data;

  const report = await evaluateService(body);

  try {
    const obs = await getObservability();
    obs.incrCounter("evaluationsTotal");
    obs.recordLatency("evaluation", Date.now() - start);
  } catch {
    // best-effort
  }
  return report;
}
