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
 * Phase 5 additions:
 *   - Rate-limit gate at the start (429 + `Retry-After` on deny).
 *   - Per-tenant usage metering after the response.
 *   - `tenantId` + `userId` threaded into the graph state so the
 *     `retrieve` node can apply multi-tenant filters.
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
import { GenerationError, AuthError } from "@/shared/errors.js";
import { extractCitations } from "@/context/citation.js";
import { rateLimitPreHandler } from "../middleware/rateLimit.js";
import { getRateLimiter, RateLimiter } from "@/security/rateLimit.js";
import { getUsageMeter } from "@/observability/metering.js";
import { logger } from "@/shared/logger.js";

// Allow handlers to push through `reply.hijack()` and stream SSE without
// Fastify re-serialising the body.
type RawReply = FastifyReply & { raw: NodeJS.WritableStream };

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/query",
    {
      preHandler: rateLimitPreHandler({ action: "query" }),
    },
    async (request, reply) => {
      const start = Date.now();
      const parsed = QueryRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw parsed.error;
      }
      const body = parsed.data as QueryRequest;
      const sessionId = body.sessionId ?? randomUUID();
      const server = await getServer();
      const graph = server.graph ?? (await getQueryGraph());

      // ---- User / tenant context -----------------------------------------
      const user = request.user;
      if (!user) {
        throw new AuthError("Authentication required");
      }
      const userId = (user.sub as string | undefined) ?? null;
      const tenantId =
        (user.tenantId as string | undefined) ??
        (user.tenant_id as string | undefined) ??
        null;

      // ---- Rate-limit consume (debit the bucket) -------------------------
      // The preHandler already denied the request if the bucket was empty.
      // We debit on every accepted call so the limiter sees real traffic.
      const limiter: RateLimiter = getRateLimiter();
      await limiter.consume(tenantId, userId, "query");

      // ---- Streaming -----------------------------------------------------
      if (body.stream) {
        return streamQuery(request, reply, body, sessionId, graph, start, {
          tenantId,
          userId,
        });
      }

      // ---- Non-streaming -------------------------------------------------
      let finalState;
      try {
        finalState = await graph.invoke(
          {
            query: body.query,
            sessionId,
            filters: body.filters,
            topK: body.topK,
            tenantId,
            userId,
            user,
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
      const llmTokens: number | undefined =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (finalState as any).llmTokens ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (finalState as any).metrics?.llmTokens ??
        undefined;

      const response: QueryResponse = {
        answer,
        sources,
        sessionId,
        queryLogId: finalState.queryLogId,
        metrics: {
          retrieved: retrievedCount,
          reranked: rerankedCount,
          llmTokens,
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

      // ---- Usage metering (async, non-blocking) -------------------------
      const meter = getUsageMeter();
      void meter
        .record({
          tenantId,
          userId,
          action: "query",
          tokensUsed: llmTokens ?? 0,
          costUsd: estimateCostUsd(llmTokens ?? 0),
          latencyMs: Date.now() - start,
          metadata: {
            sessionId,
            retrieved: retrievedCount,
            reranked: rerankedCount,
            coverage: citationCoverage,
          },
        })
        .catch((err) => {
          logger.error({ err, tenantId, userId }, "metering.record failed for query");
        });

      return response;
    },
  );
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
  ctx: { tenantId: string | null; userId: string | null },
): Promise<FastifyReply> {
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
    send("start", { sessionId, requestId: request.id });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamOrPromise: any = (graph as any).stream(
      {
        query: body.query,
        sessionId,
        filters: body.filters,
        topK: body.topK,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        user: request.user,
      },
      {
        streamMode: "messages",
        configurable: { thread_id: sessionId },
      },
    );
    const tokenStream: AsyncIterable<unknown> =
      typeof streamOrPromise?.[Symbol.asyncIterator] === "function"
        ? streamOrPromise
        : await streamOrPromise;

    for await (const chunk of tokenStream) {
      const token = extractTokenText(chunk);
      if (token) {
        tokenCount += 1;
        send("token", { text: token });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalState: any = await (graph as any).getState({
      configurable: { thread_id: sessionId },
    });
    const finalAnswer: string =
      finalState?.values?.finalAnswer ?? finalState?.values?.draftAnswer ?? "";
    const sources = (finalState?.values?.sources as unknown[] | undefined) ?? [];
    const retrievedChunks: unknown[] =
      (finalState?.values?.retrievedChunks as unknown[] | undefined) ?? [];
    const groundednessScore: number | undefined =
      finalState?.values?.groundednessScore;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evaluation: any = finalState?.values?.metadata?.evaluation;

    send("generated", {
      answerChars: finalAnswer.length,
      preview: preview(finalAnswer, 200),
    });
    send("retrieved", {
      chunkCount: retrievedChunks.length,
      sourceCount: sources.length,
    });
    if (evaluation) {
      send("evaluated", {
        groundedness: groundednessScore,
        approved: finalState?.values?.approved,
        evaluation,
      });
    }

    const citationResult = extractCitations(finalAnswer, sources as never);
    const citationCoverage = sources.length === 0
      ? 0
      : citationResult.citations.length / sources.length;

    send("end", {
      sessionId,
      tokenCount,
      latencyMs: Date.now() - start,
      citationCoverage,
    });

    try {
      const obs = await getObservability();
      obs.incrCounter("queriesTotal");
      obs.incrCounter("queriesStreamedTotal");
      obs.recordLatency("query.stream", Date.now() - start);
      obs.recordObservation("citationCoverage", citationCoverage);
    } catch {
      // best-effort
    }

    // ---- Usage metering (stream) --------------------------------------
    const meter = getUsageMeter();
    void meter
      .record({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "query.stream",
        tokensUsed: tokenCount,
        costUsd: estimateCostUsd(tokenCount),
        latencyMs: Date.now() - start,
        metadata: { sessionId, streamed: true },
      })
      .catch((err) => {
        logger.error(
          { err, tenantId: ctx.tenantId, userId: ctx.userId },
          "metering.record failed for streamed query",
        );
      });
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

// ---------------------------------------------------------------------------
// Cost estimation (rough — final cost should come from the LLM provider's
// usage callback. Until then we charge $0.000002 / token as a placeholder.)
// ---------------------------------------------------------------------------
const USD_PER_TOKEN = 0.000002;
function estimateCostUsd(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round(tokens * USD_PER_TOKEN * 1_000_000) / 1_000_000;
}

function preview(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function extractTokenText(chunk: unknown): string | null {
  if (!chunk) return null;
  if (Array.isArray(chunk) && chunk.length >= 1) {
    return extractTokenText(chunk[0]);
  }
  if (typeof chunk === "object" && chunk !== null) {
    const m = chunk as { content?: unknown };
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
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
