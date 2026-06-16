/**
 * Ingestion service — HTTP-agnostic orchestration over the ingestion pipeline
 * (`@/rag/ingestion/pipeline.ts`, reached through the lazy `deps` wrapper).
 */
import { randomUUID } from "node:crypto";
import { getIngestion } from "../deps.js";
import { IngestionError } from "@/core/shared/errors.js";
import type { IngestRequest } from "@/core/shared/types.js";

export interface IngestResult {
  jobId: "inline";
  documentId: string;
  chunkCount: number;
  status: "completed";
}

/** Run the ingestion pipeline for a single (tenant-scoped) request. */
export async function ingestDocument(
  req: IngestRequest & { tenantId: string },
): Promise<IngestResult> {
  const ingestion = await getIngestion();
  let result;
  try {
    result = await ingestion.runIngestion(req);
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    throw new IngestionError(`Ingestion failed for source=${req.source}`, err);
  }
  return {
    jobId: "inline",
    documentId: result.documentId ?? result.document.id ?? randomUUID(),
    chunkCount: result.chunks.length,
    status: "completed",
  };
}
