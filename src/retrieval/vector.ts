/**
 * VectorRetriever — embeds the query and runs a Qdrant similarity search.
 *
 * The Qdrant `VectorStore` factory is imported from `@/database/qdrant.js`.
 * The retriever merges any filters coming from `QueryUnderstanding.filters`
 * with the `filter` passed in the caller's options (options win on key
 * conflict because they are more specific to this call).
 */
import { getEmbeddingProvider } from "../embeddings/factory.js";
import { getVectorStore } from "@/database/qdrant.js";
import { RetrievalError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { Chunk, QueryUnderstanding } from "../shared/types.js";
import { BaseRetriever, type RetrieveOptions } from "./base.js";

export class VectorRetriever extends BaseRetriever {
  readonly name = "vector";

  constructor(private readonly topKOverride?: number) {
    super();
  }

  async retrieve(
    query: string,
    understanding: QueryUnderstanding,
    options?: RetrieveOptions,
  ): Promise<Chunk[]> {
    const topK = options?.topK ?? this.topKOverride ?? 10;
    const filter = this.mergeFilters(understanding.filters, options?.filter);

    try {
      const embeddings = getEmbeddingProvider();
      const vector = await embeddings.embed(query);

      const store = getVectorStore();
      const hits = await store.search(vector, topK, filter);

      logger.debug(
        { retriever: this.name, topK, hits: hits.length, filter },
        "VectorRetriever complete",
      );

      return hits.map((h: { chunk: import("../shared/types.js").Chunk; score: number }) => h.chunk);
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `VectorRetriever failed for query of length ${query.length}: ${(err as Error).message}`,
        err,
      );
    }
  }

  /**
   * Combine the always-applied understanding filters with the optional
   * per-call options filter. Options take precedence on key conflicts.
   */
  private mergeFilters(
    base: Record<string, unknown> | undefined,
    extra: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!base && !extra) return undefined;
    return { ...(base ?? {}), ...(extra ?? {}) };
  }
}
