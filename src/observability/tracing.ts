/**
 * Manual span helpers for tracing LangChain / LangGraph operations that
 * auto-instrumentation does not cover.
 *
 * Usage:
 *   await withSpan("retriever.search", { "query.length": q.length }, async (span) => {
 *     const hits = await retriever.search(...);
 *     span.setAttribute("hits.count", hits.length);
 *     return hits;
 *   });
 */
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("advanced-rag-platform");

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Expose the tracer for callers that need it. */
export { tracer };
