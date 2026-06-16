import { llmConfig } from "@/core/config/index.js";
import { logger } from "@/core/shared/logger.js";
import type { EmbeddingProvider } from "@/core/shared/interfaces.js";
import { createKeyedCache } from "@/core/shared/keyedCache.js";
import type { ResolvedTenantConfig } from "@/platform/tenancy/resolve.js";
import { CachedEmbeddingProvider } from "./cache.js";
import { OpenAIEmbeddingProvider } from "./openai.js";

const cache = createKeyedCache<EmbeddingProvider>();

export function getEmbeddingProvider(cfg?: Pick<ResolvedTenantConfig, "models">): EmbeddingProvider {
  void cfg;
  const key = `${llmConfig.embeddingModel}|${llmConfig.embeddingDim}`;
  return cache.get(key, () => {
    const inner = new OpenAIEmbeddingProvider();
    const wrapped = new CachedEmbeddingProvider(inner);
    logger.info(
      { model: wrapped.model, dimension: wrapped.dimension, cache: "redis" },
      "EmbeddingProvider ready",
    );
    return wrapped;
  });
}

export function resetEmbeddingProvider(): void {
  cache.clear();
}
