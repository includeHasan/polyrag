/**
 * Redis-backed embedding cache. Wraps any `EmbeddingProvider` so callers can
 * compose caching around the underlying model without changing the call sites.
 *
 *   const provider = new CachedEmbeddingProvider(new OpenAIEmbeddingProvider());
 *
 * Cache key: sha256(`<model>` || `|` || `<text>`)
 * Value:     the raw embedding vector, JSON-encoded.
 * TTL:       30 days (embeddings are stable for a fixed model + input).
 *
 * A pipeline is used to issue `MGET` / `MSET` for batches, so a cache hit on
 * a 100-chunk batch costs two round-trips instead of 200.
 */
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { env, redisConnectionOptions } from "@/core/config/env.js";
import { IngestionError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import { BaseEmbeddingProvider, type EmbeddingProvider } from "./base.js";

const KEY_PREFIX = "emb:";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export class CachedEmbeddingProvider extends BaseEmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  private readonly inner: EmbeddingProvider;
  private readonly redis: Redis;
  private readonly ownsRedis: boolean;

  constructor(inner: EmbeddingProvider, redis?: Redis) {
    super();
    this.inner = inner;
    this.model = inner.model;
    this.dimension = inner.dimension;
    if (redis) {
      this.redis = redis;
      this.ownsRedis = false;
    } else {
      this.redis = new Redis({
        ...redisConnectionOptions(),
        // Lazy connect so importing this module doesn't fail in test envs
        // without a running Redis. The first call will connect.
        lazyConnect: true,
        maxRetriesPerRequest: 2,
      });
      this.ownsRedis = true;
    }
  }

  private key(text: string): string {
    const hash = createHash("sha256").update(text).digest("hex");
    return `${KEY_PREFIX}${this.model}:${hash}`;
  }

  async embed(text: string): Promise<number[]> {
    const k = this.key(text);
    try {
      const cached = await this.redis.get(k);
      if (cached) {
        return JSON.parse(cached) as number[];
      }
    } catch (err) {
      // Cache failures must never break ingestion; fall through to the model.
      logger.warn({ err: (err as Error).message }, "embedding cache GET failed");
    }
    const vec = await this.inner.embed(text);
    try {
      await this.redis.set(k, JSON.stringify(vec), "EX", TTL_SECONDS);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "embedding cache SET failed");
    }
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const keys = texts.map((t) => this.key(t));

    let cached: (string | null)[] = [];
    try {
      cached = await this.redis.mget(...keys);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "embedding cache MGET failed");
      cached = new Array(texts.length).fill(null);
    }

    const result: (number[] | null)[] = cached.map((v) =>
      v ? (JSON.parse(v) as number[]) : null,
    );

    const missingIdx: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (result[i] === null) missingIdx.push(i);
    }

    if (missingIdx.length > 0) {
      const missingTexts = missingIdx.map((i) => texts[i]);
      const fresh = await this.inner.embedBatch(missingTexts);
      if (fresh.length !== missingIdx.length) {
        throw new IngestionError(
          `embedBatch length mismatch: requested ${missingIdx.length}, got ${fresh.length}`,
        );
      }

      // Pipeline the writes so we only pay one round-trip for the batch.
      const pipe = this.redis.pipeline();
      for (let j = 0; j < missingIdx.length; j++) {
        const idx = missingIdx[j];
        const vec = fresh[j];
        result[idx] = vec;
        pipe.set(keys[idx], JSON.stringify(vec), "EX", TTL_SECONDS);
      }
      try {
        await pipe.exec();
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          "embedding cache MSET failed (writes dropped)",
        );
      }
    }

    return result.map((v) => {
      if (v === null) {
        throw new IngestionError("embedBatch produced a null vector after fill");
      }
      return v;
    });
  }

  async dispose(): Promise<void> {
    const innerBase = this.inner as EmbeddingProvider & { dispose?: () => Promise<void> };
    await innerBase.dispose?.();
    if (this.ownsRedis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}

// Silence "env unused" if tree-shaking prunes the import in some builds.
void env;
