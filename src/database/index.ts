/**
 * Storage layer barrel — re-exports the public surface of `src/database/`.
 *
 * Consumers should import from here, not from individual files, so the rest
 * of the codebase is decoupled from the file layout.
 */
export * from "./postgres.js";
export * from "./redis.js";
export * from "./s3.js";
export * from "./qdrant.js";
export * from "./elasticsearch.js";
export {
  runMigrations,
  migrationStatus,
} from "./migrations/index.js";
