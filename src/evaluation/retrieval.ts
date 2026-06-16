/**
 * Retrieval-quality metrics.
 *
 * Inputs are lists of chunk IDs (strings). `groundTruth` is the set of chunk
 * IDs the dataset marks as relevant; `retrieved` is the ordered list returned
 * by the retriever (truncated to `k`).
 *
 * All metrics return a number in [0, 1].
 */

/**
 * Recall@K = |relevant ∩ retrieved@k| / |relevant|
 *
 * Returns 1 when `groundTruth` is empty (vacuously perfect).
 */
export function RecallAtK(
  groundTruth: string[],
  retrieved: string[],
  k: number,
): number {
  if (!Array.isArray(groundTruth) || groundTruth.length === 0) return 1;
  if (!Array.isArray(retrieved) || retrieved.length === 0) return 0;
  if (k <= 0) throw new Error("RecallAtK: k must be > 0");

  const gt = new Set(groundTruth);
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const id of topK) if (gt.has(id)) hits++;
  return hits / gt.size;
}

/**
 * Precision@K = |relevant ∩ retrieved@k| / K
 *
 * Returns 0 when `k <= 0`.
 */
export function PrecisionAtK(
  groundTruth: string[],
  retrieved: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  if (!Array.isArray(retrieved) || retrieved.length === 0) return 0;

  const gt = new Set(groundTruth);
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const id of topK) if (gt.has(id)) hits++;
  return hits / k;
}

/**
 * Mean Reciprocal Rank = 1 / rank_of_first_relevant_result
 *
 * Returns 0 if no relevant chunk appears in the top `k`.
 */
export function MRR(
  groundTruth: string[],
  retrieved: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  if (!Array.isArray(retrieved) || retrieved.length === 0) return 0;
  if (!Array.isArray(groundTruth) || groundTruth.length === 0) return 0;

  const gt = new Set(groundTruth);
  const topK = retrieved.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    if (gt.has(topK[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Normalised Discounted Cumulative Gain @ K (binary relevance).
 *
 * Uses the standard formulation: DCG = sum_{i=1..K} rel_i / log2(i + 1),
 * normalised by the ideal DCG (ground-truth items ranked first).
 */
export function NDCG(
  groundTruth: string[],
  retrieved: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  if (!Array.isArray(retrieved) || retrieved.length === 0) return 0;
  if (!Array.isArray(groundTruth) || groundTruth.length === 0) return 0;

  const gt = new Set(groundTruth);
  const topK = retrieved.slice(0, k);

  // DCG of the retrieved list (binary relevance)
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = gt.has(topK[i]) ? 1 : 0;
    if (rel > 0) {
      dcg += 1 / Math.log2(i + 2); // log2(rank+1)
    }
  }

  // Ideal DCG: the K most-relevant items (all relevant, binary) in the best order
  const idealHits = Math.min(k, gt.size);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Convenience aggregate: compute every metric at the same `k`.
 */
export interface RetrievalMetricScores {
  recall: number;
  precision: number;
  mrr: number;
  ndcg: number;
}

export function computeRetrievalMetrics(
  groundTruth: string[],
  retrieved: string[],
  k: number,
): RetrievalMetricScores {
  return {
    recall: RecallAtK(groundTruth, retrieved, k),
    precision: PrecisionAtK(groundTruth, retrieved, k),
    mrr: MRR(groundTruth, retrieved, k),
    ndcg: NDCG(groundTruth, retrieved, k),
  };
}
