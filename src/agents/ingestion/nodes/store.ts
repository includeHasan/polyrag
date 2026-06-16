/**
 * `store` node — persist embedded chunks to the vector store and mark
 * the job complete.
 */
import { logger } from "@/core/shared/logger.js";
import { IngestionError } from "@/core/shared/errors.js";
import { getVectorStore } from "@/infra/database/qdrant.js";
import type { IngestionState } from "../state.js";

export async function storeNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "store";
  try {
    if (state.chunks.length === 0) {
      logger.info(`[${nodeName}] no chunks to store — marking complete`);
      return {
        status: "completed",
        metadata: { ...state.metadata, stored: 0, node: nodeName },
      };
    }

    // Defensive: refuse to store chunks without embeddings.
    const missing = state.chunks.findIndex((c: any) => !c.embedding);
    if (missing !== -1) {
      throw new IngestionError(
        `[${nodeName}] chunk at index ${missing} is missing embedding — run 'embed' first`,
      );
    }

    logger.info(
      { chunkCount: state.chunks.length, collection: getVectorStore().name },
      `[${nodeName}] start`,
    );

    const store = getVectorStore();
    await store.upsert(state.chunks);

    logger.info(
      { stored: state.chunks.length },
      `[${nodeName}] done`,
    );

    return {
      status: "completed",
      metadata: {
        ...state.metadata,
        stored: state.chunks.length,
        store: store.name,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    return {
      status: "failed",
      error: (err as Error).message,
      metadata: { ...state.metadata, node: nodeName, failed: true },
    };
  }
}
