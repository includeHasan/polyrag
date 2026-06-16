/**
 * POST /api/search — pure retrieval, no generation. Useful for previews
 * and for tools that want the raw context without paying the LLM cost.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChunkSchema, type Chunk, type Source } from "@/shared/types.js";
import { getObservability, getRetrieval } from "../deps.js";
import { RetrievalError } from "@/shared/errors.js";

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().max(100).optional(),
  filters: z.record(z.string(), z.any()).optional(),
});

const SearchResponseSchema = z.object({
  chunks: z.array(ChunkSchema),
  sources: z.array(z.unknown()),
});

type SearchRequest = z.infer<typeof SearchRequestSchema>;
interface SearchResponse {
  chunks: Chunk[];
  sources: Source[];
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/search", async (request) => {
    const start = Date.now();
    const parsed = SearchRequestSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;
    const body: SearchRequest = parsed.data;

    let result;
    try {
      const { getRetriever } = await getRetrieval();
      const retriever = await getRetriever();
      result = await retriever.retrieve(body.query, {
        topK: body.topK,
        filters: body.filters,
      });
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError("Search failed", err);
    }

    const response: SearchResponse = {
      chunks: result.chunks,
      sources: result.sources,
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
