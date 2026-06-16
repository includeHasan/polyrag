/**
 * `evaluate` node — Phase 3 stub.
 *
 * Will eventually compute groundedness, faithfulness, citation coverage,
 * etc. For now it's a transparent pass-through so the rest of the pipeline
 * can be wired up.
 */
import { logger } from "../../../shared/logger.js";
import type { QueryState } from "../state.js";

export async function evaluateNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "evaluate";
  logger.info(
    { draftAnswerChars: state.draftAnswer?.length ?? 0 },
    `[${nodeName}] phase-3 stub — passthrough`,
  );
  return {
    metadata: {
      ...state.metadata,
      node: nodeName,
      evaluated: false,
    },
  };
}
