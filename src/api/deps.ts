/**
 * Local type-only declarations and dynamic-import wrappers for the
 * dependencies the API layer needs from other modules that are still
 * being built (memory, observability, ingestion pipeline, retrieval,
 * evaluation, agents/query).
 *
 * Strategy:
 *   - Type-only interfaces live here, re-exported as `* as <Name>` so
 *     route files can `import { Foo } from "../deps.js"` without touching
 *     cross-module files.
 *   - Runtime calls go through `await import("@/...path")` cast through
 *     the local interfaces. This way the route code type-checks even
 *     when the underlying module is still a stub.
 *
 * Once the owning layers land, the dynamic-import wrappers can be
 * replaced with direct `import { ... } from "@/.../X.js"` calls and
 * this file can be deleted.
 */
import type { FastifyInstance } from "fastify";
import type { Chunk, Document, Source } from "@/shared/types.js";

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------
export interface MetricsSnapshot {
  counters: Record<string, number>;
  latencies: Record<string, { count: number; avgMs: number; p95Ms: number; maxMs: number }>;
  uptimeMs: number;
  version: string;
}

export interface ObservabilityModule {
  getMetrics(): MetricsSnapshot;
  recordLatency(name: string, ms: number): void;
  incrCounter(name: string, n?: number): void;
  recordObservation(name: string, value: number): void;
}

let _observability: ObservabilityModule | null = null;
export async function getObservability(): Promise<ObservabilityModule> {
  if (_observability) return _observability;
  _observability = (await import("@/observability/metrics.js")) as unknown as ObservabilityModule;
  return _observability;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
export interface MemoryModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCheckpointer(): Promise<any>;
}

let _memory: MemoryModule | null = null;
export async function getMemory(): Promise<MemoryModule> {
  if (_memory) return _memory;
  _memory = (await import("@/memory/session.js")) as unknown as MemoryModule;
  return _memory;
}

// ---------------------------------------------------------------------------
// Ingestion pipeline
// ---------------------------------------------------------------------------
export interface IngestionResult {
  documentId: string;
  document: Document;
  chunks: Chunk[];
  sources: Source[];
}

export interface IngestionModule {
  runIngestion(request: unknown): Promise<IngestionResult>;
}

let _ingestion: IngestionModule | null = null;
export async function getIngestion(): Promise<IngestionModule> {
  if (_ingestion) return _ingestion;
  _ingestion = (await import("@/ingestion/pipeline.js")) as unknown as IngestionModule;
  return _ingestion;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------
export interface RetrievalResult {
  chunks: Chunk[];
  sources: Source[];
}

export interface Retriever {
  retrieve(
    query: string,
    options?: { topK?: number; filters?: Record<string, unknown> },
  ): Promise<RetrievalResult>;
  readonly name: string;
}

export interface RetrievalModule {
  getRetriever(): Promise<Retriever>;
}

let _retrieval: RetrievalModule | null = null;
export async function getRetrieval(): Promise<RetrievalModule> {
  if (_retrieval) return _retrieval;
  // @ts-expect-error — module is owned by retrieval layer; type cast on next line.
  const mod = await import("@/retrieval/index.js");
  _retrieval = mod as unknown as RetrievalModule;
  return _retrieval;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
export interface EvaluationSample {
  query: string;
  groundTruthChunks: string[];
  expectedAnswer?: string;
}

export interface EvaluationReport {
  samples: number;
  metrics: Record<string, number>;
  details?: Array<{
    query: string;
    scores: Record<string, number>;
    sources?: Source[];
    answer?: string;
  }>;
  generatedAt: string;
}

export interface EvaluationModule {
  runEvaluation(dataset: EvaluationSample[]): Promise<EvaluationReport>;
}

let _evaluation: EvaluationModule | null = null;
export async function getEvaluation(): Promise<EvaluationModule> {
  if (_evaluation) return _evaluation;
  _evaluation = (await import("@/evaluation/harness.js")) as unknown as EvaluationModule;
  return _evaluation;
}

// ---------------------------------------------------------------------------
// Query graph (LangGraph)
// ---------------------------------------------------------------------------
export interface QueryGraphState {
  query: string;
  sessionId?: string;
  filters?: Record<string, unknown>;
  topK?: number;
  /** Phase 5: tenant scope for multi-tenant isolation in the retrieve node. */
  tenantId?: string | null;
  /** Phase 5: calling user id (used for ACL filtering and metering). */
  userId?: string | null;
  /** Phase 5: full AuthUser payload, when available. */
  user?: unknown;
  answer?: string;
  sources?: Source[];
  metrics?: {
    retrieved: number;
    reranked: number;
    llmTokens?: number;
    latencyMs?: number;
  };
  queryLogId?: string;
  /** Free-form metadata blob used by downstream graph nodes. */
  metadata?: Record<string, unknown>;
}

export interface CompiledQueryGraph {
  invoke(
    input: QueryGraphState,
    options?: { configurable?: Record<string, unknown> },
  ): Promise<QueryGraphState>;
  stream(
    input: QueryGraphState,
    options: { streamMode: "messages"; configurable?: Record<string, unknown> },
  ): AsyncIterable<unknown>;
}

export interface QueryGraphModule {
  graph: CompiledQueryGraph;
}

let _queryGraph: CompiledQueryGraph | null = null;

/** Set the query graph (called by the process entrypoint). */
export function setQueryGraphModule(graph: CompiledQueryGraph): void {
  _queryGraph = graph;
}

/** Resolve the query graph, preferring the explicitly-set value. */
export async function getQueryGraph(): Promise<CompiledQueryGraph> {
  if (_queryGraph) return _queryGraph;
  const mod = (await import("@/agents/query/index.js")) as unknown as QueryGraphModule;
  _queryGraph = mod.graph;
  return _queryGraph;
}

// ---------------------------------------------------------------------------
// Fastify helper aliases (keeps route imports tidy).
// ---------------------------------------------------------------------------
export type AppInstance = FastifyInstance;
