/**
 * LLM-as-a-judge metric.
 *
 * Phase 1: stub — the class is wired in but every call returns `null` and
 * logs a one-time warning. This lets the eval harness and call sites compile
 * and run today.
 *
 * Phase 2: implement using `ChatOpenAI` with structured output to score on a
 * 1–5 Likert scale across relevance, groundedness, faithfulness, and
 * overall quality.
 */
import type { Source } from "../shared/types.js";
import { logger } from "../shared/logger.js";

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

export class LLMJudge {
  private model: string;
  private warned = false;

  constructor(opts: { model?: string } = {}) {
    this.model = opts.model ?? "gpt-4o-mini";
  }

  /**
   * Score a (query, answer, sources) tuple.
   *
   * Phase 1: returns a deterministic placeholder result with all aspects =
   * 0 and `overall = 0`. Callers should detect this (e.g. by checking
   * `result.overall === 0` and the warning log) and fall back to the
   * rule-based metrics in `generation.ts`.
   */
  async score(_input: JudgeInput): Promise<JudgeResult> {
    if (!this.warned) {
      logger.warn(
        "LLMJudge.score() is a Phase 1 stub — returning placeholder scores. " +
          "Implement in Phase 2 for real LLM-as-judge evaluation.",
      );
      this.warned = true;
    }
    void _input;
    return {
      aspects: DEFAULT_ASPECTS.map((name) => ({
        name,
        score: 0 as JudgeScore,
        reasoning: "LLM judge not yet implemented (Phase 1 stub)",
      })),
      overall: 0,
    };
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
      score: Math.round(v.total / results.length) as JudgeScore,
      reasoning: v.reasoning,
    }));
    const overall =
      aspects.reduce((acc, a) => acc + a.score, 0) / Math.max(aspects.length, 1);
    return { aspects, overall };
  }
}
