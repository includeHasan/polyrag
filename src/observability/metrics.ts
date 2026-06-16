/**
 * In-memory metrics.
 *
 * Phase 1 implementation: simple counters + bucketed histograms, kept in
 * process memory. Suitable for the dev server and for emitting to logs or
 * scraping on `/metrics`. Phase 3 will replace this with a real OpenTelemetry
 * exporter; the public API is designed to be stable so call sites don't
 * have to change.
 *
 * - Counters:  `queriesTotal`, `ingestionsTotal`, `errorsTotal`.
 * - Histograms (simple fixed buckets in ms / tokens):
 *      `queryLatencyMs`, `llmTokensTotal`.
 */

import { logger } from "../shared/logger.js";

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

const counters: Record<string, number> = {
  queriesTotal: 0,
  ingestionsTotal: 0,
  errorsTotal: 0,
};

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

/** Default bucket boundaries for query latency (milliseconds). */
const LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/** Default bucket boundaries for LLM token usage. */
const TOKENS_BUCKETS = [50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000];

interface HistogramState {
  count: number;
  sum: number;
  min: number;
  max: number;
  /** Cumulative counts at each bucket boundary (upper bound). */
  buckets: { le: number; count: number }[];
}

function emptyHistogram(boundaries: number[]): HistogramState {
  const buckets = boundaries.map((le) => ({ le, count: 0 }));
  return { count: 0, sum: 0, min: Infinity, max: -Infinity, buckets };
}

function observe(h: HistogramState, value: number, boundaries: number[]): void {
  h.count++;
  h.sum += value;
  if (value < h.min) h.min = value;
  if (value > h.max) h.max = value;
  for (const b of h.buckets) {
    if (value <= b.le) b.count++;
  }
  void boundaries;
}

const histograms: Record<string, HistogramState> = {
  queryLatencyMs: emptyHistogram(LATENCY_BUCKETS_MS),
  llmTokensTotal: emptyHistogram(TOKENS_BUCKETS),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Increment a named counter by 1. Throws if the counter isn't known. */
export function incrCounter(name: keyof typeof counters): void {
  if (!(name in counters)) {
    counters[name] = 0;
  }
  counters[name]++;
}

/**
 * Record a latency observation (milliseconds) into the `queryLatencyMs`
 * histogram. Convenience wrapper around the generic `recordObservation`.
 */
export function recordLatency(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    logger.warn({ ms }, "recordLatency: ignoring non-finite/negative value");
    return;
  }
  observe(histograms.queryLatencyMs, ms, LATENCY_BUCKETS_MS);
}

/**
 * Record an LLM token-usage observation. Convenience wrapper.
 */
export function recordTokens(tokens: number): void {
  if (!Number.isFinite(tokens) || tokens < 0) return;
  observe(histograms.llmTokensTotal, tokens, TOKENS_BUCKETS);
}

/** Generic histogram observation. */
export function recordObservation(
  name: keyof typeof histograms,
  value: number,
): void {
  const h = histograms[name];
  if (!h) return;
  observe(h, value, h.buckets.map((b) => b.le));
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<
    string,
    {
      count: number;
      sum: number;
      min: number;
      max: number;
      mean: number;
      buckets: { le: number; count: number }[];
    }
  >;
  timestamp: string;
}

/**
 * Return a deep-copy snapshot of all metrics. Safe to serialise.
 */
export function getMetrics(): MetricsSnapshot {
  const out: MetricsSnapshot = {
    counters: { ...counters },
    histograms: {},
    timestamp: new Date().toISOString(),
  };
  for (const [name, h] of Object.entries(histograms)) {
    out.histograms[name] = {
      count: h.count,
      sum: h.sum,
      min: h.count > 0 ? h.min : 0,
      max: h.count > 0 ? h.max : 0,
      mean: h.count > 0 ? h.sum / h.count : 0,
      buckets: h.buckets.map((b) => ({ le: b.le, count: b.count })),
    };
  }
  return out;
}

/** Reset all metrics — primarily for tests. */
export function resetMetrics(): void {
  for (const k of Object.keys(counters)) counters[k] = 0;
  for (const k of Object.keys(histograms)) {
    const bounds = histograms[k].buckets.map((b) => b.le);
    histograms[k] = emptyHistogram(bounds);
  }
}
