/**
 * In-process BM25 keyword index.
 *
 * Phase 2 default keyword store. Provides ranked retrieval by term frequency
 * without requiring an external Elasticsearch / OpenSearch cluster. The
 * index is held in memory and persisted via a JSON snapshot on disk
 * (`storage/bm25-index.json`) so it survives restarts.
 *
 * This is intentionally simple — just a working BM25 implementation. For
 * production scale, swap to Elasticsearch (the `keywordSearch` function in
 * `src/database/elasticsearch.ts` exposes the same `Retriever` contract).
 *
 * The scoring follows the standard Okapi BM25:
 *   score(D, Q) = Σ_{q ∈ Q}  IDF(q) · (f(q,D) · (k1 + 1)) / (f(q,D) + k1 · (1 - b + b · |D|/avgdl))
 *
 * Default parameters: k1 = 1.5, b = 0.75 (the well-known Robertson–Walker
 * constants).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@/shared/logger.js";
import type { Chunk } from "@/shared/types.js";
import { assertTenantFilter, SYSTEM_SCOPE } from "@/tenancy/guard.js";

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;
const STORAGE_PATH = join(process.cwd(), "storage", "bm25-index.json");

/** A single document in the BM25 index. */
export interface BM25Doc {
  /** chunkId — the unique key. */
  id: string;
  /** Document frequency — used for IDF. */
  df: number;
  /** Term frequencies for this document. */
  tf: Map<string, number>;
  /** Document length in tokens. */
  len: number;
  /** Cached chunk for retrieval. */
  chunk: Chunk;
  /** Tenant that owns this document — used for isolation filtering. */
  tenantId?: string;
}

export interface BM25SearchHit {
  chunk: Chunk;
  score: number;
}

/** Lightweight English-ish tokenizer: lowercase, split on non-alphanumerics, drop stopwords. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "in", "is", "it", "its", "of", "on", "or", "that",
  "the", "to", "was", "were", "will", "with", "this", "but", "not",
  "they", "you", "we", "i", "he", "she", "him", "her", "their",
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

interface PersistedIndex {
  /** Map<docId, { df, tf-as-array, len, chunk }> */
  docs: Array<{ id: string; df: number; tf: [string, number][]; len: number; chunk: Chunk }>;
  /** Map<term, docFrequency> */
  docFreq: Array<[string, number]>;
  /** Total number of docs (for average document length). */
  totalDocs: number;
  /** Sum of document lengths. */
  totalLen: number;
}

export class InProcessBM25Index {
  private readonly docs = new Map<string, BM25Doc>();
  private readonly docFreq = new Map<string, number>(); // term -> number of docs containing it
  private totalDocs = 0;
  private totalLen = 0;
  private readonly k1: number;
  private readonly b: number;
  private readonly storagePath: string;
  private dirty = false;

  constructor(opts?: { k1?: number; b?: number; storagePath?: string }) {
    this.k1 = opts?.k1 ?? DEFAULT_K1;
    this.b = opts?.b ?? DEFAULT_B;
    this.storagePath = opts?.storagePath ?? STORAGE_PATH;
  }

  /** Add or replace a chunk in the index. */
  upsert(chunk: Chunk): void {
    if (this.docs.has(chunk.chunkId)) {
      this.remove(chunk.chunkId);
    }
    const tokens = tokenize(chunk.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const len = tokens.length;
    const seenTerms = new Set<string>();

    for (const term of tf.keys()) {
      seenTerms.add(term);
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.docs.set(chunk.chunkId, {
      id: chunk.chunkId,
      df: 0, // not used per-doc; kept for shape compat
      tf,
      len,
      chunk,
      tenantId: chunk.metadata.tenantId,
    });
    this.totalDocs += 1;
    this.totalLen += len;
    void seenTerms;
    this.dirty = true;
  }

  /** Bulk-upsert a batch. */
  upsertBatch(chunks: Chunk[]): void {
    for (const c of chunks) this.upsert(c);
  }

  /** Remove a chunk by id. */
  remove(chunkId: string): boolean {
    const doc = this.docs.get(chunkId);
    if (!doc) return false;
    for (const term of doc.tf.keys()) {
      const df = this.docFreq.get(term) ?? 0;
      if (df <= 1) this.docFreq.delete(term);
      else this.docFreq.set(term, df - 1);
    }
    this.totalDocs -= 1;
    this.totalLen -= doc.len;
    this.docs.delete(chunkId);
    this.dirty = true;
    return true;
  }

  /** Number of indexed documents. */
  size(): number {
    return this.docs.size;
  }

  /**
   * Look up a chunk by id. Returns the cached `Chunk` payload or `undefined`
   * if the chunk is not in the index. Used by the knowledge-graph retriever
   * to hydrate full chunk records from a chunkId reference.
   */
  getChunk(chunkId: string): Chunk | undefined {
    return this.docs.get(chunkId)?.chunk;
  }

  /**
   * BM25 search. Returns top-k hits sorted by descending score.
   * If no docs match, returns an empty array.
   * Pass a tenantId to restrict results to that tenant; pass SYSTEM_SCOPE
   * (or omit) to search across all tenants (super-admin / system calls only).
   */
  search(query: string, k: number, tenantId?: string | null): BM25SearchHit[] {
    assertTenantFilter(tenantId ?? null);
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.size === 0) return [];

    const avgdl = this.totalLen / this.totalDocs;
    const scores: Array<{ id: string; score: number }> = [];

    for (const doc of this.docs.values()) {
      let score = 0;
      for (const term of queryTokens) {
        const f = doc.tf.get(term) ?? 0;
        if (f === 0) continue;
        const df = this.docFreq.get(term) ?? 0;
        // IDF with a +1 to avoid negative values when a term appears in most docs.
        const idf = Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5));
        const denom = f + this.k1 * (1 - this.b + (this.b * doc.len) / Math.max(avgdl, 1));
        const contribution = idf * ((f * (this.k1 + 1)) / denom);
        score += contribution;
      }
      if (score > 0) scores.push({ id: doc.id, score });
    }

    scores.sort((a, b) => b.score - a.score);

    const filtered =
      tenantId && tenantId !== SYSTEM_SCOPE
        ? scores.filter((e) => this.docs.get(e.id)?.tenantId === tenantId)
        : scores;

    return filtered.slice(0, k).map((entry) => {
      const doc = this.docs.get(entry.id)!;
      return { chunk: doc.chunk, score: entry.score };
    });
  }

  /** Persist the index to disk as JSON. Safe to call repeatedly. */
  save(): void {
    if (!this.dirty) return;
    const persisted: PersistedIndex = {
      docs: Array.from(this.docs.values()).map((d) => ({
        id: d.id,
        df: d.df,
        tf: Array.from(d.tf.entries()),
        len: d.len,
        chunk: d.chunk,
      })),
      docFreq: Array.from(this.docFreq.entries()),
      totalDocs: this.totalDocs,
      totalLen: this.totalLen,
    };
    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(persisted), "utf-8");
      logger.debug({ path: this.storagePath, docs: this.docs.size }, "BM25 index saved");
      this.dirty = false;
    } catch (err) {
      logger.warn({ err, path: this.storagePath }, "Failed to save BM25 index");
    }
  }

  /** Load a persisted index from disk. Returns true on success. */
  load(): boolean {
    if (!existsSync(this.storagePath)) return false;
    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const persisted = JSON.parse(raw) as PersistedIndex;
      this.docs.clear();
      this.docFreq.clear();
      for (const entry of persisted.docs) {
        this.docs.set(entry.id, {
          id: entry.id,
          df: entry.df,
          tf: new Map(entry.tf),
          len: entry.len,
          chunk: entry.chunk,
          tenantId: entry.chunk.metadata.tenantId,
        });
      }
      for (const [term, df] of persisted.docFreq) {
        this.docFreq.set(term, df);
      }
      this.totalDocs = persisted.totalDocs;
      this.totalLen = persisted.totalLen;
      logger.info(
        { path: this.storagePath, docs: this.docs.size, terms: this.docFreq.size },
        "BM25 index loaded",
      );
      this.dirty = false;
      return true;
    } catch (err) {
      logger.warn({ err, path: this.storagePath }, "Failed to load BM25 index");
      return false;
    }
  }

  /** Wipe the index in memory and on disk. */
  reset(): void {
    this.docs.clear();
    this.docFreq.clear();
    this.totalDocs = 0;
    this.totalLen = 0;
    this.dirty = true;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let cached: InProcessBM25Index | undefined;

export function getBM25Index(): InProcessBM25Index {
  if (cached) return cached;
  cached = new InProcessBM25Index();
  cached.load();
  return cached;
}

/** Test helper. */
export function resetBM25Index(): void {
  if (cached) cached.reset();
  cached = undefined;
}
