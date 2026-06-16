/**
 * `searcher` node — retrieve chunks for ONE sub-question.
 *
 * The graph uses `Send` to launch one searcher instance per sub-question
 * (see `graph.ts`). Each instance reads `state.subQuestion` from its
 * per-task args, runs `getRetriever().retrieve(...)` against the shared
 * vector store, and writes its findings to `state.findings`. The
 * `ReducedValue` reducer on `findings` concatenates results from all
 * parallel searcher instances into a single list for the synthesizer.
 */
import { getRetriever } from "@/rag/retrieval/factory.js";
import { GenerationError, RetrievalError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Chunk, QueryUnderstanding } from "@/core/shared/types.js";
import type { ResearchState } from "../state.js";

/** Empty QueryUnderstanding used as a default for the retriever call. */
const EMPTY_UNDERSTANDING: QueryUnderstanding = {
  intent: "research",
  entities: [],
  filters: {},
  rewrittenQueries: [],
};

export async function searcherNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "searcher";
  try {
    const subQuestion: string | undefined = state.subQuestion;
    if (!subQuestion || typeof subQuestion !== "string") {
      // When run outside a Send (e.g. linear fallback), fall back to the
      // original query. Should not normally happen, but keep the graph
      // robust.
      logger.warn(
        `[${nodeName}] invoked without a subQuestion; falling back to state.query`,
      );
    }
    const effectiveQuery = (subQuestion ?? state.query ?? "").trim();
    if (!effectiveQuery) {
      throw new RetrievalError(`[${nodeName}] empty subQuestion and query`);
    }

    logger.info(
      { subQuestion: effectiveQuery.slice(0, 80) },
      `[${nodeName}] start`,
    );

    const retriever = getRetriever();
    const understanding: QueryUnderstanding = state.understanding ?? EMPTY_UNDERSTANDING;

    let findings: Chunk[] = [];
    try {
      findings = await retriever.retrieve(effectiveQuery, understanding, {
        topK: 5,
      });
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      logger.error(
        { err: (err as Error).message, subQuestion: effectiveQuery },
        `[${nodeName}] retrieval failed`,
      );
      throw new RetrievalError(
        `[${nodeName}] failed to retrieve for "${effectiveQuery}": ${
          (err as Error).message
        }`,
        err,
      );
    }

    logger.info(
      { subQuestion: effectiveQuery.slice(0, 80), findings: findings.length },
      `[${nodeName}] done`,
    );

    return {
      findings,
      metadata: {
        ...state.metadata,
        [`searcher:${subQuestion ?? "fallback"}:count`]: findings.length,
        node: nodeName,
      },
    };
  } catch (err) {
    if (err instanceof RetrievalError) throw err;
    logger.error({ err }, `[${nodeName}] failed`);
    throw new GenerationError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
