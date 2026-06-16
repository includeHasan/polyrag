/**
 * `retrieve` node — pull the top-K chunks relevant to the query.
 *
 * Uses the platform-wide `Retriever` returned by `getRetriever()`. The
 * helpers `sourcesFromChunks` derive a `Source[]` from raw chunks so the
 * rest of the graph (buildContext, evaluate, response) doesn't have to
 * do it again.
 *
 * Phase 5 — multi-tenant + ACL:
 *   - `tenantId` is pushed into the Qdrant payload filter at the
 *     vector-search level so the database itself enforces isolation.
 *   - After retrieval, `filterChunksForUser` is applied to enforce
 *     per-document ACLs for non-admin users.
 */
import { logger } from "@/core/shared/logger.js";
import { RetrievalError } from "@/core/shared/errors.js";
import type { Chunk, QueryUnderstanding, Source } from "@/core/shared/types.js";
import { getRetriever } from "@/rag/retrieval/factory.js";
import { resolveNodeConfig } from "./_config.js";
import type { ResolvedTenantConfig } from "@/platform/tenancy/resolve.js";
import { getVectorStore } from "@/infra/database/qdrant.js";
import { getEmbeddingProvider } from "@/rag/embeddings/factory.js";
import { VectorRetriever } from "@/rag/retrieval/vector.js";
import {
  filterChunksForUser,
  getAllowedDocumentIds,
} from "@/platform/security/documentPerms.js";
import { hasRole } from "@/platform/security/rbac.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    // ---- Phase 5: identity from state -----------------------------------
    const tenantId: string | null =
      (state.tenantId as string | undefined) ??
      (state.user?.tenantId as string | undefined) ??
      null;
    const userId: string | null =
      (state.userId as string | undefined) ??
      (state.user?.userId as string | undefined) ??
      (state.user?.sub as string | undefined) ??
      null;

    // Build a UserPayload-shaped object so the ACL helpers can read roles.
    const authUser = state.user ?? (userId ? { sub: userId, userId, roles: ["viewer"] } : null);

    logger.info(
      {
        query: state.query,
        intent: state.understanding.intent,
        tenantId,
        userId,
      },
      `[${nodeName}] start`,
    );

    const cfg = resolveNodeConfig(state);

    // ---- Phase 5: tenant-scoped vector search --------------------------
    // For tenant-scoped queries we call the vector store directly with a
    // Qdrant filter so the DB itself never returns cross-tenant chunks.
    // For unscoped queries (no tenantId on a non-admin user) we still
    // call the shared retriever for the convenience of hybrid mode.
    const retriever = getRetriever(cfg.retrieval);
    const topK = cfg.retrieval.topK;

    let chunks: Chunk[] = await runTenantScopedOrRetriever(
      retriever.name,
      state.query,
      state.understanding as QueryUnderstanding,
      topK,
      tenantId,
      cfg.retrieval,
    );

    // ---- Phase 5: per-document ACL (in addition to tenant filter) ------
    if (authUser && !hasRole(authUser, "admin")) {
      chunks = await filterChunksForUser(authUser, chunks);
    } else if (!authUser) {
      // Anonymous: deny by default.
      chunks = [];
    }

    const sources = sourcesFromChunks(chunks);

    logger.info(
      {
        topK,
        retrieved: chunks.length,
        sources: sources.length,
        tenantId,
        userId,
      },
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
        tenantId,
        userId,
        // Hint for downstream evaluators: was the user authorized to see
        // any of the candidate docs at all?
        allowedDocumentIdCount: authUser
          ? (await getAllowedDocumentIds(authUser))?.length ?? 0
          : 0,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a tenant-scoped Qdrant search when a `tenantId` is available,
 * otherwise delegate to the shared `Retriever` (which handles hybrid /
 * keyword modes).
 *
 * Tenant isolation is enforced by the Qdrant filter
 * `metadata.tenantId == <tenantId>` — chunks without a `tenantId`
 * payload field are excluded for tenant-scoped queries.
 */
async function runTenantScopedOrRetriever(
  retrieverName: string,
  query: string,
  understanding: QueryUnderstanding,
  topK: number,
  tenantId: string | null,
  retrieval: ResolvedTenantConfig["retrieval"],
): Promise<Chunk[]> {
  const tenantFilter = tenantId ? { "metadata.tenantId": tenantId } : undefined;

  // Direct Qdrant path is an optimisation for the plain vector retriever;
  // it lets the DB-level filter reject cross-tenant rows before scoring.
  if (tenantId && retrieverName === "vector") {
    try {
      const embeddings = getEmbeddingProvider();
      const vector = await embeddings.embed(query);
      const store = getVectorStore();
      const qdrantFilter = {
        must: [{ key: "metadata.tenantId", match: { value: tenantId } }],
      };
      const hits = await store.search(vector, topK, qdrantFilter);
      return hits.map((h) => h.chunk);
    } catch (cause) {
      logger.warn(
        { err: cause, tenantId },
        `[retrieve] tenant-scoped search failed; falling back to shared retriever`,
      );
    }
  }

  const retriever = getRetriever(retrieval);
  return retriever.retrieve(query, understanding, {
    topK,
    filter: tenantFilter,
  });
}

// Reference VectorRetriever to avoid unused-import warnings if the
// function above is ever inlined. The class is used elsewhere via
// `getRetriever()` so this is just a type anchor.
void VectorRetriever;
