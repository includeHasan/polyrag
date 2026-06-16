/**
 * MetadataRetriever — for filter-only queries where the user is browsing by
 * tag / department / author / date rather than semantic similarity.
 *
 * Stub: returns an empty list for now. The real implementation will run a
 * Qdrant scroll with the merged filter and optionally a deterministic sort.
 * Keeping the class scaffolded lets the orchestrator branch on retriever
 * kind from day one.
 */
import { RetrievalError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { Chunk, QueryUnderstanding } from "../shared/types.js";
import { BaseRetriever, type RetrieveOptions } from "./base.js";

export class MetadataRetriever extends BaseRetriever {
  readonly name = "metadata";

  async retrieve(
    query: string,
    understanding: QueryUnderstanding,
    options?: RetrieveOptions,
  ): Promise<Chunk[]> {
    try {
      const filter = { ...(understanding.filters ?? {}), ...(options?.filter ?? {}) };
      const hasFilter = Object.keys(filter).length > 0;
      logger.debug(
        {
          retriever: this.name,
          queryLen: query.length,
          hasFilter,
          filter,
        },
        "MetadataRetriever invoked (stub)",
      );
      // Phase 2: hand the filter to a Qdrant scroll and map hits to Chunks.
      return [];
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `MetadataRetriever failed: ${(err as Error).message}`,
        err,
      );
    }
  }
}
