/**
 * `synthesizer` node — Phase 4 stub.
 *
 * Real implementation will use the LLM to weave the per-sub-question
 * findings into a single cited report. For now we just join the
 * snippets.
 */
import { logger } from "../../../shared/logger.js";
import type { ResearchState } from "../state.js";

export async function synthesizerNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "synthesizer";
  logger.info(
    { findings: state.findings?.length ?? 0 },
    `[${nodeName}] phase-4 stub`,
  );

  const draft = (state.findings ?? [])
    .map((c: any) => c.text)
    .join("\n\n---\n\n")
    .slice(0, 2000);

  const finalAnswer = draft.length > 0
    ? `Research draft for "${state.query}":\n\n${draft}`
    : `No findings available for "${state.query}".`;

  return {
    draftAnswer: draft,
    finalAnswer,
    complete: true,
    metadata: {
      ...state.metadata,
      answerChars: finalAnswer.length,
      node: nodeName,
    },
  };
}
