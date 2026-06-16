/**
 * Query graph: START → understand → retrieve → rerank → buildContext
 *             → generate → evaluate → END
 *
 * Compiled with a `MemorySaver` checkpointer by default (overridable in
 * tests) and a recursion limit matching `env.RECURSION_LIMIT`.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { logger } from "@/core/shared/logger.js";
import { QueryStateSchema, type QueryState } from "./state.js";
import { understandNode } from "./nodes/understand.js";
import { retrieveNode } from "./nodes/retrieve.js";
import { rerankNode } from "./nodes/rerank.js";
import { buildContextNode } from "./nodes/buildContext.js";
import { generateNode } from "./nodes/generate.js";
import { evaluateNode } from "./nodes/evaluate.js";
import { getCheckpointer } from "@/platform/memory/session.js";

export interface CreateQueryGraphOptions {
  /** Override the checkpointer (used by tests). */
  checkpointer?: unknown;
  /** Override the recursion limit. */
  recursionLimit?: number;
}

export function createQueryGraph(options: CreateQueryGraphOptions = {}) {
  // The StateGraph generics in langgraph@1.4.x are very strict about node-name
  // tracking. The runtime behavior is correct, but TS rejects addNode/addEdge
  // calls unless the type system can chain them. Casting to `any` here is the
  // simplest path that keeps the runtime type-safe via the `QueryState` type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflow: any = new StateGraph(QueryStateSchema);

  // Nodes -------------------------------------------------------------------
  workflow.addNode("understand", understandNode);
  workflow.addNode("retrieve", retrieveNode);
  workflow.addNode("rerank", rerankNode);
  workflow.addNode("buildContext", buildContextNode);
  workflow.addNode("generate", generateNode);
  workflow.addNode("evaluate", evaluateNode);

  // Edges -------------------------------------------------------------------
  workflow.addEdge(START, "understand");
  workflow.addEdge("understand", "retrieve");
  workflow.addEdge("retrieve", "rerank");
  workflow.addEdge("rerank", "buildContext");
  workflow.addEdge("buildContext", "generate");
  workflow.addEdge("generate", "evaluate");
  workflow.addEdge("evaluate", END);

  const checkpointer = (options.checkpointer ?? getCheckpointer()) as never;
  const graph = workflow.compile({
    checkpointer,
  });

  logger.info(
    { recursionLimit: options.recursionLimit ?? 25 },
    "Query graph compiled",
  );
  return graph;
}

export type CompiledQueryGraph = ReturnType<typeof createQueryGraph>;

/** Strongly-typed handle for invocations. */
export type InvokeQuery = (
  input: { query: string; sessionId?: string; metadata?: Record<string, unknown> },
  config?: { configurable?: { thread_id?: string }; recursionLimit?: number },
) => Promise<QueryState>;
