/**
 * POST /api/query — entry point for retrieval-augmented generation.
 *
 * - Validates the body against the shared `QueryRequest` schema.
 * - For non-streaming requests, calls `graph.invoke` and returns a
 *   `QueryResponse`.
 * - For streaming requests (`stream === true`), uses `graph.stream`
 *   with `streamMode: "messages"` and pipes Server-Sent Events
 *   (`text/event-stream`).
 *
 * The graph is fetched from the server singleton (set via
 * `setQueryGraph`); this keeps the route testable.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  QueryRequestSchema,
  type QueryRequest,
  type QueryResponse,
  type Source,
} from "@/shared/types.js";
import { getObservability, getQueryGraph } from "../deps.js";
import { getServer } from "../server.js";
import { GenerationError } from "@/shared/errors.js";
import { extractCitations } from "@/context/citation.js";

// Allow handlers to push through `reply.hijack()` and stream SSE without
// Fastify re-serialising the body.
type RawReply = FastifyReply & { raw: NodeJS.WritableStream };

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/query", async (request, reply) => {
    const start = Date.now();
    const parsed = QueryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw parsed.error;
    }
    const body = parsed.data as QueryRequest;
    const sessionId = body.sessionId ?? randomUUID();
    const server = await getServer();
    const graph = server.graph ?? (await getQueryGraph());

    // ---- Streaming -------------------------------------------------------
    if (body.stream) {
      return streamQuery(request, reply, body, sessionId, graph, start);
    }

    // ---- Non-streaming ---------------------------------------------------
    let finalState;
    try {
      finalState = await graph.invoke(
        {
          query: body.query,
          sessionId,
          filters: body.filters,
          topK: body.topK,
        },
        { configurable: { thread_id: sessionId } },
      );
    } catch (err) {
      throw new GenerationError("Query execution failed", err);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const answer: string = (finalState as any).finalAnswer ?? (finalState as any).answer ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sources: Source[] = (finalState as any).sources ?? [];

    // Phase 2: validate citations in the answer.
    //   - If the answer claims citations (has [N] markers) and ALL of them
    //     are out of range, we return a `citations` block in metrics so
    //     callers / dashboards can see the issue.
    //   - We do NOT silently fail the response — that's a separate concern
    //     (downstream services can monitor `citationCoverage`).
    const citationResult = extractCitations(answer, sources);
    const citationCoverage = sources.length === 0
      ? 0
      : citationResult.citations.length / Math.max(sources.length, 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retrievedCount: number = (finalState as any).retrievedChunks?.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?? (finalState as any).sources?.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rerankedCount: number = (finalState as any).rerankedChunks?.length ?? 0;

    const response: QueryResponse = {
      answer,
      sources,
      sessionId,
      queryLogId: finalState.queryLogId,
      metrics: {
        retrieved: retrievedCount,
        reranked: rerankedCount,
        latencyMs: Date.now() - start,
      },
    };

    try {
      const obs = await getObservability();
      obs.incrCounter("queriesTotal");
      obs.recordLatency("query", Date.now() - start);
      obs.recordObservation("citationCoverage", citationCoverage);
    } catch {
      // metrics are best-effort
    }
    return response;
  });
}

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------
async function streamQuery(
  request: FastifyRequest,
  reply: FastifyReply,
  body: QueryRequest,
  sessionId: string,
  graph: Awaited<ReturnType<typeof getQueryGraph>>,
  start: number,
): Promise<FastifyReply> {
  // Take over the socket — Fastify must not attempt to serialise the body.
  reply.hijack();
  const raw = reply as unknown as RawReply;
  raw.raw.setHeader("content-type", "text/event-stream");
  raw.raw.setHeader("cache-control", "no-cache");
  raw.raw.setHeader("connection", "keep-alive");
  raw.raw.setHeader("x-request-id", request.id);
  raw.raw.setHeader("x-accel-buffering", "no");
  raw.raw.writeHead(200);

  const send = (event: string, data: unknown) => {
    raw.raw.write(`event: ${event}\n`);
    raw.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let tokenCount = 0;
  try {
    const stream = graph.stream(
      {
        query: body.query,
        sessionId,
        filters: body.filters,
        topK: body.topK,
      },
      {
        streamMode: "messages",
        configurable: { thread_id: sessionId },
      },
    );

    send("start", { sessionId, requestId: request.id });

    for await (const chunk of stream) {
      // The `messages` stream mode emits `[message, metadata]` tuples.
      // We extract any token text from AIMessage chunks and forward it.
      const token = extractTokenText(chunk);
      if (token) {
        tokenCount += 1;
        send("token", { text: token });
      }
    }

    send("end", { sessionId, tokenCount });
    try {
      const obs = await getObservability();
      obs.incrCounter("queriesTotal");
      obs.incrCounter("queriesStreamedTotal");
      obs.recordLatency("query.stream", Date.now() - start);
    } catch {
      // best-effort
    }
  } catch (err) {
    request.log.error({ err }, "Streaming query failed");
    send("error", {
      code: "GENERATION_ERROR",
      message: (err as Error).message ?? "Query failed",
    });
    throw err;
  } finally {
    raw.raw.end();
  }
  return reply;
}

function extractTokenText(chunk: unknown): string | null {
  if (!chunk) return null;
  // Tuple form: [BaseMessage, metadata]
  if (Array.isArray(chunk) && chunk.length >= 1) {
    return extractTokenText(chunk[0]);
  }
  // BaseMessage shape
  if (typeof chunk === "object" && chunk !== null) {
    const m = chunk as { content?: unknown };
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      // Anthropic/OpenAI multimodal: pull out text parts.
      const text = m.content
        .map((p: unknown) => {
          if (typeof p === "string") return p;
          if (
            p &&
            typeof p === "object" &&
            (p as { type?: string }).type === "text" &&
            typeof (p as { text?: string }).text === "string"
          ) {
            return (p as { text: string }).text;
          }
          return "";
        })
        .join("");
      return text || null;
    }
  }
  if (typeof chunk === "string") return chunk;
  return null;
}
