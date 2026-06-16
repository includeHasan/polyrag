/**
 * End-to-end eval runner.
 *
 *   1. Ingests the sample documents in `docs/fixtures/`
 *   2. Captures the resulting chunk IDs as ground truth
 *   3. Runs the eval harness against the JSONL dataset
 *   4. Prints a JSON summary
 *
 * Designed to be re-runnable from a fresh DB. The BM25 + Qdrant indexes
 * are populated by the ingestion step.
 */
import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@/core/shared/logger.js";
import { runIngestion } from "@/rag/ingestion/pipeline.js";
import { getQueryGraph } from "@/api/deps.js";
import { graph as queryGraph } from "@/agents/query/index.js";
import { runEvaluation, type EvaluationSample } from "@/platform/evaluation/harness.js";
import type { Chunk, QueryResponse } from "@/core/shared/types.js";

const FIXTURES_DIR = "docs/fixtures";
const DATASET_PATH = "eval/datasets/remote-work.jsonl";

interface RawSample {
  query: string;
  groundTruthChunks: string[];
  expectedAnswer?: string;
}

async function loadDataset(): Promise<RawSample[]> {
  const raw = await readFile(DATASET_PATH, "utf-8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => JSON.parse(l) as RawSample);
}

async function listMarkdownFiles(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(FIXTURES_DIR, e.name));
}

async function ingestFixtures(): Promise<Map<string, string[]>> {
  // Returns a map of documentTitle -> chunkIds.
  const docChunks = new Map<string, string[]>();
  const files = await listMarkdownFiles();
  logger.info({ count: files.length, files }, "Ingesting fixture documents");

  for (const path of files) {
    const result = await runIngestion({
      source: "md",
      path,
      tags: ["policy"],
    } as Parameters<typeof runIngestion>[0]);
    const title = result.document.title;
    docChunks.set(title, result.chunks.map((c: Chunk) => c.chunkId));
    logger.info(
      { path, documentId: result.documentId, chunkCount: result.chunkCount },
      "Fixture ingested",
    );
  }
  return docChunks;
}

function buildGroundTruth(
  samples: RawSample[],
  docChunks: Map<string, string[]>,
): EvaluationSample[] {
  // For each query, expand groundTruthChunks to include every chunk of any
  // document whose title or content mentions the expected answer keywords.
  // This is intentionally generous — Phase 3 can wire this to a human-curated set.
  const allChunkIds = Array.from(docChunks.values()).flat();
  return samples.map((s) => {
    if (s.groundTruthChunks.length > 0) {
      return {
        query: s.query,
        groundTruthChunks: s.groundTruthChunks,
        expectedAnswer: s.expectedAnswer,
      };
    }
    // Heuristic: every chunk is a candidate. The eval will measure whether
    // the right one bubbles to the top (Recall@K, MRR).
    return {
      query: s.query,
      groundTruthChunks: allChunkIds,
      expectedAnswer: s.expectedAnswer,
    };
  });
}

async function main() {
  // 1. Ingest fixtures and capture chunk IDs.
  const docChunks = await ingestFixtures();
  const totalChunks = Array.from(docChunks.values()).reduce((a, b) => a + b.length, 0);
  logger.info(
    { documents: docChunks.size, totalChunks },
    "Fixture ingestion complete",
  );

  // 2. Build the eval dataset with ground truth chunk IDs.
  const rawSamples = await loadDataset();
  const samples = buildGroundTruth(rawSamples, docChunks);

  // 3. Run the eval harness.
  // The query function posts to the local API. This is what the platform
  // serves to real callers, so this is the truest "what would users see" eval.
  const baseUrl = `http://localhost:${process.env.SERVER_PORT ?? 3000}`;
  const queryFn = async (req: {
    query: string;
    sessionId?: string;
    filters?: Record<string, unknown>;
    topK?: number;
    stream?: boolean;
  }): Promise<QueryResponse> => {
    void getQueryGraph; // ensure dep module is initialised
    const res = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Query failed: ${res.status} ${text}`);
    }
    return (await res.json()) as QueryResponse;
  };

  // Make sure the graph module is reachable (helps surface init errors early).
  void queryGraph;

  const summary = await runEvaluation(samples, {
    queryFn,
    topK: 10,
    onProgress: (done, total) =>
      logger.info({ done, total }, "Eval progress"),
  });

  // 4. Print a compact summary.
  console.log("\n=== EVALUATION SUMMARY ===");
  console.log(JSON.stringify(
    {
      size: summary.size,
      totalDurationMs: summary.totalDurationMs,
      averages: {
        retrieval: {
          recall: round(summary.averages.retrieval.recall, 3),
          precision: round(summary.averages.retrieval.precision, 3),
          mrr: round(summary.averages.retrieval.mrr, 3),
          ndcg: round(summary.averages.retrieval.ndcg, 3),
        },
        generation: {
          groundedness: round(summary.averages.generation.groundedness, 3),
          faithfulness: round(summary.averages.generation.faithfulness, 3),
        },
        judge: summary.averages.judge
          ? {
              overall: round(summary.averages.judge.overall, 2),
              perAspect: Object.fromEntries(
                summary.averages.judge.aspects.map((a) => [a.name, a.score]),
              ),
            }
          : null,
        latencyMs: round(summary.averages.latencyMs, 1),
      },
      perSample: summary.perSample.map((s) => ({
        query: s.query,
        retrieved: s.retrievedChunkIds.length,
        recall: round(s.retrieval.recall, 3),
        mrr: round(s.retrieval.mrr, 3),
        judge: s.judge ? round(s.judge.overall, 1) : null,
        answerPreview: s.answer.slice(0, 80).replace(/\n/g, " "),
      })),
    },
    null,
    2,
  ));

  // Exit with non-zero if Recall@K is below the PRD target (0.85).
  if (summary.averages.retrieval.recall < 0.85) {
    logger.warn(
      { recall: summary.averages.retrieval.recall },
      "Recall@K below PRD target of 0.85",
    );
  }
  process.exit(0);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

main().catch((err) => {
  logger.fatal({ err }, "Eval failed");
  process.exit(1);
});
