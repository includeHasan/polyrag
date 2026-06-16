/**
 * Per-feature configuration, derived from the validated env.
 * Use these in factory functions to pick the right implementation.
 */
import { env } from "./env.js";

export const llmConfig = {
  generationModel: env.OPENAI_MODEL_GENERATION,
  evaluationModel: env.OPENAI_MODEL_EVALUATION,
  rerankModel: env.OPENAI_MODEL_RERANK,
  embeddingModel: env.OPENAI_EMBEDDING_MODEL,
  embeddingDim: env.OPENAI_EMBEDDING_DIM,
};

export const retrievalConfig = {
  topK: env.RETRIEVAL_TOP_K,
  rerankTopK: env.RETRIEVAL_RERANK_TOP_K,
  rerankerEnabled: env.RERANKER_ENABLED,
  hybridSearchEnabled: env.HYBRID_SEARCH_ENABLED,
};

export const chunkingConfig = {
  strategy: env.CHUNKER_STRATEGY,
  chunkSize: env.CHUNK_SIZE,
  chunkOverlap: env.CHUNK_OVERLAP,
};

export const serverConfig = {
  host: env.SERVER_HOST,
  port: env.SERVER_PORT,
};
