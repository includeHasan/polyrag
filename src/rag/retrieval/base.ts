/**
 * Abstract base for all `Retriever` implementations.
 *
 * Each concrete retriever (vector, keyword, hybrid, metadata) subclasses
 * `BaseRetriever` and supplies a `name` in its constructor. `BaseRetriever`
 * wires the `Retriever` interface to that name so consumers can read
 * `retriever.name` for logging / metrics without each implementation having
 * to override the getter.
 */
import type { Retriever } from "@/core/shared/interfaces.js";
import type { Chunk, QueryUnderstanding } from "@/core/shared/types.js";

export type RetrieveOptions = {
  topK?: number;
  filter?: Record<string, unknown>;
};

export abstract class BaseRetriever implements Retriever {
  abstract readonly name: string;

  abstract retrieve(
    query: string,
    understanding: QueryUnderstanding,
    options?: RetrieveOptions,
  ): Promise<Chunk[]>;
}
