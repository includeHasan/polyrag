/**
 * POST /api/search — pure retrieval, no generation. Useful for previews
 * and for tools that want the raw context without paying the LLM cost.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ChunkSchema,
  SourceSchema,
  type Chunk,
  type QueryUnderstanding,
  type Source,
} from "@/core/shared/types.js";
import { getObservability, getRetrieval } from "../deps.js";
import { RetrievalError } from "@/core/shared/errors.js";
import type { Retriever as RetrieverInterface } from "@/core/shared/interfaces.js";

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().max(100).optional(),
  filters: z.record(z.string(), z.any()).optional(),
});

const SearchResponseSchema = z.object({
  chunks: z.array(ChunkSchema),
  sources: z.array(SourceSchema),
});

type SearchRequest = z.infer<typeof SearchRequestSchema>;
interface SearchResponse {
  chunks: Chunk[];
  sources: Source[];
}

/**
 * Project a list of retrieved chunks into citation `Source` records.
 * Mirrors the projection used by `ContextBuilder.toSource` so the API
 * surface stays consistent between `/api/search` and `/api/query`.
 */
function chunksToSources(chunks: Chunk[]): Source[] {
  return chunks.map((c) => {
    const meta = c.metadata as Record<string, unknown> | undefined;
    const fromMeta = meta?.title;
    const title =
      typeof fromMeta === "string" && fromMeta.length > 0
        ? fromMeta
        : c.section ?? c.documentId;
    const snippet =
      c.text.length > 240 ? `${c.text.slice(0, 240).trim()}...` : c.text;
    return {
      documentId: c.documentId,
      title,
      page: c.page,
      chunkId: c.chunkId,
      snippet,
    };
  });
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/search",
    {
      schema: {
        tags: ["Query"],
        summary: "Raw retrieval (no generation)",
        description:
          "Pure retrieval with no generation. Useful for previews and for tools that want the raw context without paying the LLM cost. Requires authentication.",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
    const start = Date.now();
    const parsed = SearchRequestSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    const body: SearchRequest = parsed.data;

    let chunks: Chunk[];
    try {
      const { getRetriever } = await getRetrieval();
      // The dynamic-import wrapper in `../deps.js` returns a structurally
      // different `Retriever` shape, so cast to the real contract used by
      // `src/retrieval/*` (defined in `src/shared/interfaces.ts`).
      const retriever = (await getRetriever()) as unknown as RetrieverInterface;
      const understanding: QueryUnderstanding = {
        intent: "factual",
        entities: [],
        filters: body.filters ?? {},
        rewrittenQueries: [],
      };
      chunks = await retriever.retrieve(body.query, understanding, {
        topK: body.topK,
        filter: body.filters,
      });
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError("Search failed", err);
    }

    const response: SearchResponse = {
      chunks,
      sources: chunksToSources(chunks),
    };

    try {
      const obs = await getObservability();
      obs.incrCounter("searchesTotal");
      obs.recordLatency("search", Date.now() - start);
    } catch {
      // best-effort
    }
    return response;
  });
}

// Re-export schema for documentation/tests.
export { SearchResponseSchema };
