/**
 * Qdrant vector store implementing the platform's `VectorStore` contract.
 *
 * ── Why `qdrant-client` (`@qdrant/js-client-rest`) directly? ──────────────
 * The `@langchain/qdrant` package's `QdrantVectorStore` is tightly coupled to
 * `langchain`-style `Document` objects and `EmbeddingsInterface`, and it does
 * not expose a way to declare a payload schema at collection creation time.
 *
 * Our platform has its own `Chunk` schema (`src/shared/types.ts`) and we want
 * to:
 *   • Create collections with an explicit vector dimension
 *   • Filter on payload fields (`documentId`, `section`, `metadata.*`)
 *   • Delete by payload filter
 *   • Return hits as `VectorSearchHit[]` with our `Chunk` shape
 *
 * The official REST client (`@qdrant/js-client-rest`) is small, fully typed,
 * and gives us exactly that control. So we use it directly.
 *
 * The store is lazy — a single `QdrantClient` is created on first
 * instantiation. `getVectorStore()` returns a process-wide singleton
 * configured against `env.QDRANT_COLLECTION`.
 */
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "@/core/config/env.js";
import { logger } from "@/core/shared/logger.js";
import { RagError } from "@/core/shared/errors.js";
import type { Chunk } from "@/core/shared/types.js";
import type { VectorSearchHit, VectorStore } from "@/core/shared/interfaces.js";
import { assertTenantFilter } from "@/platform/tenancy/guard.js";

/** Shape we write into Qdrant payload. */
interface ChunkPayload {
  chunkId: string;
  documentId: string;
  section?: string;
  page?: number;
  text: string;
  metadata: Record<string, unknown>;
  tenantId?: string;
  embeddingModel?: string;
  embeddingDim?: number;
}

let sharedClient: QdrantClient | undefined;
let sharedStore: QdrantVectorStore | undefined;

/**
 * Lazy shared QdrantClient. Use this when you need raw access.
 */
export function getQdrantClient(): QdrantClient {
  if (sharedClient) return sharedClient;
  sharedClient = new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
  });
  logger.info({ url: env.QDRANT_URL }, "Qdrant client created");
  return sharedClient;
}

/**
 * Concrete `VectorStore` implementation backed by Qdrant.
 */
export class QdrantVectorStore implements VectorStore {
  readonly name: string;

  private readonly client: QdrantClient;

  constructor(name: string = env.QDRANT_COLLECTION, client?: QdrantClient) {
    this.name = name;
    this.client = client ?? getQdrantClient();
  }

  /**
   * Idempotently create the collection with the given vector `dimension`.
   * If the collection already exists, this is a no-op.
   */
  async ensureCollection(name: string = this.name, dimension: number): Promise<void> {
    try {
      const exists = await this.client.collectionExists(name);
      if (exists.exists) {
        logger.debug({ collection: name }, "Qdrant collection already exists");
        return;
      }
      await this.client.createCollection(name, {
        vectors: { size: dimension, distance: "Cosine" },
      });
      logger.info({ collection: name, dimension }, "Qdrant collection created");
    } catch (cause) {
      throw new RagError(
        "QDRANT_ENSURE_COLLECTION_ERROR",
        `ensureCollection failed for ${name}: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
  }

  /**
   * Upsert chunks (which must already have `.embedding` set). Chunks without
   * an embedding are skipped with a warning.
   */
  async upsert(chunks: Chunk[]): Promise<void> {
    const points = chunks
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
      .map((c) => this.toPoint(c));

    if (points.length === 0) {
      logger.warn("upsert called with no embeddable chunks");
      return;
    }

    try {
      await this.client.upsert(this.name, { points, wait: true });
      logger.debug({ collection: this.name, count: points.length }, "Qdrant upsert ok");
    } catch (cause) {
      throw new RagError(
        "QDRANT_UPSERT_ERROR",
        `upsert failed for ${this.name}: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
  }

  /**
   * Cosine-similarity search. `filter` is a Qdrant filter object, e.g.
   * `{ must: [{ key: "documentId", match: { value: "abc" } }] }`.
   */
  async search(
    vector: number[],
    k: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchHit[]> {
    const tenantId = (filter as any)?.must?.[0]?.match?.value ?? null;
    assertTenantFilter(tenantId);
    try {
      const res = await this.client.search(this.name, {
        vector,
        limit: k,
        filter: filter as never,
        with_payload: true,
        with_vector: false,
      });
      return res.map((hit) => ({
        score: hit.score ?? 0,
        chunk: this.fromPayload(hit.id, hit.payload as Record<string, unknown>),
      }));
    } catch (cause) {
      throw new RagError(
        "QDRANT_SEARCH_ERROR",
        `search failed for ${this.name}: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
  }

  /**
   * Delete every point whose payload `documentId` matches.
   */
  async deleteByDocument(documentId: string): Promise<void> {
    try {
      await this.client.delete(this.name, {
        filter: {
          must: [{ key: "documentId", match: { value: documentId } }],
        },
        wait: true,
      });
      logger.debug({ collection: this.name, documentId }, "Qdrant deleteByDocument ok");
    } catch (cause) {
      throw new RagError(
        "QDRANT_DELETE_BY_DOC_ERROR",
        `deleteByDocument failed for ${documentId}: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private toPoint(chunk: Chunk) {
    const payload: ChunkPayload = {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      section: chunk.section,
      page: chunk.page,
      text: chunk.text,
      metadata: (chunk.metadata ?? {}) as Record<string, unknown>,
      tenantId: chunk.metadata.tenantId as string | undefined,
      embeddingModel: chunk.metadata.embeddingModel as string | undefined,
      embeddingDim: chunk.metadata.embeddingModel ? chunk.embedding?.length : undefined,
    };
    return {
      id: chunk.chunkId,
      vector: chunk.embedding as number[],
      payload: payload as unknown as Record<string, unknown>,
    };
  }

  private fromPayload(id: string | number, payload: Record<string, unknown> | undefined): Chunk {
    const p = (payload ?? {}) as Partial<ChunkPayload>;
    return {
      chunkId: (p.chunkId ?? String(id)) as string,
      documentId: (p.documentId ?? "") as string,
      text: (p.text ?? "") as string,
      section: p.section,
      page: p.page,
      metadata: {
        tags: [],
        ...((p.metadata as Record<string, unknown> | undefined) ?? {}),
      },
    };
  }
}

/**
 * Factory: lazy singleton, configured against `env.QDRANT_COLLECTION`.
 */
export function getVectorStore(): QdrantVectorStore {
  if (sharedStore) return sharedStore;
  sharedStore = new QdrantVectorStore();
  return sharedStore;
}

/**
 * Convenience factory for a one-off collection name.
 */
export function getVectorStoreFor(collection: string): QdrantVectorStore {
  return new QdrantVectorStore(collection);
}
