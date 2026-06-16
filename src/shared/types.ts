/**
 * Shared types and Zod schemas for the Advanced RAG Platform.
 *
 * All cross-module data structures live here. Modules import from this file
 * and from `interfaces.ts` (the swappable-component contracts).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Document (output of a DataConnector — PRD §5)
// ---------------------------------------------------------------------------
export const DocumentSchema = z.object({
  id: z.string(),
  source: z.string(),                 // e.g. "pdf", "docx", "url", "notion"
  uri: z.string().optional(),         // canonical location (path, url)
  title: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.any()).default({}),
  createdAt: z.string().datetime().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

// ---------------------------------------------------------------------------
// Chunk (output of the Chunker — PRD §3)
// ---------------------------------------------------------------------------
export const ChunkMetadataSchema = z.object({
  source: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  department: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

export const ChunkSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  section: z.string().optional(),
  page: z.number().int().positive().optional(),
  text: z.string(),
  metadata: ChunkMetadataSchema.default({ tags: [] }),
  // Optional vector — populated after embedding, not stored on Chunk in flight.
  embedding: z.array(z.number()).optional(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

// ---------------------------------------------------------------------------
// Source (citation record — PRD §12)
// ---------------------------------------------------------------------------
export const SourceSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  page: z.number().int().positive().optional(),
  url: z.string().optional(),
  chunkId: z.string().optional(),
  snippet: z.string(),
  score: z.number().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

// ---------------------------------------------------------------------------
// Query / Response (PRD §16)
// ---------------------------------------------------------------------------
export const QueryRequestSchema = z.object({
  query: z.string().min(1),
  sessionId: z.string().optional(),
  filters: z.record(z.string(), z.any()).optional(),
  topK: z.number().int().positive().max(100).optional(),
  stream: z.boolean().default(false),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export const QueryResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(SourceSchema),
  sessionId: z.string().optional(),
  queryLogId: z.string().optional(),
  metrics: z.object({
    retrieved: z.number().int(),
    reranked: z.number().int(),
    llmTokens: z.number().int().optional(),
    latencyMs: z.number().int().optional(),
  }).optional(),
});
export type QueryResponse = z.infer<typeof QueryResponseSchema>;

// ---------------------------------------------------------------------------
// Ingestion (PRD §1 Module 1, §16 endpoint)
// ---------------------------------------------------------------------------
export const IngestRequestSchema = z.object({
  source: z.enum(["pdf", "docx", "txt", "md", "url"]),
  path: z.string().optional(),
  url: z.string().url().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).default([]),
  department: z.string().optional(),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestionJobStatusSchema = z.enum([
  "queued", "processing", "completed", "failed",
]);
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>;

export const IngestionJobSchema = z.object({
  id: z.string(),
  request: IngestRequestSchema,
  status: IngestionJobStatusSchema,
  documentId: z.string().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type IngestionJob = z.infer<typeof IngestionJobSchema>;

// ---------------------------------------------------------------------------
// Intent (PRD §7)
// ---------------------------------------------------------------------------
export const QueryIntentSchema = z.enum([
  "factual",
  "summarization",
  "comparison",
  "research",
  "analytical",
  "conversational",
]);
export type QueryIntent = z.infer<typeof QueryIntentSchema>;

export const QueryUnderstandingSchema = z.object({
  intent: QueryIntentSchema,
  entities: z.array(z.string()).default([]),
  filters: z.record(z.string(), z.any()).default({}),
  rewrittenQueries: z.array(z.string()).default([]),
});
export type QueryUnderstanding = z.infer<typeof QueryUnderstandingSchema>;

// ---------------------------------------------------------------------------
// Feedback (PRD §16)
// ---------------------------------------------------------------------------
export const FeedbackSchema = z.object({
  queryLogId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
