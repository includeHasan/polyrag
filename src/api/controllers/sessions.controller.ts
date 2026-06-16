/**
 * Sessions controllers — validate params/query, resolve the query graph off
 * the server, delegate to `services/sessions.service.ts`, and shape the
 * HTTP response (including the 400/503/500 error envelopes).
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getServer } from "@/api/server.js";
import { logger } from "@/core/shared/logger.js";
import {
  fetchSessionHistory,
  fetchSessionState,
  type HistoryResponse,
} from "../services/sessions.service.js";

const ParamsSchema = z.object({
  id: z.string().min(1, "session id (thread_id) is required"),
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * GET /api/sessions/:id/history
 *   - Returns the full checkpoint history for the given thread_id.
 */
export async function sessionHistory(request: FastifyRequest, reply: FastifyReply) {
  const params = ParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ error: params.error.flatten() });
  }
  const query = QuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.code(400).send({ error: query.error.flatten() });
  }

  const sessionId = params.data.id;
  const limit = query.data.limit ?? 50;

  const server = await getServer();
  const graph = server.graph;
  if (!graph) {
    return reply.code(503).send({ error: "Query graph not initialised" });
  }

  try {
    const response: HistoryResponse = await fetchSessionHistory(graph, sessionId, limit);
    logger.debug({ sessionId, count: response.count }, "Session history fetched");
    return response;
  } catch (err) {
    request.log.error({ err, sessionId }, "Failed to fetch session history");
    return reply.code(500).send({
      error: {
        code: "SESSION_HISTORY_ERROR",
        message: (err as Error).message,
      },
    });
  }
}

/**
 * GET /api/sessions/:id/state
 *   - Returns the latest state snapshot for a given session.
 *   - Useful as a "give me what the conversation looks like now" endpoint.
 */
export async function sessionState(request: FastifyRequest, reply: FastifyReply) {
  const params = ParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.code(400).send({ error: params.error.flatten() });
  }
  const sessionId = params.data.id;

  const server = await getServer();
  const graph = server.graph;
  if (!graph) {
    return reply.code(503).send({ error: "Query graph not initialised" });
  }

  try {
    return await fetchSessionState(graph, sessionId);
  } catch (err) {
    request.log.error({ err, sessionId }, "Failed to fetch session state");
    return reply.code(500).send({
      error: {
        code: "SESSION_STATE_ERROR",
        message: (err as Error).message,
      },
    });
  }
}
