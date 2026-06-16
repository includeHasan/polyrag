/**
 * Phase 3: Session history endpoint.
 *
 * GET /api/sessions/:id/history
 *   - Returns the full checkpoint history for the given thread_id.
 *   - Each entry is a `StateSnapshot` from the LangGraph checkpointer.
 *   - Materialises the async iterator into JSON for the API consumer.
 *
 * This is the user-facing surface over `getStateHistory` from
 * `src/memory/checkpoint.ts`. Useful for debugging, time-travel UIs, and
 * auditing.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getServer } from "@/api/server.js";
import { getStateHistory, type StateSnapshot } from "@/memory/checkpoint.js";
import { logger } from "@/shared/logger.js";

const ParamsSchema = z.object({
  id: z.string().min(1, "session id (thread_id) is required"),
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

interface HistoryResponse {
  sessionId: string;
  count: number;
  history: Array<{
    createdAt?: string;
    next: string[];
    finalAnswerPreview: string;
    queryPreview: string;
    retrievedChunkCount: number;
    sourceCount: number;
    groundednessScore?: number;
    approved?: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

function preview(text: string | undefined, max = 100): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sessions/:id/history", async (request, reply) => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snapshots: StateSnapshot[] = await getStateHistory(graph as any, {
        configurable: { thread_id: sessionId },
      });

      const sliced = snapshots.slice(0, limit);
      const history = sliced.map((snap) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = snap.values as any;
        return {
          createdAt: snap.createdAt,
          next: snap.next,
          queryPreview: preview(v?.query),
          finalAnswerPreview: preview(v?.finalAnswer ?? v?.draftAnswer, 200),
          retrievedChunkCount: v?.retrievedChunks?.length ?? 0,
          sourceCount: v?.sources?.length ?? 0,
          groundednessScore: v?.groundednessScore,
          approved: v?.approved,
          metadata: v?.metadata,
        };
      });

      const response: HistoryResponse = {
        sessionId,
        count: history.length,
        history,
      };
      logger.debug({ sessionId, count: history.length }, "Session history fetched");
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
  });

  /**
   * GET /api/sessions/:id/state
   *   - Returns the latest state snapshot for a given session.
   *   - Useful as a "give me what the conversation looks like now" endpoint.
   */
  app.get("/api/sessions/:id/state", async (request, reply) => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = await (graph as any).getState({
        configurable: { thread_id: sessionId },
      });
      return {
        sessionId,
        values: state?.values ?? {},
        next: state?.next ?? [],
        createdAt: state?.createdAt,
      };
    } catch (err) {
      request.log.error({ err, sessionId }, "Failed to fetch session state");
      return reply.code(500).send({
        error: {
          code: "SESSION_STATE_ERROR",
          message: (err as Error).message,
        },
      });
    }
  });
}
