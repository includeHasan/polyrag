/**
 * Time-travel and history helpers for LangGraph graphs.
 *
 * `getStateHistory(graph, config)` — list past checkpoints for a thread.
 * `forkAt(checkpoint, config)`      — fork a graph run from a specific checkpoint
 *                                     by writing new state values into it.
 *
 * @see https://langchain-ai.github.io/langgraphjs/concepts/time-travel/
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointTuple,
} from "@langchain/langgraph-checkpoint";

import { logger } from "@/core/shared/logger.js";

// Minimal contract we need from a compiled graph; the full `Pregel` type is
// generic over the node/channel shapes which we don't need here.
export interface GraphLike {
  getStateHistory(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> },
  ): AsyncIterableIterator<StateSnapshot>;
  updateState(
    inputConfig: RunnableConfig,
    values: Record<string, unknown> | unknown,
    asNode?: string,
  ): Promise<RunnableConfig>;
}

export interface StateSnapshot {
  config: RunnableConfig;
  values: Record<string, unknown> | unknown;
  next: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  parentConfig?: RunnableConfig;
  tasks?: unknown[];
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Return all state snapshots for a given thread config, newest first.
 *
 * Materialises the async iterator into an array. Use `getStateHistoryStream`
 * to consume the stream lazily.
 */
export async function getStateHistory(
  graph: GraphLike,
  config: RunnableConfig,
): Promise<StateSnapshot[]> {
  const out: StateSnapshot[] = [];
  for await (const snap of graph.getStateHistory(config)) {
    out.push(snap);
  }
  logger.debug(
    { threadId: config?.configurable?.thread_id, count: out.length },
    "Fetched state history",
  );
  return out;
}

/**
 * Lazy version of `getStateHistory`.
 */
export function getStateHistoryStream(
  graph: GraphLike,
  config: RunnableConfig,
  options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> },
): AsyncIterableIterator<StateSnapshot> {
  return graph.getStateHistory(config, options);
}

// ---------------------------------------------------------------------------
// Fork / branch
// ---------------------------------------------------------------------------

/**
 * Fork execution from a specific checkpoint.
 *
 * Takes a `CheckpointTuple` (or anything exposing a `.config`) and a partial
 * state `values` to apply at that point, returning a new `RunnableConfig`
 * that you can pass back to `graph.invoke` / `graph.stream` to continue
 * execution from the forked state.
 *
 * @example
 * ```ts
 * const history = await getStateHistory(graph, { configurable: { thread_id } });
 * const fork = history[2]; // rewind to the 3rd-most-recent step
 * const newConfig = await forkAt(graph, fork, { messages: [humanMessage("…")] });
 * await graph.invoke(null, newConfig);
 * ```
 */
export async function forkAt(
  graph: GraphLike,
  checkpoint: CheckpointTuple | StateSnapshot | { config: RunnableConfig },
  values: Record<string, unknown> | unknown,
  asNode?: string,
): Promise<RunnableConfig> {
  if (!checkpoint?.config) {
    throw new Error("forkAt: `checkpoint` must expose a `.config` field");
  }
  const newConfig = await graph.updateState(checkpoint.config, values, asNode);
  logger.info(
    {
      threadId: checkpoint.config?.configurable?.thread_id,
      asNode,
    },
    "Forked graph state at checkpoint",
  );
  return newConfig;
}

// ---------------------------------------------------------------------------
// Low-level checkpoint lookup via a saver (no graph required)
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent checkpoint for a thread directly from a saver.
 * Useful for inspection / debugging.
 */
export async function loadLatestCheckpoint(
  saver: BaseCheckpointSaver,
  threadId: string,
): Promise<Checkpoint | undefined> {
  const tuple = await saver.get({ configurable: { thread_id: threadId } });
  return tuple;
}

// Re-export types for callers
export type { BaseCheckpointSaver, Checkpoint, CheckpointTuple, RunnableConfig };
