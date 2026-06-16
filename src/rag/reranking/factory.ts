import { llmConfig, retrievalConfig } from "@/core/config/index.js";
import { logger } from "@/core/shared/logger.js";
import type { Reranker } from "@/core/shared/interfaces.js";
import { createKeyedCache } from "@/core/shared/keyedCache.js";
import type { ResolvedTenantConfig } from "@/platform/tenancy/resolve.js";
import { NoopReranker } from "./noop.js";
import { OpenAiReranker } from "./openai.js";

const cache = createKeyedCache<Reranker>();

export function getReranker(cfg?: ResolvedTenantConfig["retrieval"]): Reranker {
  const rerankerEnabled = cfg?.rerankerEnabled ?? retrievalConfig.rerankerEnabled;
  const rerankTopK = cfg?.rerankTopK ?? retrievalConfig.rerankTopK;
  const rerankModel = llmConfig.rerankModel;
  const key = `${rerankerEnabled}|${rerankModel}|${rerankTopK}`;

  return cache.get(key, () => {
    const reranker = rerankerEnabled ? new OpenAiReranker() : new NoopReranker();
    logger.info(
      { reranker: reranker.name, rerankerEnabled },
      "Reranker ready",
    );
    return reranker;
  });
}

export function resetReranker(): void {
  cache.clear();
}
