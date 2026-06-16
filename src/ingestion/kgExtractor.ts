/**
 * Knowledge-graph extraction (Phase 4, write side).
 *
 * After a document is chunked + embedded + upserted into the vector store
 * and the BM25 index, we run a second pass that asks `gpt-4o-mini` (with
 * `withStructuredOutput`) to extract:
 *
 *   - entities  — typed surface forms (PERSON, ORG, CONCEPT, …)
 *   - relations — directed, typed edges between entities
 *
 * and writes them into the `entities`, `entity_mentions`, and
 * `entity_relations` tables via Prisma. This module reuses the
 * `getPrismaClient()` singleton exported from `src/retrieval/knowledgeGraph.ts`
 * so the read and write paths share one connection pool.
 *
 * The extraction is best-effort: any LLM or DB error is logged and swallowed
 * so a failing KG pass never blocks the rest of ingestion.
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import type { Chunk } from "../shared/types.js";
import { getPrismaClient } from "../retrieval/knowledgeGraph.js";

// ---------------------------------------------------------------------------
// Structured-output schema (Zod → gpt-4o-mini JSON-mode)
// ---------------------------------------------------------------------------
const ExtractedEntitySchema = z.object({
  name: z.string().min(1).describe("Canonical surface form of the entity."),
  type: z
    .string()
    .min(1)
    .describe('Entity type, e.g. "PERSON", "ORG", "CONCEPT", "PRODUCT".'),
  chunkIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("0-based index of the chunk in which the entity appears."),
});

const ExtractedRelationSchema = z.object({
  from: z.string().min(1).describe("Source entity name (must match an entity.name)."),
  to: z.string().min(1).describe("Target entity name (must match an entity.name)."),
  relation: z
    .string()
    .min(1)
    .describe('Relation type, e.g. "WORKS_FOR", "FOUNDED", "USES".'),
  chunkIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("0-based index of the chunk that supports this relation."),
});

const ExtractionSchema = z.object({
  entities: z.array(ExtractedEntitySchema).default([]),
  relations: z.array(ExtractedRelationSchema).default([]),
});

type Extraction = z.infer<typeof ExtractionSchema>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract entities/relations from a chunked document and persist them into
 * the knowledge-graph tables. Best-effort: logs and returns on any failure.
 *
 * Function signature: `(documentId, tenantId, chunks) → void`.
 */
export async function extractAndStoreEntities(
  documentId: string,
  tenantId: string | null,
  chunks: Chunk[],
): Promise<void> {
  if (chunks.length === 0) {
    logger.debug(
      { documentId },
      "kgExtractor: no chunks, skipping KG extraction",
    );
    return;
  }

  try {
    const llm = buildLlm();
    const extraction = await runExtraction(llm, chunks);
    if (!extraction) return; // logged inside runExtraction

    const prisma = getPrismaClient();

    // 1. Upsert entities (case-insensitive name + type + documentId) and
    //    resolve a Map<canonicalName, entityId> for the relation step.
    const entityNameToId = new Map<string, string>();
    const seenEntities = new Set<string>();

    for (const ent of extraction.entities) {
      const canonicalKey = `${ent.type.toUpperCase()}::${ent.name.trim()}`;
      if (seenEntities.has(canonicalKey)) continue;
      seenEntities.add(canonicalKey);

      const chunk = chunks[Math.min(ent.chunkIndex, chunks.length - 1)];
      try {
        const created = await prisma.entity.upsert({
          where: { id: `${documentId}:${canonicalKey}` }, // predictable id for upsert
          update: {},
          create: {
            id: `${documentId}:${canonicalKey}`,
            tenantId: tenantId ?? null,
            name: ent.name.trim(),
            type: ent.type.toUpperCase(),
            documentId,
          },
        });
        entityNameToId.set(ent.name.trim().toLowerCase(), created.id);

        // Store a mention row pointing at the chunk.
        if (chunk) {
          const position = chunk.text
            .toLowerCase()
            .indexOf(ent.name.trim().toLowerCase());
          await prisma.entityMention.create({
            data: {
              entityId: created.id,
              chunkId: chunk.chunkId,
              position: position >= 0 ? position : 0,
              context: snippetAround(chunk.text, ent.name),
            },
          });
        }
      } catch (err) {
        // Unique-constraint conflicts and similar should not abort the
        // whole extraction; log and continue.
        logger.warn(
          {
            err: (err as Error).message,
            documentId,
            entity: ent.name,
          },
          "kgExtractor: failed to persist entity",
        );
      }
    }

    // 2. Insert relations (best-effort). Skip if endpoints couldn't be
    //    resolved from the entity step.
    let relationsInserted = 0;
    for (const rel of extraction.relations) {
      const fromId = entityNameToId.get(rel.from.trim().toLowerCase());
      const toId = entityNameToId.get(rel.to.trim().toLowerCase());
      if (!fromId || !toId) {
        logger.debug(
          { from: rel.from, to: rel.to },
          "kgExtractor: relation endpoints not found among entities; skipping",
        );
        continue;
      }
      if (fromId === toId) continue; // self-loops are noise for retrieval
      try {
        await prisma.entityRelation.create({
          data: {
            fromEntityId: fromId,
            toEntityId: toId,
            relation: rel.relation.toUpperCase(),
            documentId,
            weight: 1.0,
          },
        });
        relationsInserted += 1;
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, documentId },
          "kgExtractor: failed to persist relation",
        );
      }
    }

    logger.info(
      {
        documentId,
        entities: seenEntities.size,
        relations: relationsInserted,
        chunks: chunks.length,
      },
      "kgExtractor: knowledge graph updated",
    );
  } catch (err) {
    // Catch-all so a failed KG pass never crashes ingestion.
    logger.warn(
      { err: (err as Error).message, documentId },
      "kgExtractor: extraction failed; skipping KG update",
    );
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const SAFE_MODEL = "gpt-4o-mini";
const MAX_CHARS_PER_CHUNK = 1_500;
const MAX_CHUNKS_PER_CALL = 25; // safety: don't blow the LLM context window

let llmSingleton: ChatOpenAI | undefined;

function buildLlm(): ChatOpenAI {
  if (llmSingleton) return llmSingleton;
  llmSingleton = new ChatOpenAI({
    model: env.OPENAI_MODEL_EVALUATION ?? SAFE_MODEL,
    apiKey: env.OPENAI_API_KEY,
    temperature: 0,
    maxRetries: 2,
  });
  return llmSingleton;
}

const SYSTEM_PROMPT =
  "You are a precise knowledge-graph extractor. Given a list of text chunks, " +
  "identify the named entities (people, organizations, products, locations, " +
  "concepts) and the typed relations between them that are explicitly " +
  "supported by the text. Use the exact surface form from the text for each " +
  "entity name. Do not invent relations that are not present. Be conservative.";

async function runExtraction(
  llm: ChatOpenAI,
  chunks: Chunk[],
): Promise<Extraction | null> {
  const slice = chunks.slice(0, MAX_CHUNKS_PER_CALL);
  const numbered = slice
    .map((c, i) => {
      const text = c.text.length > MAX_CHARS_PER_CHUNK
        ? c.text.slice(0, MAX_CHARS_PER_CHUNK) + "…"
        : c.text;
      return `[${i}] ${text}`;
    })
    .join("\n\n");

  try {
    const structured = llm.withStructuredOutput(ExtractionSchema, {
      name: "KGExtraction",
    });
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Chunks:\n${numbered}`),
    ];
    const result = (await structured.invoke(messages)) as Extraction;
    return {
      entities: (result.entities ?? []).filter((e) => e.name?.trim()),
      relations: (result.relations ?? []).filter(
        (r) => r.from?.trim() && r.to?.trim() && r.relation?.trim(),
      ),
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, chunks: chunks.length },
      "kgExtractor: LLM extraction failed; skipping KG update",
    );
    return null;
  }
}

/**
 * Return a short window of `text` around the first occurrence of `name`.
 * Falls back to a prefix of the text when `name` is missing.
 */
function snippetAround(text: string, name: string): string {
  const idx = name
    ? text.toLowerCase().indexOf(name.toLowerCase())
    : -1;
  if (idx < 0) return text.slice(0, 240);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + name.length + 160);
  return text.slice(start, end);
}
