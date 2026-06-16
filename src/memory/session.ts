/**
 * LangGraph checkpointer setup.
 *
 * Provides `getCheckpointer()` returning a `BaseCheckpointSaver` implementation:
 *  - `PostgresSaver` (production) backed by `POSTGRES_*` env vars.
 *  - `MemorySaver`   (development / test) — in-process, non-persistent.
 *
 * `setupCheckpointer()` is idempotent and should be called once at boot to
 * create the required tables for the Postgres checkpointer.
 *
 * @see https://langchain-ai.github.io/langgraphjs/concepts/persistence/
 */
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import { env, postgresConnectionString } from "../config/env.js";
import { logger } from "../shared/logger.js";

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------
let _checkpointer: BaseCheckpointSaver | undefined;
let _postgresSaver: PostgresSaver | undefined;

/**
 * Return a process-wide checkpointer instance.
 *
 * - In `production`: `PostgresSaver` constructed from `POSTGRES_*` env.
 * - Otherwise: `MemorySaver` (in-process, no persistence).
 */
export function getCheckpointer(): BaseCheckpointSaver {
  if (_checkpointer) return _checkpointer;

  if (env.NODE_ENV === "production") {
    logger.info(
      { host: env.POSTGRES_HOST, db: env.POSTGRES_DB },
      "Initializing Postgres checkpointer for production",
    );
    _postgresSaver = PostgresSaver.fromConnString(postgresConnectionString());
    _checkpointer = _postgresSaver;
  } else {
    logger.info(
      "Initializing in-memory checkpointer (NODE_ENV != production)",
    );
    _checkpointer = new MemorySaver();
  }
  return _checkpointer;
}

/**
 * Run one-time DB setup for the Postgres checkpointer. No-op for MemorySaver.
 *
 * Safe to call multiple times — the underlying `.setup()` is idempotent.
 */
export async function setupCheckpointer(): Promise<void> {
  if (env.NODE_ENV !== "production") {
    logger.debug("Skipping checkpointer setup in non-production env");
    return;
  }
  const cp = getCheckpointer();
  if (cp instanceof PostgresSaver) {
    await cp.setup();
    logger.info("Postgres checkpointer tables ensured");
  }
}

/**
 * Close the underlying Postgres pool (if any). Call on graceful shutdown.
 */
export async function closeCheckpointer(): Promise<void> {
  if (_postgresSaver) {
    await _postgresSaver.end();
    _postgresSaver = undefined;
    _checkpointer = undefined;
    logger.info("Postgres checkpointer closed");
  }
}

// Re-export for convenience
export { MemorySaver, PostgresSaver };
export type { BaseCheckpointSaver };
