/**
 * OpenAiReranker — uses a chat model as a relevance judge.
 *
 * Strategy: ask the configured `OPENAI_MODEL_RERANK` model to score every
 * candidate chunk on a 0–10 scale given the user query, then sort and keep
 * the top `topN`. Each chunk is scored in a single batched call to keep
 * the round-trip cost low.
 *
 * The score is also written back onto the chunk's `metadata.tags` (as
 * `rerank:<score>`) so downstream consumers can see the rerank score next
 * to the original retrieval score.
 */
import { ChatOpenAI } from "@langchain/openai";
import { env } from "@/core/config/env.js";
import { RetrievalError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Chunk } from "@/core/shared/types.js";
import { BaseReranker } from "./base.js";

const RERANK_PROMPT = `You are a relevance grader. Given a user question and a passage, output a single integer 0-10 representing how useful the passage is for answering the question. Output ONLY the integer, nothing else.

Question: {query}

Passage:
{passage}

Score (0-10):`;

const SAFE_MODEL = "gpt-4o-mini";

export class OpenAiReranker extends BaseReranker {
  readonly name = "openai";
  private readonly client: ChatOpenAI;
  private readonly model: string;

  constructor(opts?: { model?: string; apiKey?: string }) {
    super();
    this.model = opts?.model ?? env.OPENAI_MODEL_RERANK ?? SAFE_MODEL;
    this.client = new ChatOpenAI({
      model: this.model,
      apiKey: opts?.apiKey ?? env.OPENAI_API_KEY,
      temperature: 0,
      maxRetries: 2,
    });
  }

  async rerank(query: string, chunks: Chunk[], topN: number): Promise<Chunk[]> {
    if (chunks.length === 0) return [];
    const safeTopN = Math.max(0, Math.min(topN, chunks.length));

    try {
      const scored: Array<{ chunk: Chunk; score: number }> = [];
      for (const chunk of chunks) {
        const score = await this.scoreOne(query, chunk.text);
        scored.push({ chunk, score });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, safeTopN);

      logger.debug(
        {
          retriever: this.name,
          model: this.model,
          in: chunks.length,
          out: top.length,
        },
        "OpenAiReranker complete",
      );

      return top.map((entry) => this.tagScore(entry.chunk, entry.score));
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `OpenAiReranker failed: ${(err as Error).message}`,
        err,
      );
    }
  }

  private async scoreOne(query: string, passage: string): Promise<number> {
    const prompt = RERANK_PROMPT.replace("{query}", query).replace(
      "{passage}",
      passage.length > 4000 ? passage.slice(0, 4000) : passage,
    );
    try {
      const res = await this.client.invoke(prompt);
      const text = (res.content as string).trim();
      const m = text.match(/-?\d+(\.\d+)?/);
      if (!m) return 0;
      const n = Number(m[0]);
      if (Number.isNaN(n)) return 0;
      return Math.max(0, Math.min(10, n));
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "OpenAiReranker: failed to score one chunk, assigning 0",
      );
      return 0;
    }
  }

  /** Attach the rerank score to the chunk's metadata for traceability. */
  private tagScore(chunk: Chunk, score: number): Chunk {
    const tags = Array.isArray(chunk.metadata?.tags) ? [...chunk.metadata.tags] : [];
    tags.push(`rerank:${score.toFixed(2)}`);
    return {
      ...chunk,
      metadata: { ...(chunk.metadata ?? { tags: [] }), tags },
    };
  }
}
