/**
 * KnowledgeGraphRetriever — Phase 4 retriever that answers queries by
 * traversing the entity/relation graph stored in Postgres.
 *
 * Strategy (read side):
 *   1. Tokenize the (rewritten) query and look up entity names that match.
 *   2. Rank candidate entities by mention count and pick the top N.
 *   3. Find every chunk that mentions those entities, score the chunks by
 *      the number of distinct matched entities (and a small boost for the
 *      number of total mentions), and return the top-K chunks.
 *
 * Graceful degradation:
 *   - If the knowledge graph is empty (no entities indexed), this retriever
 *     returns []. Callers can compose it as an opt-in leg next to the
 *     vector/keyword retrievers.
 *   - Any database error is logged and surfaced as a `RetrievalError`.
 *
 * Writes to the KG happen in `src/ingestion/kgExtractor.ts`. This module
 * owns a process-wide `PrismaClient` singleton (re-exported as
 * `getPrismaClient`) so the extractor and the retriever share one pool.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { logger } from "@/core/shared/logger.js";
import { RetrievalError } from "@/core/shared/errors.js";
import type { Chunk, QueryUnderstanding } from "@/core/shared/types.js";
import { BaseRetriever, type RetrieveOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Prisma client singleton
// ---------------------------------------------------------------------------
let prismaSingleton: PrismaClient | undefined;

/**
 * Lazily build (or return) the process-wide `PrismaClient`. We instantiate
 * a single client so the Prisma engine reuses its connection pool.
 */
export function getPrismaClient(): PrismaClient {
  if (prismaSingleton) return prismaSingleton;
  prismaSingleton = new PrismaClient({
    log: [{ level: "error", emit: "event" }],
  });
  // Avoid unhandled-error crashes if the engine emits an async event.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prismaSingleton as any).$on?.("error", (e: unknown) => {
    logger.error({ err: e }, "Prisma client error event");
  });
  return prismaSingleton;
}

/** Test helper: drop the cached client. */
export function resetPrismaClient(): void {
  if (!prismaSingleton) return;
  void prismaSingleton.$disconnect().catch(() => undefined);
  prismaSingleton = undefined;
}

// ---------------------------------------------------------------------------
// Retriever
// ---------------------------------------------------------------------------
const DEFAULT_TOP_N_ENTITIES = 10;
const DEFAULT_TOP_K_CHUNKS = 10;
const MIN_TOKEN_LENGTH = 2;

export class KnowledgeGraphRetriever extends BaseRetriever {
  readonly name = "knowledge_graph";

  private readonly topNEntities: number;
  private readonly topKChunks: number;

  constructor(opts?: { topNEntities?: number; topKChunks?: number }) {
    super();
    this.topNEntities = opts?.topNEntities ?? DEFAULT_TOP_N_ENTITIES;
    this.topKChunks = opts?.topKChunks ?? DEFAULT_TOP_K_CHUNKS;
  }

  async retrieve(
    query: string,
    understanding: QueryUnderstanding,
    options?: RetrieveOptions,
  ): Promise<Chunk[]> {
    const topK = options?.topK ?? this.topKChunks;
    const tokens = this.tokenize(query, understanding);

    if (tokens.length === 0) {
      logger.debug(
        { retriever: this.name, queryLen: query.length },
        "KnowledgeGraphRetriever: no usable tokens, returning []",
      );
      return [];
    }

    try {
      const prisma = getPrismaClient();

      // 1. Find candidate entities whose name matches any query token.
      //    We use a single OR-of-contains query to keep this O(1) round-trips.
      const nameFilters: Prisma.EntityWhereInput[] = tokens.map((t) => ({
        name: { contains: t, mode: "insensitive" as const },
      }));
      const tenantId =
        (options?.filter?.tenantId as string | undefined) ?? undefined;
      const where: Prisma.EntityWhereInput = {
        OR: nameFilters,
        ...(tenantId ? { tenantId } : {}),
      };

      const candidateEntities = await prisma.entity.findMany({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          tenantId: true,
        },
      });

      if (candidateEntities.length === 0) {
        logger.debug(
          {
            retriever: this.name,
            tokens: tokens.length,
          },
          "KnowledgeGraphRetriever: no matching entities, returning []",
        );
        return [];
      }

      // 2. Rank candidate entities by total mention count, keep the top N.
      const mentionCounts = await prisma.entityMention.groupBy({
        by: ["entityId"],
        where: { entityId: { in: candidateEntities.map((e) => e.id) } },
        _count: { _all: true },
      });
      const countByEntity = new Map<string, number>();
      for (const row of mentionCounts) {
        countByEntity.set(row.entityId, row._count._all);
      }
      const rankedEntities = candidateEntities
        .map((e) => ({ ...e, mentions: countByEntity.get(e.id) ?? 0 }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, this.topNEntities);

      // 3. Find chunks that mention these entities.
      const mentions = await prisma.entityMention.findMany({
        where: { entityId: { in: rankedEntities.map((e) => e.id) } },
        select: {
          chunkId: true,
          entityId: true,
          position: true,
          context: true,
        },
      });

      if (mentions.length === 0) {
        return [];
      }

      // 4. Score chunks: distinct entities matched (primary) + total mention
      //    count (secondary). Chunks referenced multiple times by different
      //    matched entities rank highest.
      const chunkScores = new Map<
        string,
        { score: number; matchedEntityIds: Set<string> }
      >();
      for (const m of mentions) {
        const prev = chunkScores.get(m.chunkId) ?? {
          score: 0,
          matchedEntityIds: new Set<string>(),
        };
        if (!prev.matchedEntityIds.has(m.entityId)) {
          prev.matchedEntityIds.add(m.entityId);
          prev.score += 2; // bonus for a NEW distinct entity match
        }
        prev.score += 1; // base weight per mention
        chunkScores.set(m.chunkId, prev);
      }

      const rankedChunks = Array.from(chunkScores.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, topK);

      // 5. Hydrate the actual Chunk payloads. We do this from the in-process
      //    BM25 index first (it's the chunk store of record) and fall back
      //    to the entity_mentions `context` snippet if a chunk is missing.
      const chunks: Chunk[] = [];
      try {
        const { getBM25Index } = await import("./bm25Index.js");
        const bm25 = getBM25Index();
        const contextByChunk = new Map<string, string>();
        for (const m of mentions) {
          if (m.context && !contextByChunk.has(m.chunkId)) {
            contextByChunk.set(m.chunkId, m.context);
          }
        }
        for (const [chunkId, info] of rankedChunks) {
          const stored = bm25.getChunk(chunkId);
          if (stored) {
            chunks.push(stored);
          } else {
            chunks.push(this.synthesizeChunkFromMention(chunkId, contextByChunk, info.matchedEntityIds.size));
          }
        }
      } catch (err) {
        // BM25 index not available — synthesize minimal chunks from the
        // mention context we already have in memory.
        logger.warn(
          { err: (err as Error).message },
          "KnowledgeGraphRetriever: BM25 index unavailable, using mention contexts",
        );
        const contextByChunk = new Map<string, string>();
        for (const m of mentions) {
          if (m.context && !contextByChunk.has(m.chunkId)) {
            contextByChunk.set(m.chunkId, m.context);
          }
        }
        for (const [chunkId, info] of rankedChunks) {
          chunks.push(this.synthesizeChunkFromMention(chunkId, contextByChunk, info.matchedEntityIds.size));
        }
      }

      logger.debug(
        {
          retriever: this.name,
          tokens: tokens.length,
          matchedEntities: rankedEntities.length,
          chunks: chunks.length,
        },
        "KnowledgeGraphRetriever complete",
      );

      return chunks;
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `KnowledgeGraphRetriever failed: ${(err as Error).message}`,
        err,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private tokenize(
    query: string,
    understanding: QueryUnderstanding,
  ): string[] {
    const source = [query, ...(understanding.rewrittenQueries ?? []), ...(understanding.entities ?? [])]
      .join(" ")
      .toLowerCase();
    const raw = source.split(/[^a-z0-9]+/g).filter((t) => t.length >= MIN_TOKEN_LENGTH);
    // Dedupe + cap to a reasonable size to avoid pathologically large queries.
    return Array.from(new Set(raw)).slice(0, 16);
  }

  private synthesizeChunkFromMention(
    chunkId: string,
    contextByChunk: Map<string, string>,
    matchedEntityCount: number,
  ): Chunk {
    const context = contextByChunk.get(chunkId) ?? "";
    return {
      chunkId,
      documentId: "",
      text: context,
      metadata: {
        tags: ["kg-retrieved", `kg-entities:${matchedEntityCount}`],
      },
    };
  }
}
