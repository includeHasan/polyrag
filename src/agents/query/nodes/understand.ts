/**
 * `understand` node — Phase 1 heuristic classifier.
 *
 * Real implementation will use an LLM call to populate a full
 * `QueryUnderstanding`. For Phase 1 we use simple regex / string
 * detection so the rest of the graph is wired up end-to-end.
 */
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "@/core/shared/logger.js";
import { QueryUnderstandingSchema } from "@/core/shared/types.js";
import { GenerationError } from "@/core/shared/errors.js";
import type { QueryState } from "../state.js";

const FACTUAL_PATTERN = /(\?|what|who|where|when|which|how\b|why\b)/i;
const SUMMARIZE_PATTERN = /\b(summari[sz]e|summary|recap|tl;?dr)\b/i;
const COMPARISON_PATTERN = /\b(compare|versus|vs\.?|difference|pros\s+and\s+cons)\b/i;
const RESEARCH_PATTERN = /\b(research|investigate|deep\s*dive|comprehensive|thorough)\b/i;
const ANALYTICAL_PATTERN = /\b(analy[sz]e|evaluate|assess|interpret|why\b|how\s+come)\b/i;
const WORD_RE = /[A-Z][a-zA-Z0-9]+/g;

/**
 * Detect intent from the query text using layered regex matches.
 * Order matters — more specific patterns win.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectIntent(query: string): any {
  const q = query ?? "";
  if (SUMMARIZE_PATTERN.test(q)) return "summarization";
  if (COMPARISON_PATTERN.test(q)) return "comparison";
  if (RESEARCH_PATTERN.test(q)) return "research";
  if (ANALYTICAL_PATTERN.test(q)) return "analytical";
  if (FACTUAL_PATTERN.test(q)) return "factual";
  return "conversational";
}

/** Extract probable named entities by capitalizing the first letter of words. */
function extractEntities(query: string): string[] {
  const matches = query.match(WORD_RE) ?? [];
  // Deduplicate while preserving insertion order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (m.length < 2) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

export async function understandNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "understand";
  try {
    logger.info({ query: state.query }, `[${nodeName}] start`);

    const intent = detectIntent(state.query);
    const entities = extractEntities(state.query);

    const understanding = QueryUnderstandingSchema.parse({
      intent,
      entities,
      filters: {},
      rewrittenQueries: [state.query],
    });

    logger.info(
      { intent, entityCount: entities.length },
      `[${nodeName}] classified`,
    );

    return {
      understanding,
      // Seed the chat history with the user's question so downstream nodes
      // can see the full conversation if they need to.
      messages: [new HumanMessage(state.query)],
      metadata: {
        ...state.metadata,
        intent,
        entityCount: entities.length,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new GenerationError(
      `[${nodeName}] failed to classify query: ${(err as Error).message}`,
      err,
    );
  }
}
