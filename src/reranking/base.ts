/**
 * Abstract base for all `Reranker` implementations.
 *
 * A reranker takes an already-retrieved candidate set (size = topK) and
 * returns the best `topN` (typically `topN < topK`). Concrete rerankers
 * may use cross-encoders, LLM judges, or other signals; `BaseReranker`
 * simply owns the contract.
 */
import type { Reranker } from "../shared/interfaces.js";
import type { Chunk } from "../shared/types.js";

export abstract class BaseReranker implements Reranker {
  abstract readonly name: string;
  abstract rerank(query: string, chunks: Chunk[], topN: number): Promise<Chunk[]>;
}
