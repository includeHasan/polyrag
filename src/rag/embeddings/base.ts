/**
 * Abstract base / type re-exports for the `EmbeddingProvider` interface.
 *
 * Concrete implementations live in sibling files (`openai.ts`, `cache.ts`).
 * Keeping a base class makes it cheap to add new providers (Cohere, Voyage,
 * local, ...) without changing the consumer code in `ingestion/pipeline.ts`.
 */
import type { EmbeddingProvider } from "@/core/shared/interfaces.js";

/**
 * Re-export the contract under the same name as the local file so consumers
 * can `import { BaseEmbeddingProvider } from "./base.js"` even though
 * `EmbeddingProvider` is a pure interface.
 */
export type { EmbeddingProvider } from "@/core/shared/interfaces.js";

/**
 * Convenience abstract base class. Subclasses must implement `embed` and
 * `embedBatch` and provide the `model` / `dimension` accessors. Optional
 * hooks are provided for symmetry with future providers that need a
 * lifecycle (`init` / `dispose`).
 */
export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  abstract readonly model: string;
  abstract readonly dimension: number;

  abstract embed(text: string): Promise<number[]>;
  abstract embedBatch(texts: string[]): Promise<number[][]>;

  /** Optional one-time setup (network warm-up, token validation, ...). */
  async init(): Promise<void> {
    /* no-op by default */
  }

  /** Optional teardown (close HTTP clients, ...). */
  async dispose(): Promise<void> {
    /* no-op by default */
  }
}
