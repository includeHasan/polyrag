/**
 * Generation-quality metrics.
 *
 * Phase 1: rule-based stubs. They are deterministic and dependency-free so
 * the eval harness produces numbers from day one, but they are NOT a
 * substitute for human or LLM-judged evaluation.
 *
 * Phase 2: swap the stubs for real LLM-judge implementations (see
 * `llmJudge.ts`) and/or RAGAS / TruLens style metrics.
 */
import type { Source } from "../shared/types.js";

/**
 * The citation token format produced by the answer-generation prompt.
 * Match the `[N]` style so the rule-based heuristics can detect it cheaply.
 */
const CITATION_REGEX = /\[(\d+)\]/g;

/**
 * Extract unique citation indices (`[N]`) referenced in the answer.
 */
export function extractCitations(answer: string): number[] {
  if (!answer || typeof answer !== "string") return [];
  const set = new Set<number>();
  for (const match of answer.matchAll(CITATION_REGEX)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Metric functions (Phase 1 stubs)
// ---------------------------------------------------------------------------

/**
 * Relevance — for Phase 1, measure token overlap between the answer and the
 * concatenated source snippets. Range: [0, 1]. This is a noisy proxy; the
 * real metric is the LLM judge (Phase 2).
 */
export function relevance(
  answer: string,
  sources: Source[],
): number {
  if (!answer) return 0;
  const answerTokens = new Set(
    answer.toLowerCase().match(/[a-z0-9]+/g) ?? [],
  );
  if (answerTokens.size === 0) return 0;

  const sourceTokens = new Set<string>();
  for (const s of sources ?? []) {
    for (const t of (s.snippet ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      sourceTokens.add(t);
    }
  }
  if (sourceTokens.size === 0) return 0;

  let overlap = 0;
  for (const t of answerTokens) if (sourceTokens.has(t)) overlap++;
  return overlap / answerTokens.size;
}

/**
 * Groundedness — fraction of answer tokens that are also present in the
 * source snippets. Range: [0, 1].
 */
export function groundedness(
  answer: string,
  sources: Source[],
): number {
  if (!answer) return 0;
  const answerTokens = (answer.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (answerTokens.length === 0) return 0;

  const sourceTokens = new Set<string>();
  for (const s of sources ?? []) {
    for (const t of (s.snippet ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      sourceTokens.add(t);
    }
  }
  if (sourceTokens.size === 0) return 0;

  let grounded = 0;
  for (const t of answerTokens) if (sourceTokens.has(t)) grounded++;
  return grounded / answerTokens.length;
}

/**
 * Faithfulness — Phase 1 stub: returns 1 iff the answer contains at least
 * one `[N]` citation, else 0. Real faithfulness (no hallucinations) requires
 * the LLM judge (Phase 2).
 */
export function faithfulness(
  answer: string,
  _sources: Source[],
): number {
  void _sources;
  const citations = extractCitations(answer);
  return citations.length > 0 ? 1 : 0;
}

/**
 * Aggregate generation metric scores into a single object.
 */
export interface GenerationMetricScores {
  relevance: number;
  groundedness: number;
  faithfulness: number;
  citations: number[];
}

export function computeGenerationMetrics(
  answer: string,
  sources: Source[],
): GenerationMetricScores {
  return {
    relevance: relevance(answer, sources),
    groundedness: groundedness(answer, sources),
    faithfulness: faithfulness(answer, sources),
    citations: extractCitations(answer),
  };
}
