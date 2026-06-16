/**
 * Factory for the platform-wide `EmbeddingProvider` singleton.
 *
 * Returns a cached `CachedEmbeddingProvider(OpenAIEmbeddingProvider)` so
 * repeated calls share both the underlying OpenAI client and the Redis
 * connection. Tests / scripts that need a fresh instance can call
 * `resetEmbeddingProvider()` or instantiate the classes directly.
 */
import { logger } from "../shared/logger.js";
import type { EmbeddingProvider } from "../shared/interfaces.js";
import { CachedEmbeddingProvider } from "./cache.js";
import { OpenAIEmbeddingProvider } from "./openai.js";

let cached: EmbeddingProvider | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  const inner = new OpenAIEmbeddingProvider();
  const wrapped = new CachedEmbeddingProvider(inner);
  cached = wrapped;
  logger.info(
    {
      model: wrapped.model,
      dimension: wrapped.dimension,
      cache: "redis",
    },
    "EmbeddingProvider ready",
  );
  return cached;
}

/** Test helper: clear the cached singleton. */
export function resetEmbeddingProvider(): void {
  cached = undefined;
}
