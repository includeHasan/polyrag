/**
 * `retrieve` node — pull the top-K chunks relevant to the query.
 *
 * Uses the platform-wide `Retriever` returned by `getRetriever()`. The
 * helpers `sourcesFromChunks` derive a `Source[]` from raw chunks so the
 * rest of the graph (buildContext, evaluate, response) doesn't have to
 * do it again.
 */
import { logger } from "../../../shared/logger.js";
import { RetrievalError } from "../../../shared/errors.js";
import type { Chunk, Source } from "../../../shared/types.js";
import { retrievalConfig } from "../../../config/index.js";
import { getRetriever } from "../../../retrieval/factory.js";
import type { QueryState } from "../state.js";

/**
 * Build a `Source` citation record from a chunk. We carry the chunk id
 * and a short snippet so the citation is self-contained.
 */
export function sourcesFromChunks(chunks: Chunk[]): Source[] {
  return chunks.map((c) => ({
    documentId: c.documentId,
    title: c.section ?? c.metadata?.source ?? c.documentId,
    page: c.page,
    chunkId: c.chunkId,
    snippet: c.text.slice(0, 280),
  }));
}

export async function retrieveNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "retrieve";
  try {
    if (!state.understanding) {
      throw new RetrievalError(
        `[${nodeName}] state.understanding is missing — run 'understand' first`,
      );
    }
    if (!state.query) {
      throw new RetrievalError(`[${nodeName}] state.query is empty`);
    }

    logger.info(
      { query: state.query, intent: state.understanding.intent },
      `[${nodeName}] start`,
    );

    const retriever = getRetriever();
    const topK = retrievalConfig.topK;
    const chunks = await retriever.retrieve(
      state.query,
      state.understanding,
      { topK },
    );

    const sources = sourcesFromChunks(chunks);

    logger.info(
      { topK, retrieved: chunks.length, sources: sources.length },
      `[${nodeName}] done`,
    );

    return {
      retrievedChunks: chunks,
      sources,
      metadata: {
        ...state.metadata,
        retrievedCount: chunks.length,
        retriever: retriever.name,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    if (err instanceof RetrievalError) throw err;
    throw new RetrievalError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
