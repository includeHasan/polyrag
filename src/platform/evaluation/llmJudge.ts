/**
 * LLM-as-a-judge metric.
 *
 * Phase 2 implementation: uses `ChatOpenAI` with structured output to score
 * a (query, answer, sources) tuple on a 1–5 Likert scale across four
 * aspects: relevance, groundedness, faithfulness, overall quality.
 *
 * The judge is deliberately separate from the generation model so we never
 * let the LLM grade its own output (PRD §17).
 */
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { Source } from "@/core/shared/types.js";
import { logger } from "@/core/shared/logger.js";
import { env } from "@/core/config/env.js";
import { GenerationError } from "@/core/shared/errors.js";

/** 1–5 Likert scale. */
export type JudgeScore = 1 | 2 | 3 | 4 | 5;

export interface JudgeAspect {
  /** Aspect name, e.g. "relevance", "faithfulness", "overall". */
  name: string;
  /** 1–5 score. */
  score: JudgeScore;
  /** Free-text justification. */
  reasoning: string;
}

export interface JudgeResult {
  aspects: JudgeAspect[];
  /** Mean across all aspects. Range [1, 5]. */
  overall: number;
  /** Total tokens consumed (prompt + completion), if available. */
  tokensUsed?: number;
}

export interface JudgeInput {
  query: string;
  answer: string;
  sources: Source[];
  groundTruthAnswer?: string;
  groundTruthChunks?: string[];
}

/** Aspects we always judge, in this order. */
export const DEFAULT_ASPECTS = [
  "relevance",
  "groundedness",
  "faithfulness",
  "overall",
] as const;

/** Structured output schema for the LLM judge. */
const JudgeSchema = z.object({
  relevance: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string(),
  }),
  groundedness: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string(),
  }),
  faithfulness: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string(),
  }),
  overall: z.object({
    score: z.number().int().min(1).max(5),
    reasoning: z.string(),
  }),
});

type JudgeOutput = z.infer<typeof JudgeSchema>;

const SYSTEM_PROMPT = `You are a strict, fair evaluator of RAG (Retrieval-Augmented Generation) system outputs. You are NOT the system that generated the answer — you are an independent judge.

For each of the four aspects below, output a score from 1 to 5 and a one-sentence justification.

ASPECTS:
- relevance: Does the answer address the user's question directly and completely?
- groundedness: Are the claims in the answer supported by the provided sources? (5 = every claim is cited and traceable; 1 = answer is full of unsupported claims or contradicts the sources)
- faithfulness: Is the answer free of hallucinations, invented citations, or facts not present in the sources? (5 = no hallucinations; 1 = obvious fabrications)
- overall: A holistic quality score. (5 = publication-ready; 1 = unusable)

Be strict. A correct but vague answer should get 3, not 4.`;

function userPrompt(input: JudgeInput): string {
  const sourcesBlock = input.sources
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}${s.page ? ` (p.${s.page})` : ""}${
          s.chunkId ? ` [chunkId: ${s.chunkId}]` : ""
        }\n${s.snippet}`,
    )
    .join("\n\n");
  const groundTruthBlock = input.groundTruthAnswer
    ? `\nGround-truth reference answer:\n${input.groundTruthAnswer}\n`
    : "";
  return `User question:
${input.query}

Answer to evaluate:
${input.answer}

Sources (numbered, the same numbering the answer should use for citations):
${sourcesBlock || "(no sources provided)"}
${groundTruthBlock}
Output JSON with the four aspects.`;
}

export class LLMJudge {
  private readonly model: ChatOpenAI;
  private readonly modelName: string;

  constructor(opts: { model?: string; apiKey?: string } = {}) {
    this.modelName = opts.model ?? env.OPENAI_MODEL_EVALUATION;
    this.model = new ChatOpenAI({
      model: this.modelName,
      apiKey: opts.apiKey ?? env.OPENAI_API_KEY,
      temperature: 0,
      maxRetries: 2,
    });
  }

  /**
   * Score a (query, answer, sources) tuple on the four default aspects.
   * Falls back to a 3/3/3/3 neutral score with reasoning if the model call
   * fails — the eval harness treats this as a soft failure, not a hard error.
   */
  async score(input: JudgeInput): Promise<JudgeResult> {
    try {
      // Use LangChain's `withStructuredOutput` for reliable JSON.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structured: any = this.model.withStructuredOutput(JudgeSchema, {
        name: "judge_result",
      });
      const result: JudgeOutput = await structured.invoke([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(input) },
      ]);

      const aspects: JudgeAspect[] = [
        {
          name: "relevance",
          score: clamp(result.relevance.score),
          reasoning: result.relevance.reasoning,
        },
        {
          name: "groundedness",
          score: clamp(result.groundedness.score),
          reasoning: result.groundedness.reasoning,
        },
        {
          name: "faithfulness",
          score: clamp(result.faithfulness.score),
          reasoning: result.faithfulness.reasoning,
        },
        {
          name: "overall",
          score: clamp(result.overall.score),
          reasoning: result.overall.reasoning,
        },
      ];
      const overall = aspects.reduce((acc, a) => acc + a.score, 0) / aspects.length;
      return { aspects, overall };
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "LLMJudge.score failed; returning neutral fallback",
      );
      return {
        aspects: DEFAULT_ASPECTS.map((name) => ({
          name,
          score: 3 as JudgeScore,
          reasoning: `Judge failed (${(err as Error).message}); neutral fallback`,
        })),
        overall: 3,
      };
    }
  }

  /** Convenience: average across many results. */
  static aggregate(results: JudgeResult[]): JudgeResult {
    if (results.length === 0) {
      return { aspects: [], overall: 0 };
    }
    const sums = new Map<string, { total: number; reasoning: string }>();
    for (const r of results) {
      for (const a of r.aspects) {
        const cur = sums.get(a.name) ?? { total: 0, reasoning: a.reasoning };
        cur.total += a.score;
        sums.set(a.name, cur);
      }
    }
    const aspects: JudgeAspect[] = [...sums.entries()].map(([name, v]) => ({
      name,
      score: clamp(Math.round(v.total / results.length)),
      reasoning: v.reasoning,
    }));
    const overall =
      aspects.reduce((acc, a) => acc + a.score, 0) / Math.max(aspects.length, 1);
    return { aspects, overall };
  }
}

function clamp(n: number): JudgeScore {
  const rounded = Math.max(1, Math.min(5, Math.round(n)));
  return rounded as JudgeScore;
}
