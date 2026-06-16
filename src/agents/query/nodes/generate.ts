/**
 * `generate` node — produce the final answer.
 *
 * Uses `getPrompt("retrieval")` to interpolate the standard RAG template
 * with `context`, `sources`, and `query`, then calls the OpenAI chat
 * model via a thin inlined wrapper. (A proper `LLMProvider` factory will
 * replace this in a follow-up; the shape mirrors the interface in
 * `src/shared/interfaces.ts`.)
 */
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "../../../shared/logger.js";
import { env } from "../../../config/env.js";
import { GenerationError } from "../../../shared/errors.js";
import { getPrompt } from "../../../prompts/registry.js";
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

let llmSingleton: ChatOpenAI | undefined;

/** Lazily build the chat model so we don't blow up at import time. */
function getLlm(): ChatOpenAI {
  if (llmSingleton) return llmSingleton;
  llmSingleton = new ChatOpenAI({
    model: env.OPENAI_MODEL_GENERATION,
    apiKey: env.OPENAI_API_KEY,
    temperature: 0.2,
  });
  return llmSingleton;
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

    logger.info(
      {
        contextChars: state.context?.length ?? 0,
        sources: state.sources?.length ?? 0,
      },
      `[${nodeName}] start`,
    );

    const promptTemplate = getPrompt("retrieval");
    const sourcesBlock = formatSources(state.sources ?? []);
    const prompt = promptTemplate
      .replace("{context}", state.context ?? "")
      .replace("{sources}", sourcesBlock)
      .replace("{query}", state.query);

    const system = new SystemMessage(
      "You are a precise assistant. Answer the user's question using only the provided context. " +
        "Cite sources inline using the bracket numbers (e.g. [1], [2]). If the context is insufficient, say so.",
    );

    const llm = getLlm();
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
      { answerChars: answer.length, model: env.OPENAI_MODEL_GENERATION },
      `[${nodeName}] done`,
    );

    return {
      draftAnswer: answer,
      finalAnswer: answer,
      messages: [new AIMessage(answer)],
      approved: true,
      metadata: {
        ...state.metadata,
        model: env.OPENAI_MODEL_GENERATION,
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
