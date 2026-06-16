/**
 * POST /api/ingest — route wiring only. Validation, auth, and the pipeline
 * call live in `controllers/ingest.controller.ts` and `services/ingest.service.ts`.
 */
import type { FastifyInstance } from "fastify";
import { ingest } from "../controllers/ingest.controller.js";

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/ingest",
    {
      schema: {
        tags: ["Ingestion"],
        summary: "Ingest a document",
        description:
          "Synchronously runs the ingestion pipeline (connector → chunk → embed → index). Tenant-scoped; requires the `ingest` permission.",
        security: [{ bearerAuth: [] }],
      },
    },
    ingest,
  );
}
