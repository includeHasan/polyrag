/**
 * Factory for the platform-wide `Retriever` singleton.
 *
 * The choice is driven by `retrievalConfig`:
 *   - `hybridSearchEnabled` → `HybridRetriever`
 *   - otherwise             → `VectorRetriever`
 *
 * Keyword and metadata retrievers are not returned by default; they are
 * exported as classes and can be composed by callers that need them.
 *
 * The knowledge-graph retriever (Phase 4) is opt-in: callers fetch it via
 * `getKGRetriever()` and compose it into a custom pipeline. It is not
 * included in the default `getRetriever()` result.
 */
import { retrievalConfig } from "../config/index.js";
import { logger } from "../shared/logger.js";
import type { Retriever } from "../shared/interfaces.js";
import { HybridRetriever } from "./hybrid.js";
import { KnowledgeGraphRetriever } from "./knowledgeGraph.js";
import { VectorRetriever } from "./vector.js";

let cached: Retriever | undefined;

export function getRetriever(): Retriever {
  if (cached) return cached;
  cached = retrievalConfig.hybridSearchEnabled
    ? new HybridRetriever()
    : new VectorRetriever(retrievalConfig.topK);
  logger.info(
    {
      retriever: cached.name,
      hybridSearchEnabled: retrievalConfig.hybridSearchEnabled,
    },
    "Retriever ready",
  );
  return cached;
}

let kgCached: KnowledgeGraphRetriever | undefined;

/**
 * Opt-in factory for the Phase 4 knowledge-graph retriever. Returns a
 * process-wide singleton. Does NOT change the default `getRetriever()` —
 * callers explicitly opt in to graph retrieval by composing this alongside
 * the vector/keyword retrievers.
 */
export function getKGRetriever(): KnowledgeGraphRetriever {
  if (kgCached) return kgCached;
  kgCached = new KnowledgeGraphRetriever();
  logger.info({ retriever: kgCached.name }, "KG retriever ready");
  return kgCached;
}

/** Test helper: clear the cached singleton. */
export function resetRetriever(): void {
  cached = undefined;
}

/** Test helper: clear the cached KG retriever singleton. */
export function resetKGRetriever(): void {
  kgCached = undefined;
}
