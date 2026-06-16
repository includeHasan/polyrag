/**
 * NoopReranker — passes chunks through unchanged.
 *
 * The default Phase 1 config uses this so the platform can run end-to-end
 * without paying for a second model call. When `topN >= chunks.length` the
 * input is returned as-is; when `topN` is smaller, the first `topN` chunks
 * are kept (preserving the upstream ordering, which for the vector
 * retriever is already score-descending).
 */
import { logger } from "@/core/shared/logger.js";
import type { Chunk } from "@/core/shared/types.js";
import { BaseReranker } from "./base.js";

export class NoopReranker extends BaseReranker {
  readonly name = "noop";

  async rerank(query: string, chunks: Chunk[], topN: number): Promise<Chunk[]> {
    const safeTopN = Math.max(0, Math.min(topN, chunks.length));
    logger.debug(
      { retriever: this.name, in: chunks.length, out: safeTopN, queryLen: query.length },
      "NoopReranker pass-through",
    );
    return chunks.slice(0, safeTopN);
  }
}
