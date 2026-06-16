/**
 * ContextBuilder — packs chunks into a numbered context string and emits
 * matching `Source` records.
 *
 * Pipeline:
 *   1. Dedupe by `chunkId` (keep the highest-score copy).
 *   2. Sort by score desc.
 *   3. Pack chunks into a context string whose total tokens (counted via
 *      `tiktoken`) fit within `modelMaxTokens - promptOverhead`.
 *   4. Build a parallel `sources` array: sources[i] corresponds to the
 *      `[i+1]` marker in the context.
 *
 * The default model is `gpt-4o` (128k context, leaving 4k for prompt +
 * completion overhead) but callers can override both `model` and
 * `promptOverhead` in the constructor.
 */
import { RetrievalError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { Chunk, Source } from "../shared/types.js";
import type { ContextBuilder as ContextBuilderInterface } from "../shared/interfaces.js";
import { countTokens } from "./tokenCounter.js";

export interface ContextBuilderOptions {
  model?: string;
  modelMaxTokens?: number;
  promptOverhead?: number;
  /** Cap the number of chunks (in addition to the token budget). */
  maxChunks?: number;
}

interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MODEL_MAX_TOKENS = 128_000;
const DEFAULT_PROMPT_OVERHEAD = 4_000;
const DEFAULT_MAX_CHUNKS = 50;

export class ContextBuilder implements ContextBuilderInterface {
  private readonly model: string;
  private readonly modelMaxTokens: number;
  private readonly promptOverhead: number;
  private readonly maxChunks: number;

  constructor(opts: ContextBuilderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.modelMaxTokens = opts.modelMaxTokens ?? DEFAULT_MODEL_MAX_TOKENS;
    this.promptOverhead = opts.promptOverhead ?? DEFAULT_PROMPT_OVERHEAD;
    this.maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;
  }

  async build(
    _query: string,
    chunks: Chunk[],
  ): Promise<{ context: string; sources: Source[] }> {
    try {
      const deduped = this.dedupe(chunks);
      const sorted = this.sortByScore(deduped);
      const budget = Math.max(0, this.modelMaxTokens - this.promptOverhead);
      const { packed, sources } = this.pack(sorted, budget);

      logger.debug(
        {
          in: chunks.length,
          deduped: deduped.length,
          packed: packed.length,
          budget,
        },
        "ContextBuilder complete",
      );

      return { context: this.render(packed, sources), sources };
    } catch (err) {
      if (err instanceof RetrievalError) throw err;
      throw new RetrievalError(
        `ContextBuilder failed: ${(err as Error).message}`,
        err,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private dedupe(chunks: Chunk[]): ScoredChunk[] {
    const byId = new Map<string, ScoredChunk>();
    for (const c of chunks) {
      const existing = byId.get(c.chunkId);
      if (!existing) {
        byId.set(c.chunkId, { chunk: c, score: this.scoreOf(c) });
        continue;
      }
      const incomingScore = this.scoreOf(c);
      if (incomingScore > existing.score) {
        byId.set(c.chunkId, { chunk: c, score: incomingScore });
      }
    }
    return Array.from(byId.values());
  }

  private sortByScore(items: ScoredChunk[]): ScoredChunk[] {
    return [...items].sort((a, b) => b.score - a.score);
  }

  /**
   * Greedy token-budget packer. The first chunk's tokens are always paid
   * (even if it would blow the budget) so that the answer is never empty
   * when there's at least one candidate. Subsequent chunks are skipped if
   * adding them would exceed the budget.
   */
  private pack(
    sorted: ScoredChunk[],
    budget: number,
  ): { packed: ScoredChunk[]; sources: Source[] } {
    const packed: ScoredChunk[] = [];
    const sources: Source[] = [];
    let used = 0;

    for (const entry of sorted) {
      if (packed.length >= this.maxChunks) break;
      const body = this.renderEntry(entry, packed.length);
      const cost = countTokens(body, this.model);
      if (packed.length > 0 && used + cost > budget) {
        continue;
      }
      packed.push(entry);
      sources.push(this.toSource(entry, packed.length));
      used += cost;
    }

    return { packed, sources };
  }

  private render(entries: ScoredChunk[], sources: Source[]): string {
    return entries
      .map((entry, i) => this.renderEntry(entry, i))
      .join("\n\n");
  }

  private renderEntry(entry: ScoredChunk, index: number): string {
    const header = this.formatHeader(entry, index);
    return `${header}\n${entry.chunk.text}`;
  }

  private formatHeader(entry: ScoredChunk, index: number): string {
    const c = entry.chunk;
    const title = this.titleOf(c);
    const n = index + 1;
    if (c.page !== undefined) {
      return `[${n}] (document: "${title}", page ${c.page}, score ${entry.score.toFixed(2)})`;
    }
    return `[${n}] (document: "${title}", chunk ${c.chunkId})`;
  }

  private toSource(entry: ScoredChunk, index: number): Source {
    const c = entry.chunk;
    const snippet =
      c.text.length > 240 ? `${c.text.slice(0, 240).trim()}...` : c.text;
    return {
      documentId: c.documentId,
      title: this.titleOf(c),
      page: c.page,
      chunkId: c.chunkId,
      snippet,
      score: Number(entry.score.toFixed(4)),
    };
  }

  private titleOf(c: Chunk): string {
    // Title may live in metadata (per source) or fall back to the section /
    // documentId. We never want to emit an empty title because the
    // citation header is human-readable.
    const fromMeta = (c.metadata as Record<string, unknown> | undefined)?.title;
    if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
    return c.section ?? c.documentId;
  }

  private scoreOf(c: Chunk): number {
    // The retrieval pipeline doesn't put a score on the chunk itself;
    // HybridRetriever's tagScore and Qdrant scores may both end up here.
    const meta = c.metadata as Record<string, unknown> | undefined;
    const metaScore = meta?.score;
    if (typeof metaScore === "number") return metaScore;
    // Default to 0 so unknown chunks sort to the bottom but are still
    // eligible for inclusion.
    return 0;
  }
}
