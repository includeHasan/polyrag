/**
 * CLI: run a single query against the local API.
 *
 * Usage: npm run query -- "What is the policy on remote work?" [--session-id X]
 */
import "dotenv/config";
import { logger } from "@/shared/logger.js";
import { env } from "@/config/env.js";

function parseArgs(argv: string[]): { query: string; sessionId?: string; stream: boolean } {
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
  const query = positional[0];
  if (!query) throw new Error('Usage: query "your question" [--session-id X] [--stream]');
  return {
    query,
    sessionId: flags.get("session-id"),
    stream: flags.get("stream") === "true",
  };
}

async function main() {
  const { query, sessionId, stream } = parseArgs(process.argv.slice(2));
  const res = await fetch(`http://localhost:${env.SERVER_PORT}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, sessionId, stream }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, "Query failed");
    process.exit(1);
  }

  if (stream) {
    // Stream tokens from SSE.
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error("No response body");
    process.stdout.write("\nAnswer: ");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      process.stdout.write(decoder.decode(value, { stream: true }));
    }
    process.stdout.write("\n");
  } else {
    const body = await res.json() as { answer: string; sources: Array<{ title: string; page?: number; chunkId?: string }>; metrics?: unknown };
    console.log("\n=== ANSWER ===");
    console.log(body.answer);
    console.log("\n=== SOURCES ===");
    for (const s of body.sources ?? []) {
      console.log(`  - ${s.title}${s.page ? ` (p.${s.page})` : ""} [${s.chunkId}]`);
    }
    console.log("\n=== METRICS ===");
    console.log(body.metrics);
  }
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Query failed");
  process.exit(1);
});
