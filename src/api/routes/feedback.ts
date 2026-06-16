/**
 * POST /api/feedback — route wiring only. Validation, identity resolution,
 * and the capture logic live in `controllers/feedback.controller.ts` and
 * `services/feedback.service.ts`.
 */
import type { FastifyInstance } from "fastify";
import { feedback } from "../controllers/feedback.controller.js";

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/feedback",
    {
      schema: {
        tags: ["Feedback & Eval"],
        summary: "Submit feedback on a query",
        security: [{ bearerAuth: [] }],
      },
    },
    feedback,
  );
}
