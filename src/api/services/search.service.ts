/**
 * Search service — HTTP-agnostic retrieval orchestration. Runs the retriever
 * and projects the retrieved chunks into citation `Source` records.
 */
import { z } from "zod";
import {
  ChunkSchema,
  SourceSchema,
  type Chunk,
  type QueryUnderstanding,
  type Source,
} from "@/core/shared/types.js";
import { getRetrieval } from "../deps.js";
import { RetrievalError } from "@/core/shared/errors.js";
import type { Retriever as RetrieverInterface } from "@/core/shared/interfaces.js";

export const SearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().max(100).optional(),
  filters: z.record(z.string(), z.any()).optional(),
});

export const SearchResponseSchema = z.object({
  chunks: z.array(ChunkSchema),
  sources: z.array(SourceSchema),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export interface SearchResponse {
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

/** Run pure retrieval (no generation) for a single search request. */
export async function search(req: SearchRequest): Promise<SearchResponse> {
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
      filters: req.filters ?? {},
      rewrittenQueries: [],
    };
    chunks = await retriever.retrieve(req.query, understanding, {
      topK: req.topK,
      filter: req.filters,
    });
  } catch (err) {
    if (err instanceof RetrievalError) throw err;
    throw new RetrievalError("Search failed", err);
  }

  return {
    chunks,
    sources: chunksToSources(chunks),
  };
}
