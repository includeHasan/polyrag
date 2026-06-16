/**
 * Abstract `BaseChunker` that implements the shared `Chunker` contract.
 *
 * Subclasses only have to override `splitText(text): Promise<string[]>` —
 * the base class handles:
 *   - chunk-id generation (`<documentId>:<index>`),
 *   - metadata extraction (delegates to `processing/metadata.ts`),
 *   - section & page propagation from a parsed `Document`,
 *   - strategy tagging.
 *
 * The caller is expected to have merged any `IngestRequest` hint fields into
 * `doc.metadata` before calling `split()` (see `ingestion/pipeline.ts`). The
 * base chunker reads them back from there.
 *
 * Subclasses set `chunkSize` and `chunkOverlap` for downstream logging.
 */
import { v4 as uuidv4 } from "uuid";
import { extractMetadata } from "@/rag/processing/metadata.js";
import type { Chunker } from "@/core/shared/interfaces.js";
import { logger } from "@/core/shared/logger.js";
import type { Chunk, Document } from "@/core/shared/types.js";

export interface BaseChunkerOptions {
  chunkSize: number;
  chunkOverlap: number;
  strategy: Chunker["strategy"];
}

export abstract class BaseChunker implements Chunker {
  readonly strategy: Chunker["strategy"];
  protected readonly chunkSize: number;
  protected readonly chunkOverlap: number;

  constructor(opts: BaseChunkerOptions) {
    this.strategy = opts.strategy;
    this.chunkSize = opts.chunkSize;
    this.chunkOverlap = opts.chunkOverlap;
  }

  /** Subclass hook: split raw text into chunk-sized strings. */
  protected abstract splitText(text: string): Promise<string[]>;

  async split(doc: Document): Promise<Chunk[]> {
    if (!doc.content || !doc.content.trim()) {
      logger.warn({ documentId: doc.id }, "skip chunking: empty document");
      return [];
    }
    // The pipeline merges any IngestRequest hint into doc.metadata.metadataHint
    // before calling us, so the metadata extractor can pick it up.
    const metaHint = (doc.metadata?.metadataHint ?? {}) as Record<string, unknown>;
    const baseMetadata = extractMetadata(doc, metaHint);

    const rawChunks = await this.splitText(doc.content);
    const total = rawChunks.length;
    if (total === 0) return [];

    const documentId = doc.id || uuidv4();
    const chunks: Chunk[] = rawChunks.map((text, i) => ({
      chunkId: uuidv4(), // Qdrant 1.12 requires UUIDs or unsigned integers for point IDs.
      documentId,
      section: undefined,
      text: text.trim(),
      metadata: {
        ...baseMetadata,
        tags: [...(baseMetadata.tags ?? [])],
      },
    }));

    logger.debug(
      {
        documentId,
        total,
        strategy: this.strategy,
        size: this.chunkSize,
        overlap: this.chunkOverlap,
      },
      "chunked document",
    );
    return chunks;
  }
}
