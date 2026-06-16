import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "@/core/shared/logger.js";
import { GenerationError } from "@/core/shared/errors.js";
import { getPromptFor } from "@/agents/prompts/registry.js";
import { getLLM } from "@/infra/llm/factory.js";
import { resolveNodeConfig } from "./_config.js";
import type { QueryState } from "../state.js";

/**
 * Format the `Source[]` into a citation block the LLM can reference.
 * (Stable, deterministic ordering by documentId + page + chunkId.)
 */
function formatSources(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sources: any[],
): string {
  if (!sources || sources.length === 0) return "(no sources)";
  return sources
    .map((s: any, i: number) => {
      const where = s.page ? `, p.${s.page}` : "";
      return `[${i + 1}] ${s.title}${where} — ${s.snippet}`;
    })
    .join("\n");
}


export async function generateNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "generate";
  try {
    if (!state.query) {
      throw new GenerationError(`[${nodeName}] state.query is empty`);
    }

    const cfg = resolveNodeConfig(state);

    logger.info(
      {
        contextChars: state.context?.length ?? 0,
        sources: state.sources?.length ?? 0,
      },
      `[${nodeName}] start`,
    );

    const promptTemplate = getPromptFor("retrieval", cfg);
    const sourcesBlock = formatSources(state.sources ?? []);
    const prompt = promptTemplate
      .replace("{context}", state.context ?? "")
      .replace("{sources}", sourcesBlock)
      .replace("{query}", state.query);

    const system = new SystemMessage(getPromptFor("system", cfg));

    const llm = getLLM({ model: cfg.models.generationModel });
    const response = await llm.invoke([system, { role: "user", content: prompt }]);
    const answer =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? ""))
              .join("")
          : String(response.content ?? "");

    logger.info(
      { answerChars: answer.length, model: cfg.models.generationModel },
      `[${nodeName}] done`,
    );

    return {
      draftAnswer: answer,
      finalAnswer: answer,
      messages: [new AIMessage(answer)],
      approved: true,
      metadata: {
        ...state.metadata,
        model: cfg.models.generationModel,
        answerChars: answer.length,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new GenerationError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
