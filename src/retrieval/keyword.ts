/**
 * KeywordRetriever — BM25 over an Elasticsearch index.
 *
 * Phase 2 scaffold: the retriever is wired to the ES client factory
 * `@/database/elasticsearch.js`, but the current implementation returns an
 * empty array when the configured client is missing or when an explicit
 * `disabled` flag is set. The full query-body construction lives behind a
 * future PR; the public contract is stable.
 */
import { getEsClient } from "@/database/elasticsearch.js";
import { RetrievalError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { Chunk, QueryUnderstanding } from "../shared/types.js";
import { BaseRetriever, type RetrieveOptions } from "./base.js";

export class KeywordRetriever extends BaseRetriever {
  readonly name = "keyword";

  async retrieve(
    query: string,
    _understanding: QueryUnderstanding,
    _options?: RetrieveOptions,
  ): Promise<Chunk[]> {
    try {
      const client = getEsClient();
      if (!client) {
        logger.debug(
          { retriever: this.name },
          "Elasticsearch not configured; returning empty results",
        );
        return [];
      }

      // Phase 2: build a multi_match query against the chunks index and
      // map the top-K hits into `Chunk` objects. Until that wiring lands,
      // we log and return an empty list rather than throwing — this keeps
      // the retriever pluggable in the graph without breaking Phase 1.
      logger.debug(
        { retriever: this.name, queryLen: query.length },
        "KeywordRetriever invoked (Phase 2 stub)",
      );
      return [];
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `KeywordRetriever failed: ${(err as Error).message}`,
        err,
      );
    }
  }
}
