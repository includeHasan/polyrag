/**
 * Phase 3: Session endpoints — route wiring only. The checkpointer access
 * and response shaping live in `controllers/sessions.controller.ts` and
 * `services/sessions.service.ts`.
 *
 * GET /api/sessions/:id/history
 *   - Returns the full checkpoint history for the given thread_id.
 *   - Each entry is a `StateSnapshot` from the LangGraph checkpointer.
 *
 * GET /api/sessions/:id/state
 *   - Returns the latest state snapshot for a given session.
 *
 * This is the user-facing surface over `getStateHistory` from
 * `src/memory/checkpoint.ts`. Useful for debugging, time-travel UIs, and
 * auditing.
 */
import type { FastifyInstance } from "fastify";
import { sessionHistory, sessionState } from "../controllers/sessions.controller.js";

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/sessions/:id/history",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Get session conversation history",
        security: [{ bearerAuth: [] }],
      },
    },
    sessionHistory,
  );

  app.get(
    "/api/sessions/:id/state",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Get session graph state",
        security: [{ bearerAuth: [] }],
      },
    },
    sessionState,
  );
}
