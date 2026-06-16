/**
 * Application entry point.
 *
 * Wires the Fastify server, sets up observability, runs migrations, and starts
 * the query graph. Importable for tests; `main()` runs in the main module.
 */
import "dotenv/config";
import { env } from "@/config/env.js";
import { serverConfig } from "@/config/index.js";
import { logger } from "@/shared/logger.js";
import { createServer } from "@/api/server.js";
import { graph as queryGraph } from "@/agents/query/index.js";
import { runMigrations } from "@/database/migrations/index.js";
import { getCheckpointer } from "@/memory/session.js";
import { getVectorStore } from "@/database/qdrant.js";
import { getEmbeddingProvider } from "@/embeddings/factory.js";
import { ensureBucket } from "@/database/s3.js";

async function bootstrap() {
  logger.info({ env: env.NODE_ENV, port: serverConfig.port }, "Bootstrapping RAG platform");

  // 1. Run database migrations (idempotent).
  try {
    await runMigrations();
    logger.info("Database migrations applied");
  } catch (err) {
    logger.error({ err }, "Migration failed; continuing — non-critical tables will retry");
  }

  // 2. Set up the LangGraph Postgres checkpointer.
  try {
    const checkpointer = getCheckpointer();
    if ("setup" in checkpointer && typeof (checkpointer as { setup?: () => Promise<void> }).setup === "function") {
      await (checkpointer as { setup: () => Promise<void> }).setup();
      logger.info("Checkpointer tables ready");
    }
  } catch (err) {
    logger.warn({ err }, "Checkpointer setup failed; falling back to in-memory saver");
  }

  // 3. Ensure the Qdrant collection exists.
  try {
    const vs = getVectorStore();
    await vs.ensureCollection(vs.name, getEmbeddingProvider().dimension);
    logger.info({ collection: vs.name }, "Vector store collection ready");
  } catch (err) {
    logger.warn({ err }, "Vector store collection init failed; will retry on first write");
  }

  // 4. Ensure the S3 bucket exists (no-op if MinIO not reachable).
  try {
    await ensureBucket();
    logger.info({ bucket: env.S3_BUCKET }, "S3 bucket ready");
  } catch (err) {
    logger.warn({ err }, "S3 bucket init failed; document upload will be unavailable");
  }

  // 5. Build the Fastify server and register the query graph.
  const server = await createServer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).graph = queryGraph;

  // 6. Start listening.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (server as any).listen({ host: serverConfig.host, port: serverConfig.port });
  logger.info(
    { host: serverConfig.host, port: serverConfig.port },
    "RAG platform ready — POST /api/query, POST /api/ingest",
  );

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (server as any).close();
    } catch (err) {
      logger.error({ err }, "Error during server close");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Run the bootstrap in the main module; tests can import the modules
// without auto-starting the server.
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  bootstrap().catch((err) => {
    logger.fatal({ err }, "Bootstrap failed");
    process.exit(1);
  });
}

export { bootstrap };
