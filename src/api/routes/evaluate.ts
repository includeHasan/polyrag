/**
 * POST /api/evaluate — route wiring only. Validation and the harness call
 * live in `controllers/evaluate.controller.ts` and
 * `services/evaluate.service.ts`.
 */
import type { FastifyInstance } from "fastify";
import { evaluate } from "../controllers/evaluate.controller.js";

export async function evaluateRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/evaluate",
    {
      schema: {
        tags: ["Feedback & Eval"],
        summary: "Run the evaluation harness over a dataset",
        security: [{ bearerAuth: [] }],
      },
    },
    evaluate,
  );
}
