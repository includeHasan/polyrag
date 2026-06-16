/**
 * Search controller — validates the request, delegates to the search service,
 * and records metrics (best-effort).
 */
import type { FastifyRequest } from "fastify";
import { getObservability } from "../deps.js";
import {
  SearchRequestSchema,
  search as searchService,
  type SearchRequest,
  type SearchResponse,
} from "../services/search.service.js";

export async function search(request: FastifyRequest): Promise<SearchResponse> {
  const start = Date.now();
  const parsed = SearchRequestSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;
  const body: SearchRequest = parsed.data;

  const response = await searchService(body);

  try {
    const obs = await getObservability();
    obs.incrCounter("searchesTotal");
    obs.recordLatency("search", Date.now() - start);
  } catch {
    // best-effort
  }
  return response;
}
