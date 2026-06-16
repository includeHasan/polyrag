/**
 * Sessions service — HTTP-agnostic access to the LangGraph checkpointer.
 * Materialises checkpoint history and the latest state snapshot for a given
 * thread_id (session) into plain JSON shapes.
 */
import { getStateHistory, type StateSnapshot } from "@/platform/memory/checkpoint.js";

export interface HistoryResponse {
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

export interface StateResponse {
  sessionId: string;
  values: Record<string, unknown>;
  next: string[];
  createdAt?: string;
}

function preview(text: string | undefined, max = 100): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Fetch and shape the checkpoint history for a session (thread_id). */
export async function fetchSessionHistory(
  graph: unknown,
  sessionId: string,
  limit: number,
): Promise<HistoryResponse> {
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

  return {
    sessionId,
    count: history.length,
    history,
  };
}

/** Fetch the latest state snapshot for a session (thread_id). */
export async function fetchSessionState(
  graph: unknown,
  sessionId: string,
): Promise<StateResponse> {
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
}
