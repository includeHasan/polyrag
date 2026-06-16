/**
 * Evaluation harness — runs a dataset through the platform and reports
 * retrieval + generation metrics.
 *
 * Phase 1: the harness is decoupled from the live RAG pipeline to avoid a
 * hard import cycle. Callers inject a `queryFn` that takes a `QueryRequest`
 * and returns a `QueryResponse`. This makes the harness easy to unit-test
 * and lets us iterate on the pipeline without touching eval code.
 *
 * Example:
 * ```ts
 * const summary = await runEvaluation(dataset, {
 *   queryFn: (req) => pipeline.query(req),
 *   topK: 10,
 * });
 * console.log(JSON.stringify(summary, null, 2));
 * ```
 */
import { logger } from "@/core/shared/logger.js";
import type { QueryRequest, QueryResponse, Source } from "@/core/shared/types.js";
import { computeRetrievalMetrics, type RetrievalMetricScores } from "./retrieval.js";
import { computeGenerationMetrics, type GenerationMetricScores } from "./generation.js";
import { LLMJudge, type JudgeResult } from "./llmJudge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvaluationSample {
  query: string;
  /** Chunk IDs considered relevant. */
  groundTruthChunks: string[];
  /** Optional reference answer for judge-based evaluation. */
  expectedAnswer?: string;
  /** Optional filters to pass through to the retriever. */
  filters?: Record<string, unknown>;
  /** Session ID, if the test should use a specific thread. */
  sessionId?: string;
}

export interface PerSampleReport {
  index: number;
  query: string;
  retrieval: RetrievalMetricScores;
  generation: GenerationMetricScores;
  judge: JudgeResult | null;
  latencyMs: number;
  answer: string;
  retrievedChunkIds: string[];
}

export interface EvaluationSummary {
  /** Number of samples in the dataset. */
  size: number;
  /** Mean metrics across all samples. */
  averages: {
    retrieval: RetrievalMetricScores;
    generation: GenerationMetricScores;
    judge: JudgeResult | null;
    latencyMs: number;
  };
  /** Full per-sample report. */
  perSample: PerSampleReport[];
  /** Total wall-clock time of the run. */
  totalDurationMs: number;
}

export interface RunEvaluationOptions {
  /**
   * How to actually run a query. Pass the platform's `pipeline.query` here,
   * or a mock for tests.
   */
  queryFn: (req: QueryRequest) => Promise<QueryResponse>;
  /** K used for retrieval metric computation. Defaults to the first hit count. */
  topK?: number;
  /** Skip the LLM judge pass. Defaults to true in Phase 1. */
  skipJudge?: boolean;
  /** Custom judge instance. */
  judge?: LLMJudge;
  /** Optional progress callback. */
  onProgress?: (done: number, total: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunkIdsFromSources(sources: Source[]): string[] {
  return sources
    .map((s) => s.chunkId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function emptyRetrieval(): RetrievalMetricScores {
  return { recall: 0, precision: 0, mrr: 0, ndcg: 0 };
}

function emptyGeneration(): GenerationMetricScores {
  return { relevance: 0, groundedness: 0, faithfulness: 0, citations: [] };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Run a dataset through the platform and produce an `EvaluationSummary`.
 */
export async function runEvaluation(
  dataset: EvaluationSample[],
  options: RunEvaluationOptions,
): Promise<EvaluationSummary> {
  const started = Date.now();
  const judge = options.judge ?? new LLMJudge();
  // Phase 2: judge is on by default. Pass `skipJudge: true` to disable.
  const skipJudge = options.skipJudge ?? false;

  const reports: PerSampleReport[] = [];

  for (let i = 0; i < dataset.length; i++) {
    const sample = dataset[i];
    const t0 = Date.now();

    let response: QueryResponse;
    try {
      response = await options.queryFn({
        query: sample.query,
        sessionId: sample.sessionId,
        filters: sample.filters,
        topK: options.topK,
        stream: false,
      });
    } catch (err) {
      logger.error({ err, index: i, query: sample.query }, "Eval query failed");
      reports.push({
        index: i,
        query: sample.query,
        retrieval: emptyRetrieval(),
        generation: emptyGeneration(),
        judge: null,
        latencyMs: Date.now() - t0,
        answer: "",
        retrievedChunkIds: [],
      });
      options.onProgress?.(i + 1, dataset.length);
      continue;
    }

    const retrievedIds = chunkIdsFromSources(response.sources);
    const k = options.topK ?? retrievedIds.length;

    const retrieval = computeRetrievalMetrics(
      sample.groundTruthChunks,
      retrievedIds,
      k,
    );
    const generation = computeGenerationMetrics(
      response.answer,
      response.sources,
    );

    let judgeResult: JudgeResult | null = null;
    if (!skipJudge) {
      try {
        judgeResult = await judge.score({
          query: sample.query,
          answer: response.answer,
          sources: response.sources,
          groundTruthAnswer: sample.expectedAnswer,
          groundTruthChunks: sample.groundTruthChunks,
        });
      } catch (err) {
        logger.warn({ err, index: i }, "LLM judge failed; continuing without judge");
      }
    }

    reports.push({
      index: i,
      query: sample.query,
      retrieval,
      generation,
      judge: judgeResult,
      latencyMs: Date.now() - t0,
      answer: response.answer,
      retrievedChunkIds: retrievedIds,
    });

    options.onProgress?.(i + 1, dataset.length);
  }

  // -----------------------------------------------------------------------
  // Aggregate
  // -----------------------------------------------------------------------
  const n = reports.length;
  const avgRetrieval: RetrievalMetricScores = {
    recall: mean(reports.map((r) => r.retrieval.recall)),
    precision: mean(reports.map((r) => r.retrieval.precision)),
    mrr: mean(reports.map((r) => r.retrieval.mrr)),
    ndcg: mean(reports.map((r) => r.retrieval.ndcg)),
  };
  const avgGeneration: GenerationMetricScores = {
    relevance: mean(reports.map((r) => r.generation.relevance)),
    groundedness: mean(reports.map((r) => r.generation.groundedness)),
    faithfulness: mean(reports.map((r) => r.generation.faithfulness)),
    citations: [], // not meaningful to average
  };

  const judgedResults = reports.map((r) => r.judge).filter((j): j is JudgeResult => j !== null);
  const avgJudge = judgedResults.length > 0 ? LLMJudge.aggregate(judgedResults) : null;

  const summary: EvaluationSummary = {
    size: n,
    averages: {
      retrieval: avgRetrieval,
      generation: avgGeneration,
      judge: avgJudge,
      latencyMs: mean(reports.map((r) => r.latencyMs)),
    },
    perSample: reports,
    totalDurationMs: Date.now() - started,
  };

  logger.info(
    {
      size: summary.size,
      recall: avgRetrieval.recall.toFixed(3),
      mrr: avgRetrieval.mrr.toFixed(3),
      latencyMs: summary.averages.latencyMs.toFixed(1),
      totalDurationMs: summary.totalDurationMs,
    },
    "Evaluation complete",
  );

  return summary;
}
