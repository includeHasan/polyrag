/**
 * LangSmith observability setup.
 *
 * At module load, if `LANGSMITH_TRACING` is enabled and an `LANGSMITH_API_KEY`
 * is configured, we set the canonical env vars that the LangChain SDKs look
 * for (`LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`,
 * `LANGSMITH_ENDPOINT`). This means any LangChain / LangGraph call anywhere
 * in the app will automatically be traced.
 *
 * `getClient()` returns a `langsmith.Client` for explicit operations
 * (uploading datasets, fetching runs, etc.).
 *
 * @see https://docs.smith.langchain.com/
 */
import { Client } from "langsmith";

import { env } from "@/core/config/env.js";
import { logger } from "@/core/shared/logger.js";

// ---------------------------------------------------------------------------
// Module-load side effects: configure env for downstream LangChain code.
// ---------------------------------------------------------------------------

if (env.LANGSMITH_TRACING) {
  if (!env.LANGSMITH_API_KEY) {
    logger.warn(
      "LANGSMITH_TRACING=true but LANGSMITH_API_KEY is not set — LangSmith tracing will be disabled",
    );
  } else {
    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
    process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
    process.env.LANGSMITH_ENDPOINT = env.LANGSMITH_ENDPOINT;
    logger.info(
      { project: env.LANGSMITH_PROJECT, endpoint: env.LANGSMITH_ENDPOINT },
      "LangSmith tracing enabled",
    );
  }
} else {
  logger.debug("LangSmith tracing disabled (LANGSMITH_TRACING=false)");
}

// ---------------------------------------------------------------------------
// Lazy singleton client
// ---------------------------------------------------------------------------

let _client: Client | undefined;

/**
 * Return a process-wide LangSmith `Client`.
 *
 * Throws if tracing is disabled / misconfigured, since the client is not
 * useful in that case.
 */
export function getClient(): Client {
  if (_client) return _client;

  if (!env.LANGSMITH_API_KEY) {
    throw new Error(
      "LangSmith client requested but LANGSMITH_API_KEY is not configured",
    );
  }

  _client = new Client({
    apiKey: env.LANGSMITH_API_KEY,
    apiUrl: env.LANGSMITH_ENDPOINT,
  });
  // The Client constructor doesn't take a project name; the project is
  // picked up from the `LANGSMITH_PROJECT` env var (already set above).
  logger.debug({ project: env.LANGSMITH_PROJECT }, "Created LangSmith Client");
  return _client;
}

/**
 * Cheap, non-throwing probe: do we have everything we need to talk to
 * LangSmith?
 */
export function isLangSmithEnabled(): boolean {
  return Boolean(env.LANGSMITH_TRACING && env.LANGSMITH_API_KEY);
}

export { Client };
