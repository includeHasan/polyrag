/**
 * CLI: run an evaluation harness against a JSONL dataset.
 *
 * Usage: npm run eval -- --dataset ./eval/devset.jsonl
 *
 * Each line of the dataset is a JSON object:
 *   { "query": "...", "groundTruthChunks": ["chunkId1", "chunkId2"], "expectedAnswer"?: "..." }
 */
import "dotenv/config";
import { logger } from "@/core/shared/logger.js";
import { runEvaluation } from "@/platform/evaluation/harness.js";
import { readFile } from "node:fs/promises";

function parseArgs(argv: string[]): { datasetPath: string } {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        flags.set(key, val);
        i++;
      } else {
        flags.set(key, "true");
      }
    }
  }
  const datasetPath = flags.get("dataset");
  if (!datasetPath) throw new Error("Usage: eval --dataset <path.jsonl>");
  return { datasetPath };
}

async function main() {
  const { datasetPath } = parseArgs(process.argv.slice(2));
  const raw = await readFile(datasetPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const dataset = lines.map((l) => JSON.parse(l));
  logger.info({ count: dataset.length, datasetPath }, "Running evaluation");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const report = await runEvaluation(dataset, { queryFn: async () => ({ answer: "", sources: [] }) } as any);
  console.log("\n=== EVALUATION REPORT ===");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Evaluation failed");
  process.exit(1);
});
