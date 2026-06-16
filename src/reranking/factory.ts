import { llmConfig, retrievalConfig } from "@/config/index.js";
import { logger } from "@/shared/logger.js";
import type { Reranker } from "@/shared/interfaces.js";
import { createKeyedCache } from "@/shared/keyedCache.js";
import type { ResolvedTenantConfig } from "@/tenancy/resolve.js";
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
