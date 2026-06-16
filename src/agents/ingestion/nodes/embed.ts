/**
 * `embed` node — fill in the `embedding` field on every chunk.
 *
 * Uses the cached `EmbeddingProvider` and processes in one batched call.
 * We mutate a copy of each chunk so the `ChunkSchema.embedding` field
 * is populated before they reach the store.
 */
import { logger } from "@/core/shared/logger.js";
import { IngestionError } from "@/core/shared/errors.js";
import { getEmbeddingProvider } from "@/rag/embeddings/factory.js";
import type { Chunk } from "@/core/shared/types.js";
import type { IngestionState } from "../state.js";

export async function embedNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "embed";
  try {
    if (state.chunks.length === 0) {
      logger.info(`[${nodeName}] no chunks to embed — passthrough`);
      return {
        metadata: { ...state.metadata, embedded: 0, node: nodeName },
      };
    }

    logger.info(
      { chunkCount: state.chunks.length },
      `[${nodeName}] start`,
    );

    const provider = getEmbeddingProvider();
    const texts = state.chunks.map((c: any) => c.text);
    const vectors = await provider.embedBatch(texts);

    if (vectors.length !== state.chunks.length) {
      throw new IngestionError(
        `[${nodeName}] embedding count mismatch: got ${vectors.length}, expected ${state.chunks.length}`,
      );
    }

    const embedded: Chunk[] = state.chunks.map((c: any, i: number) => ({
      ...c,
      embedding: vectors[i],
    }));

    logger.info(
      { model: provider.model, dimension: provider.dimension, count: embedded.length },
      `[${nodeName}] done`,
    );

    return {
      chunks: embedded,
      metadata: {
        ...state.metadata,
        embedded: embedded.length,
        embeddingModel: provider.model,
        embeddingDim: provider.dimension,
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
