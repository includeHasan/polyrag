/**
 * Zod-validated environment configuration. Import `env` from this file
 * anywhere; never read process.env directly elsewhere.
 */
import "dotenv/config";
import { z } from "zod";
import { ConfigurationError } from "@/core/shared/errors.js";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL_GENERATION: z.string().default("gpt-4o"),
  OPENAI_MODEL_EVALUATION: z.string().default("gpt-4o-mini"),
  OPENAI_MODEL_RERANK: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),

  // LangSmith
  LANGSMITH_TRACING: z.coerce.boolean().default(false),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("advanced-rag-platform"),
  LANGSMITH_ENDPOINT: z.string().default("https://api.smith.langchain.com"),

  // Qdrant
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default("chunks"),

  // Postgres
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_USER: z.string().default("rag"),
  POSTGRES_PASSWORD: z.string().default("rag"),
  POSTGRES_DB: z.string().default("rag"),
  DATABASE_URL: z.string().optional(),

  // Redis
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().default("http://localhost:9200"),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  ELASTICSEARCH_INDEX: z.string().default("chunks"),

  // S3
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("rag-documents"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // Retrieval
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(10),
  RETRIEVAL_RERANK_TOP_K: z.coerce.number().int().positive().default(20),
  RERANKER_ENABLED: z.coerce.boolean().default(false),
  HYBRID_SEARCH_ENABLED: z.coerce.boolean().default(false),

  // Chunking
  CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(150),
  CHUNKER_STRATEGY: z.enum(["fixed", "recursive", "semantic", "agentic"]).default("recursive"),

  // Server
  SERVER_HOST: z.string().default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),

  // Security
  JWT_SECRET: z.string().default("change-me-in-prod"),
  JWT_EXPIRES_IN: z.string().default("24h"),
});

export type Env = z.infer<typeof Schema>;

function parseEnv(): Env {
  const result = Schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ConfigurationError(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv();

// Convenience accessors --------------------------------------------------------
export const postgresConnectionString = () =>
  env.DATABASE_URL ??
  `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;

export const redisConnectionOptions = () => ({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
});
