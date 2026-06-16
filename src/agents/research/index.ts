/**
 * Public entry point for the research agent (Phase 4 stub).
 */
import { createResearchGraph } from "./graph.js";

export const graph = createResearchGraph();

export { createResearchGraph } from "./graph.js";
export { ResearchStateSchema } from "./state.js";
export type { ResearchState } from "./state.js";
export * from "./nodes/planner.js";
export * from "./nodes/searcher.js";
export * from "./nodes/synthesizer.js";
