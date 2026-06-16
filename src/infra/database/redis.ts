/**
 * Redis (ioredis) singleton for caching, queues, and ephemeral state.
 *
 * The client is lazy — it is created on the first call to `getRedis()`
 * rather than at module-load time. Lifecycle is logged via the shared
 * pino logger.
 */
import { Redis } from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { env } from "@/core/config/env.js";
import { logger } from "@/core/shared/logger.js";
import { RagError } from "@/core/shared/errors.js";

let client: RedisClient | undefined;

/**
 * Return (and lazily build) the shared ioredis client.
 */
export function getRedis(): RedisClient {
  if (client) return client;

  client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on("connect", () => {
    logger.info({ host: env.REDIS_HOST, port: env.REDIS_PORT }, "Redis connected");
  });
  client.on("ready", () => {
    logger.info("Redis ready");
  });
  client.on("error", (err) => {
    logger.error({ err }, "Redis error");
  });
  client.on("close", () => {
    logger.warn("Redis connection closed");
  });
  client.on("reconnecting", (delay: number) => {
    logger.warn({ delay }, "Redis reconnecting");
  });

  return client;
}

/** Ping helper — useful for readiness probes. */
export async function pingRedis(): Promise<string> {
  try {
    return await getRedis().ping();
  } catch (cause) {
    throw new RagError(
      "REDIS_PING_ERROR",
      `Redis ping failed: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Gracefully close the redis client. Safe to call multiple times.
 */
export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch (cause) {
    logger.warn({ cause }, "Redis quit failed, forcing disconnect");
    client.disconnect();
  } finally {
    client = undefined;
  }
}
