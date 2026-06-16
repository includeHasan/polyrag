import { chunkingConfig } from "@/core/config/index.js";
import { logger } from "@/core/shared/logger.js";
import type { Chunker } from "@/core/shared/interfaces.js";
import { createKeyedCache } from "@/core/shared/keyedCache.js";
import type { ResolvedTenantConfig } from "@/platform/tenancy/resolve.js";
import { BaseChunker } from "./base.js";
import { FixedChunker } from "./fixed.js";
import { RecursiveChunker } from "./recursive.js";

const cache = createKeyedCache<Chunker>();

export function getChunker(cfg?: ResolvedTenantConfig["chunking"]): Chunker {
  const { strategy, chunkSize, chunkOverlap } = cfg ?? chunkingConfig;
  const key = `${strategy}|${chunkSize}|${chunkOverlap}`;

  return cache.get(key, () => {
    let chunker: Chunker;
    switch (strategy) {
      case "fixed":
        chunker = new FixedChunker(chunkSize, chunkOverlap);
        break;
      case "recursive":
        chunker = new RecursiveChunker(chunkSize, chunkOverlap);
        break;
      case "semantic":
      case "agentic":
        logger.warn(
          { strategy },
          "semantic/agentic chunkers not implemented yet; falling back to recursive",
        );
        chunker = new RecursiveChunker(chunkSize, chunkOverlap);
        break;
      default: {
        const _exhaustive: never = strategy;
        void _exhaustive;
        chunker = new RecursiveChunker(chunkSize, chunkOverlap);
      }
    }
    logger.info(
      {
        strategy: chunker.strategy,
        chunkSize: (chunker as BaseChunker & { chunkSize: number }).chunkSize,
        chunkOverlap: (chunker as BaseChunker & { chunkOverlap: number }).chunkOverlap,
      },
      "Chunker ready",
    );
    return chunker;
  });
}

export function resetChunker(): void {
  cache.clear();
}
