/**
 * Elasticsearch client (keyword / BM25 retriever store).
 *
 * Used in Phase 2 by the keyword retriever. The index layout is:
 *   - `chunkId`      : keyword   (id)
 *   - `documentId`   : keyword
 *   - `text`         : text      (analyzed)
 *   - `section`      : keyword
 *   - `page`         : integer
 *   - `metadata.*`   : object (dynamic, keyword fields)
 *
 * The client is lazy — first call to `getEsClient()` instantiates it.
 */
import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { RagError } from "../shared/errors.js";
import type { Chunk } from "../shared/types.js";

let client: Client | undefined;

export function getEsClient(): Client {
  if (client) return client;

  const auth =
    env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
      ? { username: env.ELASTICSEARCH_USERNAME, password: env.ELASTICSEARCH_PASSWORD }
      : undefined;

  client = new Client({
    node: env.ELASTICSEARCH_URL,
    auth,
  });

  logger.info({ node: env.ELASTICSEARCH_URL }, "Elasticsearch client created");
  return client;
}

/**
 * Create the index with a sensible mapping if it does not exist. Idempotent.
 */
export async function ensureIndex(index: string = env.ELASTICSEARCH_INDEX): Promise<void> {
  const es = getEsClient();
  try {
    const exists = await es.indices.exists({ index });
    if (exists) {
      logger.debug({ index }, "Elasticsearch index exists");
      return;
    }
    await es.indices.create({
      index,
      mappings: {
        properties: {
          chunkId: { type: "keyword" },
          documentId: { type: "keyword" },
          text: { type: "text", analyzer: "standard" },
          section: { type: "keyword" },
          page: { type: "integer" },
          metadata: { type: "object", dynamic: true },
        },
      },
    });
    logger.info({ index }, "Elasticsearch index created");
  } catch (cause) {
    throw new RagError(
      "ELASTICSEARCH_INDEX_ERROR",
      `ensureIndex failed for ${index}: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Bulk-index chunks. Each chunk is indexed under its `chunkId` so subsequent
 * `indexChunks` calls are upserts.
 */
export async function indexChunks(
  chunks: Chunk[],
  index: string = env.ELASTICSEARCH_INDEX,
): Promise<void> {
  if (chunks.length === 0) return;
  const es = getEsClient();
  try {
    const operations: Array<Record<string, unknown>> = [];
    for (const chunk of chunks) {
      operations.push({ index: { _index: index, _id: chunk.chunkId } });
      operations.push({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        text: chunk.text,
        section: chunk.section ?? null,
        page: chunk.page ?? null,
        metadata: chunk.metadata ?? {},
      });
    }
    const resp = await es.bulk({ operations, refresh: false });
    if (resp.errors) {
      const firstErr = resp.items.find((it) => it.index?.error)?.index?.error;
      throw new Error(`bulk had item errors: ${JSON.stringify(firstErr)}`);
    }
    logger.debug({ count: chunks.length, index }, "Elasticsearch bulk index ok");
  } catch (cause) {
    throw new RagError(
      "ELASTICSEARCH_INDEX_CHUNKS_ERROR",
      `indexChunks failed: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Delete every chunk that belongs to a document. Used when the source
 * document is re-ingested or removed.
 */
export async function deleteByDocument(
  documentId: string,
  index: string = env.ELASTICSEARCH_INDEX,
): Promise<void> {
  try {
    await getEsClient().deleteByQuery({
      index,
      query: { term: { documentId } },
      refresh: true,
    });
    logger.debug({ documentId, index }, "Elasticsearch deleteByDocument ok");
  } catch (cause) {
    throw new RagError(
      "ELASTICSEARCH_DELETE_BY_DOC_ERROR",
      `deleteByDocument failed for ${documentId}: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Run a BM25 keyword search. Returns the top-k chunks with their scores.
 * `filter` is an optional Elasticsearch DSL filter clause (e.g. `{ term: { documentId } }`).
 */
export interface KeywordSearchHit {
  chunk: Chunk;
  score: number;
}

export async function keywordSearch(
  query: string,
  k: number,
  filter?: Record<string, unknown>,
  index: string = env.ELASTICSEARCH_INDEX,
): Promise<KeywordSearchHit[]> {
  try {
    const resp = await getEsClient().search({
      index,
      size: k,
      query: {
        bool: {
          must: [{ match: { text: query } }],
          filter: filter ? [filter] : [],
        },
      },
    });
    return resp.hits.hits.map((hit) => {
      const src = hit._source as {
        chunkId: string;
        documentId: string;
        text: string;
        section?: string | null;
        page?: number | null;
        metadata?: Record<string, unknown>;
      };
      const chunk: Chunk = {
        chunkId: src.chunkId,
        documentId: src.documentId,
        text: src.text,
        section: src.section ?? undefined,
        page: src.page ?? undefined,
        metadata: {
          tags: [],
          ...(src.metadata ?? {}),
        },
      };
      return { chunk, score: hit._score ?? 0 };
    });
  } catch (cause) {
    throw new RagError(
      "ELASTICSEARCH_SEARCH_ERROR",
      `keywordSearch failed: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}
