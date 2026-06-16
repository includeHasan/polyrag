/**
 * Research graph (Phase 4, real implementation).
 *
 *   START ──► planner ──► [ Send("searcher", { subQuestion: q }) … ]
 *                            │     (one per sub-question; results reduce
 *                            ▼      into `findings` via the state reducer)
 *                       synthesizer ──► END
 *
 * The Send pattern lets the planner emit N parallel searcher tasks.
 * Each searcher writes its findings to `state.findings`, and the
 * `ReducedValue` reducer concatenates them so the synthesizer sees a
 * single aggregated list.
 */
import { END, Send, START, StateGraph } from "@langchain/langgraph";
import { logger } from "../../shared/logger.js";
import { getCheckpointer } from "../../memory/session.js";
import { ResearchStateSchema } from "./state.js";
import { plannerNode } from "./nodes/planner.js";
import { searcherNode } from "./nodes/searcher.js";
import { synthesizerNode } from "./nodes/synthesizer.js";

export interface CreateResearchGraphOptions {
  /** Override the checkpointer (used by tests). */
  checkpointer?: unknown;
  /** Override the recursion limit. */
  recursionLimit?: number;
}

export function createResearchGraph(options: CreateResearchGraphOptions = {}) {
  // The StateGraph generics in langgraph@1.4.x are very strict about node-name
  // tracking. The runtime behavior is correct, but TS rejects addNode/addEdge
  // calls unless the type system can chain them. Casting to `any` here keeps
  // the runtime type-safe via the `ResearchState` type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflow: any = new StateGraph(ResearchStateSchema);

  // -------------------------------------------------------------------------
  // Nodes
  // -------------------------------------------------------------------------
  workflow.addNode("planner", plannerNode);
  workflow.addNode("searcher", searcherNode);
  workflow.addNode("synthesizer", synthesizerNode);

  // -------------------------------------------------------------------------
  // Edges
  // -------------------------------------------------------------------------
  workflow.addEdge(START, "planner");

  // Fan-out: one Send("searcher", { subQuestion }) per planner sub-question.
  // The reducer on `findings` concatenates the per-task outputs.
  workflow.addConditionalEdges("planner", (state: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subs: string[] = (state as any)?.subQuestions ?? [];
    if (!Array.isArray(subs) || subs.length === 0) {
      // No sub-questions: skip searcher and go straight to synthesizer.
      return "synthesizer";
    }
    return subs.map(
      (q) => new Send("searcher", { ...(state as object), subQuestion: q }),
    );
  });

  // After all parallel searcher sends complete, the framework joins them
  // back into the main flow and we route to the synthesizer. A conditional
  // edge gives us a single, well-defined join point.
  workflow.addConditionalEdges("searcher", (state: unknown) => {
    // The framework fires this once per searcher return. We always want
    // to go to the synthesizer; the actual fan-in is handled implicitly
    // by the Send + reducer semantics.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void state;
    return "synthesizer";
  });

  workflow.addEdge("synthesizer", END);

  // -------------------------------------------------------------------------
  // Compile
  // -------------------------------------------------------------------------
  const checkpointer = (options.checkpointer ?? getCheckpointer()) as never;
  const graph = workflow.compile({
    checkpointer,
    // Generous limit: planner (1) + N searchers (each counts as a step
    // in the join) + synthesizer (1). Default 25 is plenty for 3-5 subs.
    recursionLimit: options.recursionLimit ?? 25,
  });

  logger.info(
    { recursionLimit: options.recursionLimit ?? 25 },
    "Research graph compiled (phase-4 real)",
  );
  return graph;
}

export type CompiledResearchGraph = ReturnType<typeof createResearchGraph>;
