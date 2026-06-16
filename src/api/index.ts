/**
 * Public surface of the API layer.
 *
 * `src/server.ts` (the process entrypoint) should:
 *
 *   import { createServer, setQueryGraph } from "@/api/index.js";
 *   import { graph as queryGraph } from "@/agents/query/index.js";
 *
 *   const app = await createServer();
 *   await setQueryGraph(queryGraph);
 *   await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });
 */
export { createServer, getServer, resetServer, setQueryGraph } from "./server.js";
export type { ServerExtensions } from "./server.js";
export { buildErrorHandler } from "./middleware/errorHandler.js";
export { verifyAuth, requireUser } from "./middleware/auth.js";
export type { AuthUser } from "./middleware/auth.js";
export { registerRoutes } from "./routes/index.js";
export {
  healthRoutes,
  metricsRoutes,
  ingestRoutes,
  queryRoutes,
  searchRoutes,
  reindexRoutes,
  feedbackRoutes,
  evaluateRoutes,
} from "./routes/index.js";
