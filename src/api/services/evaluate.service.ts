/**
 * Evaluation service — HTTP-agnostic orchestration that runs an evaluation
 * dataset through the harness and returns the per-metric report.
 */
import { z } from "zod";
import {
  getEvaluation,
  type EvaluationReport,
  type EvaluationSample,
} from "../deps.js";

export const EvaluationRequestSchema = z.object({
  dataset: z
    .array(
      z.object({
        query: z.string().min(1),
        groundTruthChunks: z.array(z.string()),
        expectedAnswer: z.string().optional(),
      }),
    )
    .min(1),
});

export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

/** Run the evaluation harness over a dataset and return its report. */
export async function evaluate(
  req: EvaluationRequest,
): Promise<EvaluationReport> {
  const { runEvaluation } = await getEvaluation();
  return runEvaluation(req.dataset as EvaluationSample[]);
}
