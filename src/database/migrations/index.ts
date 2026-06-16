/**
 * Simple migration runner.
 *
 *   • Discovers every `*.sql` file in this directory.
 *   • Executes them in lexical (numerically-sorted) order.
 *   • Tracks applied migrations in a `_migrations` table so each file runs
 *     exactly once.
 *
 * Each migration runs inside a transaction. Failures roll back the entire
 * migration and re-throw as a `RagError` so the caller can decide how to
 * surface the error.
 *
 * Idempotency: the runner is safe to call multiple times — already-applied
 * files are skipped.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { logger } from "../../shared/logger.js";
import { RagError } from "../../shared/errors.js";
import { withTransaction, getPool } from "../postgres.js";

const MIGRATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * List migration filenames in lexically-sorted order.
 * Excludes this file (`index.ts`) and non-SQL files.
 */
async function listMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** Read raw SQL for a single migration file. */
async function readMigration(name: string): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, name), "utf8");
}

/** Return the set of migrations that have already been applied. */
async function appliedMigrations(): Promise<Set<string>> {
  // Ensure the tracking table exists before we query it.
  await getPool().query(SCHEMA_SQL);
  const res = await getPool().query<{ name: string }>(
    "SELECT name FROM _migrations",
  );
  return new Set(res.rows.map((r) => r.name));
}

/**
 * Apply every pending migration. Returns the list of migrations that were
 * applied during this run (empty when everything is up-to-date).
 */
export async function runMigrations(): Promise<string[]> {
  const all = await listMigrations();
  const already = await appliedMigrations();
  const pending = all.filter((name) => !already.has(name));

  if (pending.length === 0) {
    logger.info("No pending migrations");
    return [];
  }

  const applied: string[] = [];
  for (const name of pending) {
    const sql = await readMigration(name);
    logger.info({ migration: name }, "Applying migration");
    try {
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query("INSERT INTO _migrations(name) VALUES ($1)", [name]);
      });
      applied.push(name);
    } catch (cause) {
      throw new RagError(
        "POSTGRES_MIGRATION_ERROR",
        `Migration ${name} failed: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
  }

  logger.info({ applied }, "Migrations complete");
  return applied;
}

/**
 * Status report — useful for `db:status`-style CLI commands.
 */
export async function migrationStatus(): Promise<{
  applied: string[];
  pending: string[];
}> {
  const all = await listMigrations();
  const already = await appliedMigrations();
  return {
    applied: all.filter((n) => already.has(n)),
    pending: all.filter((n) => !already.has(n)),
  };
}
