/**
 * `buildContext` node — turn the reranked chunks into a single LLM-ready
 * context string plus a deduplicated `Source[]`.
 *
 * Delegates the actual prompt-side packing to the platform-wide
 * `ContextBuilder` so this node stays thin.
 */
import { logger } from "@/core/shared/logger.js";
import { RetrievalError } from "@/core/shared/errors.js";
import { ContextBuilder } from "@/rag/context/builder.js";
import type { Source } from "@/core/shared/types.js";
import type { QueryState } from "../state.js";

/** Deduplicate sources by chunkId, keeping the first occurrence. */
function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const key = s.chunkId ?? `${s.documentId}:${s.title}:${s.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function buildContextNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "buildContext";
  try {
    const chunks: any[] = state.rerankedChunks ?? [];
    if (chunks.length === 0) {
      logger.info(`[${nodeName}] no chunks — empty context`);
      return {
        context: "",
        sources: dedupeSources(state.sources ?? []),
        metadata: { ...state.metadata, contextChars: 0, node: nodeName },
      };
    }

    logger.info({ chunks: chunks.length }, `[${nodeName}] start`);

    const builder = new ContextBuilder();
    const { context, sources } = await builder.build(state.query, chunks);

    // Merge: builder's sources (built from chunks) win, but include any
    // extras from prior nodes and dedupe.
    const merged = dedupeSources([...sources, ...(state.sources ?? [])]);

    logger.info(
      { contextChars: context.length, sources: merged.length },
      `[${nodeName}] done`,
    );

    return {
      context,
      sources: merged,
      metadata: {
        ...state.metadata,
        contextChars: context.length,
        builder: "context-builder",
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new RetrievalError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
