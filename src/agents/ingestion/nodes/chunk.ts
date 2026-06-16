/**
 * `chunk` node — split the processed text into `Chunk[]`.
 *
 * Uses the platform-wide `Chunker` factory, which selects the strategy
 * declared in `env.CHUNKER_STRATEGY` (fixed / recursive / semantic / agentic).
 */
import { logger } from "@/core/shared/logger.js";
import { IngestionError } from "@/core/shared/errors.js";
import { getChunker } from "@/rag/chunking/factory.js";
import type { Chunk, Document } from "@/core/shared/types.js";
import type { IngestionState } from "../state.js";

export async function chunkNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "chunk";
  try {
    if (!state.processedContent) {
      throw new IngestionError(`[${nodeName}] processedContent is empty — run 'process' first`);
    }
    if (!state.documentId) {
      throw new IngestionError(`[${nodeName}] documentId is missing`);
    }

    logger.info(
      { documentId: state.documentId, chars: state.processedContent.length },
      `[${nodeName}] start`,
    );

    const doc: Document = {
      id: state.documentId,
      source: state.request.source,
      uri: state.request.path ?? state.request.url,
      title: state.title ?? state.documentId,
      content: state.processedContent,
      metadata: { ...state.metadata, sections: state.sections },
    };

    const chunker = getChunker();
    const chunks: Chunk[] = await chunker.split(doc);

    logger.info(
      { chunker: chunker.strategy, chunkCount: chunks.length },
      `[${nodeName}] done`,
    );

    return {
      chunks,
      metadata: {
        ...state.metadata,
        chunkCount: chunks.length,
        chunker: chunker.strategy,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new IngestionError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
