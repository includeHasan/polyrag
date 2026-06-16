/**
 * Fastify server factory.
 *
 * `createServer()` builds and configures a Fastify instance with:
 *   - `@fastify/helmet` for security headers
 *   - `@fastify/cors` for cross-origin policy
 *   - `@fastify/sensible` for HTTP error helpers
 *   - pino child logger on every request
 *   - per-request id, start-time, and a global error handler that maps
 *     the platform's `RagError` taxonomy to HTTP status codes
 *   - all routes registered from `./routes`
 *
 * `getServer()` returns a process-wide singleton so the query graph can
 * be injected from `server.ts` (or tests) and reused by route handlers.
 */
import Fastify, { type FastifyInstance } from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyCors from "@fastify/cors";
import fastifySensible from "@fastify/sensible";
import { randomUUID } from "node:crypto";
import { logger } from "@/core/shared/logger.js";
import { env } from "@/core/config/env.js";
import { buildErrorHandler } from "./middleware/errorHandler.js";
import { registerRequestLogger } from "./middleware/requestLogger.js";
import { verifyAuth } from "./middleware/auth.js";
import { tenantContextMiddleware } from "./middleware/tenantContext.js";
import { registerRoutes } from "./routes/index.js";
import { registerSwagger } from "./swagger.js";
import { setQueryGraphModule, type CompiledQueryGraph } from "./deps.js";

/** Optional dependencies a route might need. Stored on the instance. */
export interface ServerExtensions {
  /** The compiled LangGraph query graph. Set via `setQueryGraph`. */
  graph: CompiledQueryGraph;
}

/** Augment FastifyInstance with our extensions. */
declare module "fastify" {
  interface FastifyInstance {
    graph: CompiledQueryGraph | null;
  }
}

let _server: FastifyInstance | null = null;

/**
 * Build a fully-wired Fastify instance. Safe to call multiple times —
 * each call returns an independent instance.
 */
export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    // Per-request id, used as the correlation id in logs and SSE headers.
    genReqId: (req) => {
      const inbound =
        (req.headers["x-request-id"] as string | undefined) ??
        (req.headers["x-correlation-id"] as string | undefined);
      return inbound || randomUUID();
    },
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10 MiB — generous for ingest payloads
  });

  // -------------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------------
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(fastifySensible);

  // -------------------------------------------------------------------------
  // OpenAPI / Swagger. MUST be registered before routes so its `onRoute`
  // hook captures them. Serves the spec at /docs/json and the UI at /docs.
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerSwagger(app as any);

  // -------------------------------------------------------------------------
  // Request-scoped hooks (id, start time, response log)
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerRequestLogger(app as any);

  // -------------------------------------------------------------------------
  // Auth preHandler. Populates `request.user`; never 401s on its own.
  // -------------------------------------------------------------------------
  app.addHook("preHandler", verifyAuth);
  app.addHook("preHandler", tenantContextMiddleware);

  // -------------------------------------------------------------------------
  // Global error handler — maps RagError → HTTP status.
  // -------------------------------------------------------------------------
  app.setErrorHandler(buildErrorHandler());

  // -------------------------------------------------------------------------
  // 404 fallback (defensive — fastify already has one, but this gives a
  // stable JSON envelope).
  // -------------------------------------------------------------------------
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `No route for ${request.method} ${request.url}`,
      },
    });
  });

  // -------------------------------------------------------------------------
  // Extensions — initialise the graph slot. The real graph is injected
  // at startup via `setQueryGraph` (or by tests).
  // -------------------------------------------------------------------------
  app.decorate<CompiledQueryGraph | null>("graph", null);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerRoutes(app as any);

  app.log.info(
    { env: env.NODE_ENV, host: env.SERVER_HOST, port: env.SERVER_PORT },
    "Fastify server constructed",
  );

  return app as unknown as FastifyInstance;
}

/**
 * Process-wide singleton. Built lazily on first call.
 * The server itself is created via `createServer()`; this wrapper
 * memoises the instance so the query graph (and any other
 * long-lived dependencies) can be set via the setters below and
 * picked up by route handlers via `getServer().graph`.
 */
export async function getServer(): Promise<FastifyInstance> {
  if (!_server) {
    _server = await createServer();
  }
  return _server;
}

/** Reset the singleton — primarily for tests. */
export function resetServer(): void {
  _server = null;
}

/**
 * Inject the compiled query graph. Typically called from
 * `src/server.ts` once the graph is compiled with its checkpointer.
 * Returns the same instance for fluent chaining.
 */
export async function setQueryGraph(
  graph: CompiledQueryGraph,
): Promise<FastifyInstance> {
  const app = await getServer();
  app.graph = graph;
  setQueryGraphModule(graph);
  return app;
}

/**
 * Synchronous variant used at boot when we already have the singleton.
 * No-op if `app` is not the singleton (e.g. in tests with multiple servers).
 */
export function setQueryGraphOnServer(
  app: FastifyInstance,
  graph: CompiledQueryGraph,
): void {
  app.graph = graph;
  setQueryGraphModule(graph);
}
