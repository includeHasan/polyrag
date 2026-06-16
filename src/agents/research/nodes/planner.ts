/**
 * `planner` node — Phase 4 stub.
 *
 * Real implementation will call the LLM to decompose the query into
 * 3-7 focused sub-questions. For Phase 1 we return 2 hard-coded
 * sub-questions so the rest of the graph is wired up.
 */
import { logger } from "../../../shared/logger.js";
import type { ResearchState } from "../state.js";

export async function plannerNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "planner";
  logger.info({ query: state.query }, `[${nodeName}] phase-4 stub`);

  const subQuestions: string[] = [
    `Background: ${state.query}`,
    `Key facts and citations related to: ${state.query}`,
  ];

  return {
    subQuestions,
    metadata: {
      ...state.metadata,
      subQuestionCount: subQuestions.length,
      node: nodeName,
    },
  };
}
