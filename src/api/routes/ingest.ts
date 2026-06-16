/**
 * POST /api/ingest — synchronously run the ingestion pipeline.
 *
 * For Phase 1, ingestion runs inline. The handler validates the body
 * against the shared `IngestRequest` Zod schema, calls `runIngestion`,
 * and returns a small acknowledgement with the resulting document id
 * and chunk count. The job id is hard-coded to "inline" until the
 * queue lands in Phase 2.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { IngestRequestSchema } from "@/shared/types.js";
import { getIngestion, getObservability } from "../deps.js";
import { AuthorizationError, IngestionError } from "@/shared/errors.js";
import { requirePermission } from "@/security/rbac.js";
import type { UserPayload } from "@/security/auth.js";
import { tenantConfigService } from "@/tenancy/configService.js";

interface InlineIngestResponse {
  jobId: "inline";
  documentId: string;
  chunkCount: number;
  status: "completed";
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/ingest", async (request, reply) => {
    const start = Date.now();
    // Phase 1 stub: any authenticated user can ingest. Phase 3 will
    // gate on `request.user.roles` (e.g. "ingest:write").
    if (!request.user) {
      throw new AuthorizationError("Authentication required to ingest");
    }

    // Require ingest permission
    requirePermission(request.user as unknown as UserPayload, "ingest")

    // Extract tenant context
    const tenantId = (request.user.tenantId as string | undefined) ??
      (request.user.tenant_id as string | undefined) ??
      "default"
    const userId = (request.user.userId as string | undefined) ??
      (request.user.sub as string | undefined) ?? null

    const parsed = IngestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw parsed.error;
    }
    const ingestRequest = { ...parsed.data, tenantId };

    const ingestion = await getIngestion();
    let result;
    try {
      result = await ingestion.runIngestion(ingestRequest);
    } catch (err) {
      if (err instanceof IngestionError) throw err;
      throw new IngestionError(
        `Ingestion failed for source=${ingestRequest.source}`,
        err,
      );
    }

    const body: InlineIngestResponse = {
      jobId: "inline",
      documentId: result.documentId ?? result.document.id ?? randomUUID(),
      chunkCount: result.chunks.length,
      status: "completed",
    };

    const obs = await getObservability();
    obs.incrCounter("ingestionsTotal");
    obs.recordLatency("ingest", Date.now() - start);
    reply.header("x-request-id", request.id);
    return body;
  });
}
