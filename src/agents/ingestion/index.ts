/**
 * Public entry point for the ingestion agent.
 *
 * The default export of `graph` is what `langgraph.json` resolves
 * (`./src/agents/ingestion/index.ts:graph`).
 */
import { createIngestionGraph } from "./graph.js";

export const graph = createIngestionGraph();

export { createIngestionGraph } from "./graph.js";
export { IngestionStateSchema } from "./state.js";
export type { IngestionState } from "./state.js";
export * from "./nodes/load.js";
export * from "./nodes/process.js";
export * from "./nodes/chunk.js";
export * from "./nodes/embed.js";
export * from "./nodes/store.js";
