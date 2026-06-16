/**
 * Swappable-component contracts for the Advanced RAG Platform.
 *
 * These interfaces are the seam between modules. Concrete implementations
 * live in the respective subfolders (`src/embeddings/`, `src/retrieval/`,
 * `src/chunking/`, `src/reranking/`, `src/database/`, `src/ingestion/`).
 *
 * PRD §5–§9.
 */
import type {
  Chunk,
  Document,
  IngestRequest,
  QueryUnderstanding,
  Source,
} from "./types.js";

// ---------------------------------------------------------------------------
// DataConnector — PRD §5
// ---------------------------------------------------------------------------
export interface DataConnector {
  /** Connect to the source (open file, hit API, etc.). */
  connect(): Promise<void>;
  /** Load and return documents. */
  load(): Promise<Document[]>;
  /** Optional: tear down any resources (file handles, network). */
  disconnect?(): Promise<void>;
  /** Factory: pick a connector from an IngestRequest. */
  readonly kind: IngestRequest["source"];
}

// ---------------------------------------------------------------------------
// Chunker — PRD §3
// ---------------------------------------------------------------------------
export interface Chunker {
  /** Split a document into chunks with metadata. */
  split(doc: Document): Promise<Chunk[]>;
  readonly strategy: "fixed" | "recursive" | "semantic" | "agentic";
}

// ---------------------------------------------------------------------------
// EmbeddingProvider — PRD §4
// ---------------------------------------------------------------------------
export interface EmbeddingProvider {
  /** Embed a single text. */
  embed(text: string): Promise<number[]>;
  /** Embed a batch of texts. */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** The model's output dimension. */
  readonly dimension: number;
  /** The model identifier. */
  readonly model: string;
}

// ---------------------------------------------------------------------------
// VectorStore — PRD §5
// ---------------------------------------------------------------------------
export interface VectorSearchHit {
  chunk: Chunk;
  score: number;
}

export interface VectorStore {
  /** Create / ensure a collection exists. */
  ensureCollection(name: string, dimension: number): Promise<void>;
  /** Upsert chunks (with embeddings already computed). */
  upsert(chunks: Chunk[]): Promise<void>;
  /** Search by vector similarity. */
  search(
    vector: number[],
    k: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchHit[]>;
  /** Delete all chunks for a document. */
  deleteByDocument(documentId: string): Promise<void>;
  /** Collection name. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Retriever — PRD §6
// ---------------------------------------------------------------------------
export interface Retriever {
  /** Retrieve relevant chunks for a query. */
  retrieve(
    query: string,
    understanding: QueryUnderstanding,
    options?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<Chunk[]>;
  /** Human-readable name. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Reranker — PRD §8
// ---------------------------------------------------------------------------
export interface Reranker {
  /** Rerank chunks; return topN. */
  rerank(query: string, chunks: Chunk[], topN: number): Promise<Chunk[]>;
  readonly name: string;
}

// ---------------------------------------------------------------------------
// ContextBuilder — PRD §9
// ---------------------------------------------------------------------------
export interface ContextBuilder {
  /** Build a context string + source list from chunks. */
  build(query: string, chunks: Chunk[]): Promise<{ context: string; sources: Source[] }>;
}

// ---------------------------------------------------------------------------
// LLMProvider — thin wrapper over the chat model.
// ---------------------------------------------------------------------------
export interface LLMProvider {
  /** Generate a complete response. */
  generate(prompt: string, options?: { system?: string; temperature?: number; maxTokens?: number }): Promise<string>;
  /** Stream tokens; resolves to final assembled string. */
  stream(
    prompt: string,
    onToken: (token: string) => void,
    options?: { system?: string; temperature?: number; maxTokens?: number },
  ): Promise<string>;
  readonly model: string;
}

// ---------------------------------------------------------------------------
// Evaluation (PRD §17) — pluggable metrics surface.
// ---------------------------------------------------------------------------
export interface EvaluationMetric {
  readonly name: string;
  score(input: { query: string; answer: string; sources: Source[]; groundTruth?: string[] }): Promise<number>;
}
