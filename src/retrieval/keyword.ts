/**
 * KeywordRetriever — BM25 keyword search.
 *
 * Phase 2 implementation backed by the in-process `InProcessBM25Index` (see
 * `./bm25Index.ts`). The index is populated by the ingestion pipeline and
 * persisted to `storage/bm25-index.json` so it survives restarts.
 *
 * For very large corpora (millions of chunks), swap to Elasticsearch by
 * changing the body of `retrieve` to call `keywordSearch()` from
 * `@/database/elasticsearch.js` instead. The `Retriever` contract stays
 * the same.
 */
import { logger } from "@/shared/logger.js";
import { RetrievalError } from "@/shared/errors.js";
import type { Chunk, QueryUnderstanding } from "@/shared/types.js";
import { BaseRetriever, type RetrieveOptions } from "./base.js";
import { getBM25Index } from "./bm25Index.js";

export class KeywordRetriever extends BaseRetriever {
  readonly name = "keyword";

  async retrieve(
    query: string,
    _understanding: QueryUnderstanding,
    options?: RetrieveOptions,
  ): Promise<Chunk[]> {
    try {
      const index = getBM25Index();
      const topK = options?.topK ?? 10;
      const hits = index.search(query, topK);
      logger.debug(
        {
          retriever: this.name,
          queryTokens: query.length,
          indexSize: index.size(),
          hits: hits.length,
        },
        "KeywordRetriever complete",
      );
      return hits.map((h) => h.chunk);
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `KeywordRetriever failed: ${(err as Error).message}`,
        err,
      );
    }
  }
}

/** Re-export so the ingestion pipeline can populate the index. */
export { getBM25Index } from "./bm25Index.js";
