/**
 * State schema for the ingestion agent.
 *
 * Linear flow over a single `IngestRequest`:
 *   load → process → chunk → embed → store
 */
import { z } from "zod";
import {
  ChunkSchema,
  IngestRequestSchema,
  IngestionJobStatusSchema,
} from "@/core/shared/types.js";

export const IngestionStateSchema = z.object({
  request: IngestRequestSchema,
  /** Document id assigned by the loader (after connector load()). */
  documentId: z.string().optional(),
  /** Title extracted from the loaded document. */
  title: z.string().optional(),
  /** Raw document content (after `connect()` + `load()`). */
  rawContent: z.string().optional(),
  /** Cleaned + sectioned text (after `process`). */
  processedContent: z.string().optional(),
  /** Sections recovered by the structural parser. */
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
        page: z.number().int().positive().optional(),
      }),
    )
    .default(() => []),
  /** Final chunks ready for embedding. */
  chunks: z.array(ChunkSchema).default(() => []),
  /** Job status, mirrored to the DB by the storage layer. */
  status: IngestionJobStatusSchema.default("queued"),
  /** Error message set by any node that fails. */
  error: z.string().optional(),
  /** Free-form per-job metadata. */
  metadata: z.record(z.string(), z.any()).default(() => ({})),
});

export type IngestionState = z.infer<typeof IngestionStateSchema>;
