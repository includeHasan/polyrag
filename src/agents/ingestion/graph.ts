/**
 * Ingestion graph: START → load → process → chunk → embed → store → END
 *
 * Stateless by default — the storage layer mirrors the job status. We
 * still attach an in-memory checkpointer so callers can stream partial
 * state if they want.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { logger } from "@/core/shared/logger.js";
import { IngestionStateSchema, type IngestionState } from "./state.js";
import { loadNode } from "./nodes/load.js";
import { processNode } from "./nodes/process.js";
import { chunkNode } from "./nodes/chunk.js";
import { embedNode } from "./nodes/embed.js";
import { storeNode } from "./nodes/store.js";
import { getCheckpointer } from "@/platform/memory/session.js";

export interface CreateIngestionGraphOptions {
  checkpointer?: unknown;
  recursionLimit?: number;
}

export function createIngestionGraph(options: CreateIngestionGraphOptions = {}) {
  // See note in createQueryGraph about StateGraph generic strictness.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflow: any = new StateGraph(IngestionStateSchema);

  // Nodes -------------------------------------------------------------------
  workflow.addNode("load", loadNode);
  workflow.addNode("process", processNode);
  workflow.addNode("chunk", chunkNode);
  workflow.addNode("embed", embedNode);
  workflow.addNode("store", storeNode);

  // Edges -------------------------------------------------------------------
  workflow.addEdge(START, "load");
  workflow.addEdge("load", "process");
  workflow.addEdge("process", "chunk");
  workflow.addEdge("chunk", "embed");
  workflow.addEdge("embed", "store");
  workflow.addEdge("store", END);

  const checkpointer = (options.checkpointer ?? getCheckpointer()) as never;
  const graph = workflow.compile({ checkpointer });

  logger.info(
    { recursionLimit: options.recursionLimit ?? 25 },
    "Ingestion graph compiled",
  );
  return graph;
}

export type CompiledIngestionGraph = ReturnType<typeof createIngestionGraph>;
export type IngestInvoke = (
  input: { request: IngestionState["request"]; metadata?: Record<string, unknown> },
  config?: { configurable?: { thread_id?: string } },
) => Promise<IngestionState>;
