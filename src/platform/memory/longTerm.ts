/**
 * Long-term store for cross-session user data (preferences, summaries, etc.).
 *
 * Returns a `BaseStore`:
 *  - `PostgresStore` (production) — backed by Postgres.
 *  - `InMemoryStore` (development) — non-persistent.
 *
 * Provides typed convenience helpers for per-user key/value preferences,
 * namespaced as `["user", <userId>, "preferences"]`.
 *
 * @see https://langchain-ai.github.io/langgraphjs/concepts/storage/
 */
import { InMemoryStore } from "@langchain/langgraph-checkpoint";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import type { BaseStore, Item } from "@langchain/langgraph-checkpoint";

import { env, postgresConnectionString } from "@/core/config/env.js";
import { logger } from "@/core/shared/logger.js";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let _store: BaseStore | undefined;
let _postgresStore: PostgresStore | undefined;

const PREFERENCES_PREFIX = "preferences" as const;

function preferencesNamespace(userId: string): string[] {
  return ["user", userId, PREFERENCES_PREFIX];
}

/**
 * Return a process-wide long-term store instance.
 */
export function getStore(): BaseStore {
  if (_store) return _store;

  if (env.NODE_ENV === "production") {
    logger.info(
      { host: env.POSTGRES_HOST, db: env.POSTGRES_DB },
      "Initializing Postgres long-term store for production",
    );
    _postgresStore = PostgresStore.fromConnString(postgresConnectionString());
    _store = _postgresStore;
  } else {
    logger.info("Initializing in-memory long-term store (NODE_ENV != production)");
    _store = new InMemoryStore();
  }
  return _store as BaseStore;
}

/**
 * Run one-time setup for the Postgres store (creates tables / indexes).
 * Idempotent; safe to call multiple times.
 */
export async function setupStore(): Promise<void> {
  if (env.NODE_ENV !== "production") return;
  // `_postgresStore` is the PostgresStore singleton — initialise lazily and
  // type-narrow before calling Postgres-specific methods.
  if (!_postgresStore) {
    getStore();
  }
  if (_postgresStore) {
    await _postgresStore.setup();
    logger.info("Postgres long-term store tables ensured");
  }
}

/**
 * Close the underlying Postgres pool (if any). Call on graceful shutdown.
 */
export async function closeStore(): Promise<void> {
  if (_postgresStore) {
    await _postgresStore.stop();
    _postgresStore = undefined;
    _store = undefined;
    logger.info("Postgres long-term store closed");
  }
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

/**
 * Persist a single user preference.
 *
 * @param userId   stable user identifier
 * @param key      preference key (e.g. "preferredLanguage", "theme")
 * @param value    arbitrary JSON-serialisable value
 */
export async function putUserPreference(
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const store = getStore();
  await store.put(preferencesNamespace(userId), key, { value });
  logger.debug({ userId, key }, "Stored user preference");
}

/**
 * Retrieve a single user preference. Returns `undefined` if not set.
 */
export async function getUserPreference<T = unknown>(
  userId: string,
  key: string,
): Promise<T | undefined> {
  const store = getStore();
  const item: Item | null = await store.get(preferencesNamespace(userId), key);
  if (!item) return undefined;
  const v = (item.value as { value?: T }).value;
  return v;
}

/**
 * Delete a user preference.
 */
export async function deleteUserPreference(
  userId: string,
  key: string,
): Promise<void> {
  const store = getStore();
  await store.delete(preferencesNamespace(userId), key);
  logger.debug({ userId, key }, "Deleted user preference");
}

// Re-exports
export { InMemoryStore, PostgresStore };
export type { BaseStore, Item };
