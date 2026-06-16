/**
 * Query service — HTTP-agnostic orchestration of the RAG query graph.
 *
 * `runQuery` handles the non-streaming path and returns a `QueryResponse`.
 * `streamQuery` drives the token stream and reports progress through an
 * injected `send(event, data)` callback, so the SSE transport details stay
 * in the controller and this layer never touches a `reply`.
 */
import {
  type QueryResponse,
  type Source,
} from "@/core/shared/types.js";
import { getObservability, type CompiledQueryGraph } from "../deps.js";
import { GenerationError } from "@/core/shared/errors.js";
import { extractCitations } from "@/rag/context/citation.js";
import { getUsageMeter } from "@/platform/observability/metering.js";
import { logger } from "@/core/shared/logger.js";

export interface QueryGraphInput {
  query: string;
  sessionId: string;
  filters?: Record<string, unknown>;
  topK?: number;
  tenantId: string | null;
  userId: string | null;
  user: unknown;
  tenantConfigKey?: string;
}

/** Cost estimate placeholder until the LLM provider's usage callback lands. */
const USD_PER_TOKEN = 0.000002;
export function estimateCostUsd(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round(tokens * USD_PER_TOKEN * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Non-streaming
// ---------------------------------------------------------------------------
export async function runQuery(
  graph: CompiledQueryGraph,
  input: QueryGraphInput,
  start: number,
): Promise<QueryResponse> {
  let finalState;
  try {
    finalState = await graph.invoke(
      {
        query: input.query,
        sessionId: input.sessionId,
        filters: input.filters,
        topK: input.topK,
        tenantId: input.tenantId,
        userId: input.userId,
        user: input.user,
        tenantConfigKey: input.tenantConfigKey,
      },
      { configurable: { thread_id: input.sessionId } },
    );
  } catch (err) {
    throw new GenerationError("Query execution failed", err);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = finalState as any;
  const answer: string = fs.finalAnswer ?? fs.answer ?? "";
  const sources: Source[] = fs.sources ?? [];

  const citationResult = extractCitations(answer, sources);
  const citationCoverage =
    sources.length === 0
      ? 0
      : citationResult.citations.length / Math.max(sources.length, 1);

  const retrievedCount: number =
    fs.retrievedChunks?.length ?? fs.sources?.length ?? 0;
  const rerankedCount: number = fs.rerankedChunks?.length ?? 0;
  const llmTokens: number | undefined =
    fs.llmTokens ?? fs.metrics?.llmTokens ?? undefined;

  const response: QueryResponse = {
    answer,
    sources,
    sessionId: input.sessionId,
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

  const meter = getUsageMeter();
  void meter
    .record({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "query",
      tokensUsed: llmTokens ?? 0,
      costUsd: estimateCostUsd(llmTokens ?? 0),
      latencyMs: Date.now() - start,
      metadata: {
        sessionId: input.sessionId,
        retrieved: retrievedCount,
        reranked: rerankedCount,
        coverage: citationCoverage,
      },
    })
    .catch((err) => {
      logger.error(
        { err, tenantId: input.tenantId, userId: input.userId },
        "metering.record failed for query",
      );
    });

  return response;
}

// ---------------------------------------------------------------------------
// Streaming — transport-agnostic; `send` is supplied by the controller.
// ---------------------------------------------------------------------------
export type SseSend = (event: string, data: unknown) => void;

export async function streamQuery(
  graph: CompiledQueryGraph,
  input: QueryGraphInput,
  start: number,
  send: SseSend,
  requestId: string,
): Promise<void> {
  let tokenCount = 0;
  send("start", { sessionId: input.sessionId, requestId });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamOrPromise: any = (graph as any).stream(
    {
      query: input.query,
      sessionId: input.sessionId,
      filters: input.filters,
      topK: input.topK,
      tenantId: input.tenantId,
      userId: input.userId,
      user: input.user,
      tenantConfigKey: input.tenantConfigKey,
    },
    { streamMode: "messages", configurable: { thread_id: input.sessionId } },
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
    configurable: { thread_id: input.sessionId },
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
  const citationCoverage =
    sources.length === 0 ? 0 : citationResult.citations.length / sources.length;

  send("end", {
    sessionId: input.sessionId,
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

  const meter = getUsageMeter();
  void meter
    .record({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "query.stream",
      tokensUsed: tokenCount,
      costUsd: estimateCostUsd(tokenCount),
      latencyMs: Date.now() - start,
      metadata: { sessionId: input.sessionId, streamed: true },
    })
    .catch((err) => {
      logger.error(
        { err, tenantId: input.tenantId, userId: input.userId },
        "metering.record failed for streamed query",
      );
    });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
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
