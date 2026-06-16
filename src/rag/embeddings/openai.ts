/**
 * OpenAI-backed embedding provider.
 *
 * Built on top of `@langchain/openai`'s `OpenAIEmbeddings`, which already
 * handles batching, retries, and the v3 `dimensions` parameter. The class
 * just adapts the LangChain shape to our `EmbeddingProvider` contract.
 */
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "@/core/config/env.js";
import { IngestionError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import { BaseEmbeddingProvider } from "./base.js";

export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  private readonly client: OpenAIEmbeddings;

  constructor(opts?: { model?: string; dimension?: number; apiKey?: string }) {
    super();
    this.model = opts?.model ?? env.OPENAI_EMBEDDING_MODEL;
    this.dimension = opts?.dimension ?? env.OPENAI_EMBEDDING_DIM;

    this.client = new OpenAIEmbeddings({
      model: this.model,
      // The v3 embedding models accept an explicit output dimension.
      dimensions: this.dimension,
      apiKey: opts?.apiKey ?? env.OPENAI_API_KEY,
      // Reasonable defaults for a batch-heavy ingestion pipeline.
      maxRetries: 3,
    });

    logger.debug(
      { model: this.model, dimension: this.dimension },
      "OpenAIEmbeddingProvider initialized",
    );
  }

  async embed(text: string): Promise<number[]> {
    if (!text || !text.trim()) {
      throw new IngestionError("Cannot embed empty text");
    }
    try {
      const vec = await this.client.embedQuery(text);
      return this.sanitize(vec);
    } catch (err) {
      throw new IngestionError(
        `OpenAI embed failed for text of length ${text.length}: ${(err as Error).message}`,
        err,
      );
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      const vecs = await this.client.embedDocuments(texts);
      return vecs.map((v) => this.sanitize(v));
    } catch (err) {
      throw new IngestionError(
        `OpenAI embedBatch failed for ${texts.length} texts: ${(err as Error).message}`,
        err,
      );
    }
  }

  /** Defensive: ensure we return a real array of finite numbers. */
  private sanitize(vec: number[]): number[] {
    if (!Array.isArray(vec)) {
      throw new IngestionError("Embedding provider returned non-array vector");
    }
    if (vec.length !== this.dimension) {
      // Some models allow variable dimensions; warn but don't fail the job.
      logger.warn(
        { expected: this.dimension, got: vec.length },
        "Embedding dimension mismatch with configured value",
      );
    }
    return vec;
  }
}
