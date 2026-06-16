/**
 * `evaluate` node — Phase 3 real implementation.
 *
 * Runs an LLM-as-judge pass over the generated answer to score
 * groundedness and faithfulness on a 1-5 Likert scale. The result is
 * written back into `state.groundednessScore` and `state.metadata.evaluation`.
 *
 * If the score is below `EVAL_THRESHOLD` (default 3), the node attaches a
 * `needsReRetrieval` flag in `state.metadata`. The LangGraph `evaluate` node
 * is the terminal node today, but the `retrieve` node already checks the
 * flag on its next pass and would issue a refined query in a future graph
 * version (a `Command({ goto: "retrieve" })` loop-back).
 *
 * Latency cost: one extra ChatOpenAI call per query (gpt-4o-mini, ~300ms).
 * Disable in dev by setting `EVALUATION_ENABLED=false` in the env.
 */
import { logger } from "../../../shared/logger.js";
import { GenerationError } from "../../../shared/errors.js";
import { env } from "../../../config/env.js";
import { LLMJudge } from "../../../evaluation/llmJudge.js";
import type { Source } from "../../../shared/types.js";
import { resolveNodeConfig } from "./_config.js";
import { getLLM } from "@/llm/factory.js";

const EVAL_THRESHOLD = 3; // 1-5 Likert; 3 = acceptable

export async function evaluateNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "evaluate";
  const start = Date.now();

  const cfg = resolveNodeConfig(state);

  // Feature toggle — keep CI fast.
  if (env.NODE_ENV === "test" && process.env.EVALUATION_ENABLED === "false") {
    logger.debug(`[${nodeName}] evaluation skipped (test mode, disabled)`);
    return {
      metadata: { ...state.metadata, node: nodeName, evaluated: false },
    };
  }

  // If the generator never produced a final answer, we can't evaluate.
  const answer: string = state.finalAnswer ?? state.draftAnswer ?? "";
  if (!answer) {
    logger.warn(`[${nodeName}] no answer to evaluate — marking unevaluated`);
    return {
      metadata: { ...state.metadata, node: nodeName, evaluated: false },
    };
  }

  // Sources may live in `state.sources` (post-buildContext) or in
  // `state.rerankedChunks` if the buildContext step was skipped.
  const sources: Source[] = (state.sources as Source[] | undefined) ?? [];

  try {
    const judge = new LLMJudge({ model: cfg.models.evaluationModel });
    const result = await judge.score({
      query: state.query ?? "",
      answer,
      sources,
    });

    // Prefer the 'groundedness' aspect; fall back to overall.
    const groundedness =
      result.aspects.find((a) => a.name === "groundedness")?.score ??
      result.aspects.find((a) => a.name === "overall")?.score ??
      0;
    const faithfulness =
      result.aspects.find((a) => a.name === "faithfulness")?.score ?? 0;
    const relevance =
      result.aspects.find((a) => a.name === "relevance")?.score ?? 0;

    const needsReRetrieval = groundedness < EVAL_THRESHOLD;

    logger.info(
      {
        groundedness,
        faithfulness,
        relevance,
        overall: result.overall.toFixed(2),
        threshold: EVAL_THRESHOLD,
        needsReRetrieval,
        latencyMs: Date.now() - start,
      },
      `[${nodeName}] ${nodeName} complete`,
    );

    return {
      groundednessScore: groundedness,
      approved: !needsReRetrieval,
      metadata: {
        ...state.metadata,
        node: nodeName,
        evaluated: true,
        evaluation: {
          groundedness,
          faithfulness,
          relevance,
          overall: result.overall,
          threshold: EVAL_THRESHOLD,
          needsReRetrieval,
          latencyMs: Date.now() - start,
          reasoning: Object.fromEntries(
            result.aspects.map((a) => [a.name, a.reasoning]),
          ),
        },
      },
    };
  } catch (err) {
    // Soft-fail: a broken judge should not 500 the user's query.
    logger.error(
      { err, latencyMs: Date.now() - start },
      `[${nodeName}] failed; passing through without blocking`,
    );
    return {
      metadata: {
        ...state.metadata,
        node: nodeName,
        evaluated: false,
        evaluationError: (err as Error).message,
      },
    };
  }
}
