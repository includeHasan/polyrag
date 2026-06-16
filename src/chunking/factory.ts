/**
 * Factory for the platform-wide `Chunker` singleton.
 *
 * Picks the implementation from `chunkingConfig.strategy`. The `semantic` and
 * `agentic` strategies are Phase 2 stubs and fall back to `RecursiveChunker`
 * with a logged warning — so the pipeline never breaks for an unsupported
 * strategy value, and operators can flip the env var without code changes.
 */
import { chunkingConfig } from "../config/index.js";
import { BaseChunker } from "./base.js";
import { FixedChunker } from "./fixed.js";
import { RecursiveChunker } from "./recursive.js";
import { logger } from "../shared/logger.js";
import type { Chunker } from "../shared/interfaces.js";

let cached: Chunker | undefined;

export function getChunker(): Chunker {
  if (cached) return cached;
  const { strategy, chunkSize, chunkOverlap } = chunkingConfig;

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
      // Exhaustiveness check.
      const _exhaustive: never = strategy;
      void _exhaustive;
      chunker = new RecursiveChunker(chunkSize, chunkOverlap);
    }
  }

  cached = chunker;
  logger.info(
    {
      strategy: chunker.strategy,
      chunkSize: (chunker as BaseChunker & { chunkSize: number }).chunkSize,
      chunkOverlap: (chunker as BaseChunker & { chunkOverlap: number }).chunkOverlap,
    },
    "Chunker ready",
  );
  return cached;
}

/** Test helper. */
export function resetChunker(): void {
  cached = undefined;
}
