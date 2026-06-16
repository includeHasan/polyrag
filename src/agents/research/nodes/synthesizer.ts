/**
 * `synthesizer` node — weave the accumulated findings into a cited answer.
 *
 * Uses `ChatOpenAI` to turn the `findings: Chunk[]` collected by the
 * parallel searcher instances into a single coherent answer with `[N]`
 * inline citations. If the LLM call fails we still produce a deterministic
 * fallback so the graph always completes.
 */
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { env } from "@/core/config/env.js";
import { GenerationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Chunk, Source } from "@/core/shared/types.js";
import type { ResearchState } from "../state.js";

let llmSingleton: ChatOpenAI | undefined;

/** Lazily build the synthesizer chat model. */
function getLlm(): ChatOpenAI {
  if (llmSingleton) return llmSingleton;
  llmSingleton = new ChatOpenAI({
    model: env.OPENAI_MODEL_GENERATION,
    apiKey: env.OPENAI_API_KEY,
    temperature: 0.2,
  });
  return llmSingleton;
}

/** Convert Chunks to Source records (stable order). */
function chunksToSources(chunks: Chunk[]): Source[] {
  return chunks.map((c) => {
    const meta = c.metadata ?? { tags: [] };
    const source: Source = {
      documentId: c.documentId,
      title: meta.source ?? c.documentId,
      page: c.page,
      chunkId: c.chunkId,
      snippet: (c.text ?? "").slice(0, 400),
    };
    return source;
  });
}

/** Build a numbered, deduplicated citation list for the LLM prompt. */
function formatCitationList(sources: Source[]): string {
  if (sources.length === 0) return "(no findings)";
  return sources
    .map((s, i) => {
      const where = s.page ? `, p.${s.page}` : "";
      const url = s.url ? ` ${s.url}` : "";
      return `[${i + 1}] ${s.title}${where}${url} — ${s.snippet}`;
    })
    .join("\n");
}

const SYSTEM_PROMPT =
  "You are a careful research synthesizer. Using ONLY the numbered " +
  "findings below, produce a coherent, well-structured answer to the " +
  "user's original question. Cite sources inline using the bracket " +
  "numbers (e.g. [1], [2]). If the findings are insufficient, say so " +
  "explicitly rather than inventing facts. Do not include a bibliography " +
  "section — citations go inline.";

export async function synthesizerNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "synthesizer";
  try {
    const findings: Chunk[] = Array.isArray(state.findings) ? state.findings : [];
    const sources = chunksToSources(findings);

    logger.info(
      { findings: findings.length, sources: sources.length },
      `[${nodeName}] start`,
    );

    let finalAnswer: string;
    let draftAnswer: string;
    let usedModel = env.OPENAI_MODEL_GENERATION;

    if (findings.length === 0) {
      finalAnswer = `No research findings were retrieved for "${state.query ?? ""}".`;
      draftAnswer = finalAnswer;
    } else {
      const citationList = formatCitationList(sources);
      const userPrompt =
        `Original question: ${state.query}\n\n` +
        `Findings (numbered, cite inline as [N]):\n${citationList}\n\n` +
        `Write a thorough, cited answer.`;

      try {
        const llm = getLlm();
        const response = await llm.invoke([
          new SystemMessage(SYSTEM_PROMPT),
          { role: "user", content: userPrompt },
        ]);
        finalAnswer =
          typeof response.content === "string"
            ? response.content
            : Array.isArray(response.content)
              ? response.content
                  .map((p) =>
                    typeof p === "string" ? p : (p as { text?: string }).text ?? "",
                  )
                  .join("")
              : String(response.content ?? "");
        draftAnswer = finalAnswer;
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          `[${nodeName}] LLM call failed, using deterministic fallback`,
        );
        usedModel = "fallback";
        const draft = fallbackSynthesize(state.query ?? "", findings);
        draftAnswer = draft;
        finalAnswer = draft;
      }
    }

    logger.info(
      {
        answerChars: finalAnswer.length,
        citationCount: sources.length,
        model: usedModel,
      },
      `[${nodeName}] done`,
    );

    return {
      draftAnswer,
      finalAnswer,
      complete: true,
      messages: [new AIMessage(finalAnswer)],
      metadata: {
        ...state.metadata,
        citationCount: sources.length,
        answerChars: finalAnswer.length,
        model: usedModel,
        node: nodeName,
      },
    };
  } catch (err) {
    if (err instanceof GenerationError) throw err;
    logger.error({ err }, `[${nodeName}] failed`);
    throw new GenerationError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}

/**
 * Deterministic fallback that joins the findings into a short, cited
 * summary without calling the LLM. Used when the API is unavailable.
 */
function fallbackSynthesize(query: string, findings: Chunk[]): string {
  const lines: string[] = [
    `Research summary for: ${query}`,
    "",
  ];
  findings.forEach((c, i) => {
    const title = c.metadata?.source ?? c.documentId;
    const where = c.page ? ` (p.${c.page})` : "";
    const snippet = (c.text ?? "").slice(0, 280);
    lines.push(`- [${i + 1}] ${title}${where}: ${snippet}`);
  });
  return lines.join("\n");
}
