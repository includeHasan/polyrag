/**
 * `planner` node — decompose a user query into 3-5 focused sub-questions.
 *
 * Uses `ChatOpenAI` (gpt-4o-mini) with `withStructuredOutput` and a Zod
 * schema to constrain the response. On any LLM error we fall back to a
 * deterministic 3-sub-question plan so the rest of the graph can still
 * complete.
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { env } from "../../../config/env.js";
import { GenerationError } from "../../../shared/errors.js";
import { logger } from "../../../shared/logger.js";
import type { ResearchState } from "../state.js";

const SubQuestionPlanSchema = z.object({
  subQuestions: z.array(z.string()).min(3).max(5),
});

export type SubQuestionPlan = z.infer<typeof SubQuestionPlanSchema>;

let llmSingleton: ChatOpenAI | undefined;

/** Lazily build the planner chat model. */
function getLlm(): ChatOpenAI {
  if (llmSingleton) return llmSingleton;
  llmSingleton = new ChatOpenAI({
    // gpt-4o-mini is the cheap/fast choice for structured planning; the
    // synthesizer can use a larger model.
    model: "gpt-4o-mini",
    apiKey: env.OPENAI_API_KEY,
    temperature: 0.2,
  });
  return llmSingleton;
}

const SYSTEM_PROMPT =
  "You are a research planner. Given a user query, decompose it into 3-5 " +
  "focused, self-contained sub-questions that, when answered together, " +
  "would let a researcher produce a thorough, cited answer. " +
  "Each sub-question should target a distinct facet (background, " +
  "definitions, key facts, comparisons, recent developments). " +
  "Return them in a stable, execution-friendly order.";

export async function plannerNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "planner";
  try {
    const query = state.query;
    if (!query || typeof query !== "string") {
      throw new GenerationError(`[${nodeName}] state.query is empty or not a string`);
    }

    logger.info({ queryChars: query.length }, `[${nodeName}] start`);

    const llm = getLlm();
    const structured = llm.withStructuredOutput(SubQuestionPlanSchema, {
      name: "SubQuestionPlan",
    });

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Query: ${query}`),
    ];

    let subQuestions: string[];
    try {
      const plan = (await structured.invoke(messages)) as SubQuestionPlan;
      subQuestions = (plan?.subQuestions ?? []).map((q) => String(q).trim()).filter(Boolean);
    } catch (err) {
      // Fall back to a deterministic plan so the rest of the graph can run.
      logger.warn(
        { err: (err as Error).message },
        `[${nodeName}] structured planner failed, using fallback plan`,
      );
      subQuestions = fallbackPlan(query);
    }

    // Defensive: ensure we always have at least 3 sub-questions, never more than 5.
    if (subQuestions.length < 3) {
      subQuestions = fallbackPlan(query).slice(0, Math.max(3, subQuestions.length));
    }
    if (subQuestions.length > 5) {
      subQuestions = subQuestions.slice(0, 5);
    }

    logger.info(
      { count: subQuestions.length, subQuestions },
      `[${nodeName}] produced sub-questions`,
    );

    return {
      subQuestions,
      iterations: (state.iterations ?? 0) + 1,
      metadata: {
        ...state.metadata,
        subQuestionCount: subQuestions.length,
        node: nodeName,
      },
    };
  } catch (err) {
    if (err instanceof GenerationError) throw err;
    logger.error({ err }, `[${nodeName}] failed`);
    throw new GenerationError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}

/** Deterministic fallback used when the LLM call fails. */
function fallbackPlan(query: string): string[] {
  return [
    `Background and overview: ${query}`,
    `Key facts and definitions related to: ${query}`,
    `Recent developments or examples concerning: ${query}`,
  ];
}
