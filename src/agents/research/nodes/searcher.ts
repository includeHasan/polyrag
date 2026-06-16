/**
 * `searcher` node — Phase 4 stub.
 *
 * Real implementation will fan out one retrieval per sub-question
 * (using `Send` in the graph). For now we just return a placeholder
 * finding derived from the first sub-question.
 */
import { logger } from "../../../shared/logger.js";
import type { Chunk } from "../../../shared/types.js";
import type { ResearchState } from "../state.js";

export async function searcherNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "searcher";
  logger.info(
    { subQuestions: state.subQuestions?.length ?? 0 },
    `[${nodeName}] phase-4 stub`,
  );

  const findings: Chunk[] = [];

  return {
    findings,
    metadata: {
      ...state.metadata,
      findingsCount: findings.length,
      node: nodeName,
    },
  };
}
