/**
 * Query controller — validates the request, enforces auth + rate limit,
 * resolves the compiled graph, and delegates to the query service. Owns the
 * SSE transport for streaming responses (the service stays HTTP-agnostic).
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { QueryRequestSchema, type QueryRequest } from "@/core/shared/types.js";
import { getQueryGraph, type CompiledQueryGraph } from "../deps.js";
import { getServer } from "../server.js";
import { AuthError } from "@/core/shared/errors.js";
import { getRateLimiter, RateLimiter } from "@/platform/security/rateLimit.js";
import { getTenantContext } from "@/platform/tenancy/context.js";
import {
  runQuery,
  streamQuery,
  type QueryGraphInput,
  type SseSend,
} from "../services/query.service.js";
import { identity } from "./_context.js";

// Allow `reply.hijack()` + raw SSE writes without Fastify re-serialising.
type RawReply = FastifyReply & { raw: NodeJS.WritableStream };

export async function query(request: FastifyRequest, reply: FastifyReply) {
  const start = Date.now();

  const parsed = QueryRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    throw parsed.error;
  }
  const body = parsed.data as QueryRequest;
  const sessionId = body.sessionId ?? randomUUID();

  const { user, userId, tenantId } = identity(request);
  if (!user) {
    throw new AuthError("Authentication required");
  }
  const tenantConfigKey = getTenantContext()?.config ? "1" : undefined;

  const server = await getServer();
  const graph: CompiledQueryGraph = server.graph ?? (await getQueryGraph());

  // The rate-limit preHandler already denied an empty bucket; debit here so
  // the limiter observes accepted traffic too.
  const limiter: RateLimiter = getRateLimiter();
  await limiter.consume(tenantId, userId, "query");

  const input: QueryGraphInput = {
    query: body.query,
    sessionId,
    filters: body.filters,
    topK: body.topK,
    tenantId,
    userId,
    user,
    tenantConfigKey,
  };

  if (body.stream) {
    return streamSse(request, reply, graph, input, start);
  }

  return runQuery(graph, input, start);
}

/** Set up the SSE response and drive the streaming service. */
async function streamSse(
  request: FastifyRequest,
  reply: FastifyReply,
  graph: CompiledQueryGraph,
  input: QueryGraphInput,
  start: number,
): Promise<FastifyReply> {
  reply.hijack();
  const raw = reply as unknown as RawReply;
  raw.raw.setHeader("content-type", "text/event-stream");
  raw.raw.setHeader("cache-control", "no-cache");
  raw.raw.setHeader("connection", "keep-alive");
  raw.raw.setHeader("x-request-id", request.id);
  raw.raw.setHeader("x-accel-buffering", "no");
  raw.raw.writeHead(200);

  const send: SseSend = (event, data) => {
    raw.raw.write(`event: ${event}\n`);
    raw.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await streamQuery(graph, input, start, send, request.id);
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
