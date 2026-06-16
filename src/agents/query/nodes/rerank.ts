/**
 * `rerank` node — narrow retrieved chunks down to a smaller, higher-quality
 * set before the LLM sees them.
 *
 * Skips work cleanly when the reranker is disabled or there are no chunks.
 */
import { logger } from "../../../shared/logger.js";
import { RetrievalError } from "../../../shared/errors.js";
import { getReranker } from "@/reranking/factory.js";
import { resolveNodeConfig } from "./_config.js";
import type { QueryState } from "../state.js";

export async function rerankNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "rerank";
  try {
    const cfg = resolveNodeConfig(state);
    const chunks: any[] = state.retrievedChunks ?? [];
    if (chunks.length === 0) {
      logger.info(`[${nodeName}] no chunks to rerank — passthrough`);
      return {
        rerankedChunks: [],
        metadata: { ...state.metadata, rerankedCount: 0, node: nodeName },
      };
    }
    if (!cfg.retrieval.rerankerEnabled) {
      logger.info(`[${nodeName}] reranker disabled — passthrough`);
      return {
        rerankedChunks: chunks,
        metadata: {
          ...state.metadata,
          rerankedCount: chunks.length,
          reranker: "passthrough",
          node: nodeName,
        },
      };
    }

    logger.info(
      { input: chunks.length, topN: cfg.retrieval.rerankTopK },
      `[${nodeName}] start`,
    );

    const reranker = getReranker(cfg.retrieval);
    const reranked = await reranker.rerank(
      state.query,
      chunks,
      cfg.retrieval.rerankTopK,
    );

    logger.info(
      { reranker: reranker.name, output: reranked.length },
      `[${nodeName}] done`,
    );

    return {
      rerankedChunks: reranked,
      metadata: {
        ...state.metadata,
        rerankedCount: reranked.length,
        reranker: reranker.name,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new RetrievalError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
