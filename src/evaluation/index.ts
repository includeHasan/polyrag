/**
 * Evaluation layer — public surface.
 *
 *  - `retrieval`  — Recall/Precision/MRR/NDCG @ K.
 *  - `generation` — relevance, groundedness, faithfulness (Phase 1 stubs).
 *  - `llmJudge`   — LLM-as-judge (Phase 1 stub, Phase 2 will be real).
 *  - `harness`    — `runEvaluation(dataset, opts) → EvaluationSummary`.
 */
export * from "./retrieval.js";
export * from "./generation.js";
export * from "./llmJudge.js";
export * from "./harness.js";
