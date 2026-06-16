import { retrievalConfig } from "@/core/config/index.js";
import { logger } from "@/core/shared/logger.js";
import type { Retriever } from "@/core/shared/interfaces.js";
import { createKeyedCache } from "@/core/shared/keyedCache.js";
import type { ResolvedTenantConfig } from "@/platform/tenancy/resolve.js";
import { HybridRetriever } from "./hybrid.js";
import { KnowledgeGraphRetriever } from "./knowledgeGraph.js";
import { VectorRetriever } from "./vector.js";

const cache = createKeyedCache<Retriever>();

export function getRetriever(cfg?: ResolvedTenantConfig["retrieval"]): Retriever {
  const hybridEnabled = cfg?.hybridSearchEnabled ?? retrievalConfig.hybridSearchEnabled;
  const topK = cfg?.topK ?? retrievalConfig.topK;
  const kgEnabled = cfg?.kgEnabled ?? false;
  const key = `${hybridEnabled}|${topK}|${kgEnabled}`;

  return cache.get(key, () => {
    const retriever = hybridEnabled
      ? new HybridRetriever()
      : new VectorRetriever(topK);
    logger.info(
      { retriever: retriever.name, hybridSearchEnabled: hybridEnabled },
      "Retriever ready",
    );
    return retriever;
  });
}

let kgCached: KnowledgeGraphRetriever | undefined;

export function getKGRetriever(): KnowledgeGraphRetriever {
  if (kgCached) return kgCached;
  kgCached = new KnowledgeGraphRetriever();
  logger.info({ retriever: kgCached.name }, "KG retriever ready");
  return kgCached;
}

export function resetRetriever(): void {
  cache.clear();
}

export function resetKGRetriever(): void {
  kgCached = undefined;
}
