/**
 * HybridRetriever — fuses vector and keyword results with reciprocal rank
 * fusion (RRF).
 *
 *   RRF(d) = Σ_r  1 / (k + rank_r(d))
 *
 * where `rank_r(d)` is the 1-based rank of document `d` in result list `r`,
 * and `k` is a smoothing constant (default 60). Chunks not present in a
 * list are simply not added for that list.
 *
 * Phase 2 scaffold: only the fusion math and the RRF top-K selection are
 * implemented here. The vector leg calls `VectorRetriever`; the keyword leg
 * delegates to `KeywordRetriever` (which currently returns empty until the
 * ES query body is wired). The orchestrator is ready to light up both legs
 * the moment the keyword side comes online.
 */
import { RetrievalError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { Chunk, QueryUnderstanding } from "../shared/types.js";
import { BaseRetriever, type RetrieveOptions } from "./base.js";
import { KeywordRetriever } from "./keyword.js";
import { VectorRetriever } from "./vector.js";

const DEFAULT_RRF_K = 60;

export class HybridRetriever extends BaseRetriever {
  readonly name = "hybrid";

  private readonly vector: VectorRetriever;
  private readonly keyword: KeywordRetriever;
  private readonly rrfK: number;

  constructor(opts?: { rrfK?: number }) {
    super();
    this.vector = new VectorRetriever();
    this.keyword = new KeywordRetriever();
    this.rrfK = opts?.rrfK ?? DEFAULT_RRF_K;
  }

  async retrieve(
    query: string,
    understanding: QueryUnderstanding,
    options?: RetrieveOptions,
  ): Promise<Chunk[]> {
    try {
      const topK = options?.topK ?? 10;
      const tenantId = options?.filter?.tenantId as string | undefined;
      const filter: Record<string, unknown> = tenantId != null
        ? { ...(options?.filter ?? {}), tenantId }
        : { ...(options?.filter ?? {}) };

      const [vecHits, kwHits] = await Promise.all([
        this.vector.retrieve(query, understanding, { ...options, filter }),
        this.keyword.retrieve(query, understanding, { ...options, filter }),
      ]);

      const fused = this.reciprocalRankFusion(vecHits, kwHits);
      const out = fused.slice(0, topK).map((entry) => entry.chunk);

      logger.debug(
        {
          retriever: this.name,
          vecHits: vecHits.length,
          kwHits: kwHits.length,
          out: out.length,
          rrfK: this.rrfK,
        },
        "HybridRetriever complete",
      );

      return out;
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `HybridRetriever failed: ${(err as Error).message}`,
        err,
      );
    }
  }

  /**
   * Reciprocal rank fusion. Returns chunks sorted by descending RRF score.
   * Exposed for testing.
   */
  reciprocalRankFusion(
    vectorChunks: Chunk[],
    keywordChunks: Chunk[],
  ): Array<{ chunk: Chunk; score: number }> {
    const scores = new Map<string, number>();
    const byId = new Map<string, Chunk>();

    const add = (chunks: Chunk[], list: "vec" | "kw") => {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (!byId.has(c.chunkId)) byId.set(c.chunkId, c);
        const prev = scores.get(c.chunkId) ?? 0;
        const contribution = 1 / (this.rrfK + (i + 1));
        scores.set(c.chunkId, prev + contribution);
        void list;
      }
    };

    add(vectorChunks, "vec");
    add(keywordChunks, "kw");

    return Array.from(scores.entries())
      .map(([chunkId, score]) => ({ chunk: byId.get(chunkId)!, score }))
      .filter((entry) => entry.chunk !== undefined)
      .sort((a, b) => b.score - a.score);
  }
}
