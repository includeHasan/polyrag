/**
 * CLI: ingest a single document.
 *
 * Usage: npm run ingest -- <path-or-url> [--tags tag1,tag2] [--department X]
 */
import "dotenv/config";
import { logger } from "@/shared/logger.js";
import { IngestRequestSchema, type IngestRequest } from "@/shared/types.js";
import { runIngestion } from "@/ingestion/pipeline.js";

function parseArgs(argv: string[]): IngestRequest {
  const positional = argv.filter((a) => !a.startsWith("--"));
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

  const target = positional[0];
  if (!target) {
    throw new Error("Usage: ingest <path-or-url> [--tags a,b,c] [--department X]");
  }

  const isUrl = /^https?:\/\//.test(target);
  const ext = target.split(".").pop()?.toLowerCase() ?? "";
  const source: IngestRequest["source"] = isUrl
    ? "url"
    : ext === "pdf"
      ? "pdf"
      : ext === "docx"
        ? "docx"
        : ext === "md" || ext === "markdown"
          ? "md"
          : "txt";

  const tags = (flags.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const department = flags.get("department");

  return IngestRequestSchema.parse({
    source,
    path: isUrl ? undefined : target,
    url: isUrl ? target : undefined,
    tags,
    department,
  });
}

async function main() {
  const request = parseArgs(process.argv.slice(2));
  logger.info({ request }, "Starting ingestion");
  const result = await runIngestion(request);
  logger.info(
    { jobId: result.jobId, documentId: result.documentId, chunkCount: result.chunkCount },
    "Ingestion complete",
  );
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Ingestion failed");
  process.exit(1);
});
