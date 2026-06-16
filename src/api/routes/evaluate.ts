/**
 * POST /api/evaluate — run an evaluation dataset through the harness
 * and return the per-metric report.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEvaluation, getObservability, type EvaluationSample } from "../deps.js";

const EvaluationRequestSchema = z.object({
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

type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

export async function evaluateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/evaluate", {
    schema: {
      tags: ["Feedback & Eval"],
      summary: "Run the evaluation harness over a dataset",
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    const start = Date.now();
    const parsed = EvaluationRequestSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    const body: EvaluationRequest = parsed.data;

    const { runEvaluation } = await getEvaluation();
    const report = await runEvaluation(body.dataset as EvaluationSample[]);

    try {
      const obs = await getObservability();
      obs.incrCounter("evaluationsTotal");
      obs.recordLatency("evaluation", Date.now() - start);
    } catch {
      // best-effort
    }
    return report;
  });
}
