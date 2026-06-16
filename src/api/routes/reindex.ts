/**
 * POST /api/reindex (and POST /api/reindex/resume) — route wiring only.
 * Validation, the interrupt lifecycle, and the re-index work live in
 * `controllers/reindex.controller.ts` and `services/reindex.service.ts`.
 *
 * The flow:
 *   1. Validate the body.
 *   2. Authn/authz check (admin only in production; permissive in dev).
 *   3. **Interrupt** the workflow — return a `__interrupt__` payload to the
 *      caller with the proposed action and the actor who triggered it.
 *   4. Caller reviews and resumes with `POST /api/reindex/resume` passing
 *      `{ approved: true | false }`.
 *   5. If approved, run the re-index. If not, the workflow returns 200 with
 *      a `cancelled` status and the graph is resumed into a no-op.
 *
 * This is the canonical example of the LangGraph `interrupt()` + `Command`
 * pattern from the `langgraph-human-in-the-loop` skill.
 */
import type { FastifyInstance } from "fastify";
import { reindex, reindexResume } from "../controllers/reindex.controller.js";

export async function reindexRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------
  // POST /api/reindex — start a reindex, pause for approval.
  // ---------------------------------------------------------------------
  app.post(
    "/api/reindex",
    {
      schema: {
        tags: ["Ingestion"],
        summary: "Re-index a document",
        security: [{ bearerAuth: [] }],
      },
    },
    reindex,
  );

  // ---------------------------------------------------------------------
  // POST /api/reindex/resume — caller has decided. Approve or reject.
  // ---------------------------------------------------------------------
  app.post(
    "/api/reindex/resume",
    {
      schema: {
        tags: ["Ingestion"],
        summary: "Resume a paused re-index (HITL)",
        security: [{ bearerAuth: [] }],
      },
    },
    reindexResume,
  );
}
