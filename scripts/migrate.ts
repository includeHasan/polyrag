/**
 * CLI: run database migrations.
 */
import "dotenv/config";
import { logger } from "@/shared/logger.js";
import { runMigrations, migrationStatus } from "@/database/migrations/index.js";

async function main() {
  const status = await migrationStatus();
  logger.info({ applied: status.applied, pending: status.pending }, "Migration status");
  if (status.pending.length === 0) {
    logger.info("No migrations to apply");
    process.exit(0);
  }
  await runMigrations();
  logger.info("Migrations applied");
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Migrations failed");
  process.exit(1);
});
