/**
 * Ingestion pipeline — the orchestrator. Glues the connectors, processing,
 * chunking, embedding, and storage layers together for a single
 * `IngestRequest`.
 *
 *   runIngestion(request)
 *     -> connect -> load (Documents)
 *     -> clean text
 *     -> parse sections
 *     -> extract metadata
 *     -> chunk
 *     -> embed
 *     -> upsert to Qdrant
 *
 * Returns an `IngestionResult` (see `src/api/declarations.d.ts` for the API
 * contract) and logs each stage. The shape returned to the API caller is:
 *   { jobId, documentId, chunkCount, document, chunks, sources }.
 */
import { v4 as uuidv4 } from "uuid";
// The vector store factory lives in `src/database/qdrant.ts`. It is provided
// by the storage layer (task #4) and exposed via the path alias.
import { getVectorStore } from "@/database/qdrant.js";
import { chunkingConfig } from "../config/index.js";
import { getChunker } from "../chunking/factory.js";
import { getEmbeddingProvider } from "../embeddings/factory.js";
import { cleanText } from "../processing/clean.js";
import { extractMetadata } from "../processing/metadata.js";
import { parseSections, type ParsedSection } from "../processing/parse.js";
import { IngestionError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { Chunk, Document, IngestRequest, Source } from "../shared/types.js";
import { getConnector } from "./connectors/registry.js";

export interface IngestionResult {
  /** Internal job id (also propagated to the BullMQ job). */
  jobId: string;
  /** Stable id of the document that was ingested. */
  documentId: string;
  /** Number of chunks the document was split into. */
  chunkCount: number;
  /** The fully-processed document, post-clean and post-metadata-merge. */
  document: Document;
  /** Chunks produced for this document (embeddings included). */
  chunks: Chunk[];
  /** Empty for now — sources are produced at query time, not ingest time. */
  sources: Source[];
}

export async function runIngestion(request: IngestRequest): Promise<IngestionResult> {
  const jobId = uuidv4();
  const log = logger.child({ jobId, source: request.source });
  log.info({ request }, "ingestion started");

  // 1. Connect & load.
  const connector = getConnector(request);
  let documents: Document[];
  try {
    await connector.connect();
    documents = await connector.load();
    await connector.disconnect?.();
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    throw new IngestionError(
      `connector ${request.source} failed: ${(err as Error).message}`,
      err,
    );
  }
  if (documents.length === 0) {
    throw new IngestionError(`connector ${request.source} returned no documents`);
  }
  const doc = documents[0];
  const documentId = doc.id || uuidv4();
  doc.id = documentId;
  log.info({ documentId, chars: doc.content.length }, "document loaded");

  // 2. Clean.
  const cleaned = cleanText(doc.content);
  doc.content = cleaned;
  log.info({ chars: cleaned.length }, "document cleaned");

  // 3. Parse sections (best-effort; some formats collapse to one section).
  const format = String(doc.metadata.format ?? request.source).toLowerCase();
  const sections = parseSections(cleaned, format);
  log.info({ sections: sections.length }, "document parsed");

  // 4. Merge IngestRequest hint into doc.metadata so the chunker can pick it
  //    up via `extractMetadata(doc, doc.metadata.metadataHint)`. This is the
  //    cleanest way to pass hint data through the `Chunker.split(doc)` seam.
  doc.metadata = {
    ...(doc.metadata ?? {}),
    metadataHint: {
      author: undefined,
      date: undefined,
      department: request.department,
      tags: request.tags,
      ...(request.metadata ?? {}),
    },
  };

  // 5. Chunk.
  const chunker = getChunker();
  let chunks: Chunk[];
  try {
    chunks = await chunker.split(doc);
  } catch (err) {
    throw new IngestionError(
      `chunking failed for ${documentId}: ${(err as Error).message}`,
      err,
    );
  }
  if (chunks.length === 0) {
    log.warn({ documentId }, "no chunks produced; nothing to embed/upsert");
    return {
      jobId,
      documentId,
      chunkCount: 0,
      document: doc,
      chunks: [],
      sources: [],
    };
  }

  // Stamp parsed sections onto chunks. If we know the section ordering, assign
  // sections by cumulative character offsets.
  if (sections.length > 1) {
    assignSections(chunks, sections);
  }

  // Refresh per-chunk metadata so every chunk carries the same baseline.
  // We rebuild the metadata block from `extractMetadata` to avoid losing
  // chunk-specific fields the chunker may have stamped.
  const baseMetadata = extractMetadata(doc, (doc.metadata.metadataHint ?? {}) as Record<string, unknown>);
  for (const c of chunks) {
    c.metadata = {
      ...baseMetadata,
      ...(c.metadata ?? {}),
      tags: [...(c.metadata?.tags ?? baseMetadata.tags ?? [])],
    };
  }
  log.info(
    { chunkCount: chunks.length, strategy: chunker.strategy },
    "document chunked",
  );

  // 6. Embed.
  const embeddings = getEmbeddingProvider();
  let vectors: number[][];
  try {
    vectors = await embeddings.embedBatch(chunks.map((c) => c.text));
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    throw new IngestionError(
      `embedding failed for ${chunks.length} chunks: ${(err as Error).message}`,
      err,
    );
  }
  if (vectors.length !== chunks.length) {
    throw new IngestionError(
      `embedding count mismatch: ${chunks.length} chunks vs ${vectors.length} vectors`,
    );
  }
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].embedding = vectors[i];
  }
  log.info({ chunkCount: chunks.length }, "document embedded");

  // 7. Ensure collection & upsert.
  const store = getVectorStore();
  try {
    await store.ensureCollection(store.name, embeddings.dimension);
    await store.upsert(chunks);
  } catch (err) {
    throw new IngestionError(
      `vector store upsert failed for ${documentId}: ${(err as Error).message}`,
      err,
    );
  }

  // 7b. Phase 2: populate the in-process BM25 keyword index so the hybrid
  // retriever has a keyword leg to fuse with the vector leg.
  try {
    const { getBM25Index } = await import("@/retrieval/bm25Index.js");
    const bm25 = getBM25Index();
    bm25.upsertBatch(chunks);
    bm25.save();
    log.info(
      { indexSize: bm25.size() },
      "BM25 keyword index updated",
    );
  } catch (err) {
    // Non-fatal: ingestion is still considered successful if only BM25 fails.
    log.warn(
      { err },
      "BM25 index update failed; keyword search will be empty until next successful ingest",
    );
  }

  // 7c. Phase 4: extract entities/relations and populate the knowledge graph.
  //      Best-effort: any LLM or DB error is logged and swallowed so a
  //      failing KG pass never blocks ingestion.
  try {
    const { extractAndStoreEntities } = await import("./kgExtractor.js");
    const tenantId = (doc.metadata?.tenantId as string | undefined) ?? null;
    await extractAndStoreEntities(documentId, tenantId, chunks);
  } catch (err) {
    log.warn(
      { err },
      "KG extraction step failed; KG retrieval will be empty for this document",
    );
  }
  log.info(
    {
      documentId,
      chunkCount: chunks.length,
      collection: store.name,
      strategy: chunkingConfig.strategy,
    },
    "ingestion completed",
  );

  return {
    jobId,
    documentId,
    chunkCount: chunks.length,
    document: doc,
    chunks,
    sources: [],
  };
}

/**
 * Stamp `section` (and `page`, when known) on each chunk based on which
 * section's body the chunk's text overlaps with. This is a simple linear
 * assignment; good enough for our purposes and never re-parses the document.
 */
function assignSections(chunks: Chunk[], sections: ParsedSection[]): void {
  for (const chunk of chunks) {
    for (const s of sections) {
      if (!s.heading) continue;
      if (chunk.text.includes(s.heading)) {
        chunk.section = s.heading;
        if (s.page !== undefined) chunk.page = s.page;
        break;
      }
    }
  }
}
