/**
 * Factory for the platform-wide `Reranker` singleton.
 *
 * Driven by `retrievalConfig.rerankerEnabled`:
 *   - true  → `OpenAiReranker`
 *   - false → `NoopReranker`  (the Phase 1 default)
 */
import { retrievalConfig } from "../config/index.js";
import { logger } from "../shared/logger.js";
import type { Reranker } from "../shared/interfaces.js";
import { NoopReranker } from "./noop.js";
import { OpenAiReranker } from "./openai.js";

let cached: Reranker | undefined;

export function getReranker(): Reranker {
  if (cached) return cached;
  cached = retrievalConfig.rerankerEnabled
    ? new OpenAiReranker()
    : new NoopReranker();
  logger.info(
    {
      reranker: cached.name,
      rerankerEnabled: retrievalConfig.rerankerEnabled,
    },
    "Reranker ready",
  );
  return cached;
}

/** Test helper: clear the cached singleton. */
export function resetReranker(): void {
  cached = undefined;
}
