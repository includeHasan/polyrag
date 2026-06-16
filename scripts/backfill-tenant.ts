import "dotenv/config";
import pg from "pg";
import { logger } from "@/shared/logger.js";

const TABLES: string[] = [
  "users",
  "documents",
  "query_logs",
  "feedback",
  "sessions",
  "user_preferences",
  "ingestion_jobs",
  "document_permissions",
  "entities",
];

async function getDefaultTenantId(client: pg.PoolClient): Promise<string> {
  await client.query(
    `INSERT INTO tenants (id, slug, name, status)
     VALUES (gen_random_uuid(), 'default', 'Default Tenant', 'ACTIVE')
     ON CONFLICT (slug) DO NOTHING`,
  );

  const result = await client.query<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'default'`,
  );

  return result.rows[0].id;
}

async function main(): Promise<void> {
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const defaultTenantId = await getDefaultTenantId(client);
    logger.info({ defaultTenantId }, "Default tenant resolved");

    const summary: Record<string, number> = {};

    for (const table of TABLES) {
      const result = await client.query(
        `UPDATE ${table} SET "tenantId" = $1 WHERE "tenantId" IS NULL`,
        [defaultTenantId],
      );
      summary[table] = result.rowCount ?? 0;
    }

    await client.query("COMMIT");

    logger.info({ summary }, "Backfill complete");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Backfill failed — transaction rolled back");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  logger.fatal({ err }, "backfill-tenant script failed");
  process.exit(1);
});
