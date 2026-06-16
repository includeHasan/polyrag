/**
 * Research graph (Phase 4 stub).
 *
 *   START → planner → searcher → synthesizer → END
 *
 * The real version will fan out one `Send` per sub-question and join
 * findings with the Annotated `ReducedValue` reducers.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { logger } from "../../shared/logger.js";
import { ResearchStateSchema } from "./state.js";
import { plannerNode } from "./nodes/planner.js";
import { searcherNode } from "./nodes/searcher.js";
import { synthesizerNode } from "./nodes/synthesizer.js";
import { getCheckpointer } from "../../memory/session.js";

export interface CreateResearchGraphOptions {
  checkpointer?: unknown;
  recursionLimit?: number;
}

export function createResearchGraph(options: CreateResearchGraphOptions = {}) {
  // See note in createQueryGraph about StateGraph generic strictness.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflow: any = new StateGraph(ResearchStateSchema);

  // TODO(phase-4): replace the linear stub with a fan-out / fan-in graph
  // using `Send` per sub-question.

  workflow.addNode("planner", plannerNode);
  workflow.addNode("searcher", searcherNode);
  workflow.addNode("synthesizer", synthesizerNode);

  workflow.addEdge(START, "planner");
  workflow.addEdge("planner", "searcher");
  workflow.addEdge("searcher", "synthesizer");
  workflow.addEdge("synthesizer", END);

  const checkpointer = (options.checkpointer ?? getCheckpointer()) as never;
  const graph = workflow.compile({ checkpointer });

  logger.info(
    { recursionLimit: options.recursionLimit ?? 25 },
    "Research graph compiled (phase-4 stub)",
  );
  return graph;
}

export type CompiledResearchGraph = ReturnType<typeof createResearchGraph>;
