/**
 * Factory for the platform-wide `Retriever` singleton.
 *
 * The choice is driven by `retrievalConfig`:
 *   - `hybridSearchEnabled` → `HybridRetriever`
 *   - otherwise             → `VectorRetriever`
 *
 * Keyword and metadata retrievers are not returned by default; they are
 * exported as classes and can be composed by callers that need them.
 */
import { retrievalConfig } from "../config/index.js";
import { logger } from "../shared/logger.js";
import type { Retriever } from "../shared/interfaces.js";
import { HybridRetriever } from "./hybrid.js";
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

/** Test helper: clear the cached singleton. */
export function resetRetriever(): void {
  cached = undefined;
}
