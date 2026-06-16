/**
 * Postgres connection pool (singleton).
 *
 * Exposes:
 *   - `pool`           — the underlying `pg.Pool` for advanced use.
 *   - `query(text, params)` — single-shot helper.
 *   - `withTransaction(fn)` — runs `fn(client)` inside BEGIN/COMMIT/ROLLBACK.
 *
 * The pool is lazy-initialised; nothing connects at import time. Call
 * `getPool()` (or invoke `query` / `withTransaction`) to materialise it.
 */
import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "@/core/config/env.js";
import { logger } from "@/core/shared/logger.js";
import { RagError } from "@/core/shared/errors.js";

let pool: pg.Pool | undefined;

/**
 * Build (or return) the process-wide pg.Pool.
 * Idempotent — first call connects, subsequent calls return the cached pool.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;

  pool = new pg.Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (err) => {
    logger.error({ err }, "Postgres pool error");
  });

  logger.info(
    {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
    },
    "Postgres pool created",
  );

  return pool;
}

/** Re-export the (lazy) pool. Use `getPool()` to actually obtain it. */
export { getPool as pool };

/**
 * Run a parameterised query against the pool.
 * Throws `RagError("POSTGRES_QUERY_ERROR", ...)` on failure.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResult<T>> {
  try {
    return await getPool().query<T>(text, params as unknown[]);
  } catch (cause) {
    throw new RagError(
      "POSTGRES_QUERY_ERROR",
      `Postgres query failed: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Run a function inside a transaction. The provided `client` is checked-out
 * from the pool for the duration of the callback. Commits on success, rolls
 * back on throw, and always releases the client.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (cause) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, "Postgres rollback failed");
    }
    throw new RagError(
      "POSTGRES_TX_ERROR",
      `Postgres transaction failed: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  } finally {
    client.release();
  }
}

/**
 * Gracefully drain the pool. Call this from a shutdown hook.
 */
export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
  logger.info("Postgres pool closed");
}
