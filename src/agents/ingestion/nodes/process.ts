/**
 * `process` node — clean raw text, parse structural sections, enrich with
 * document-level metadata.
 */
import { logger } from "@/core/shared/logger.js";
import { IngestionError } from "@/core/shared/errors.js";
import { cleanText } from "@/rag/processing/clean.js";
import { parseSections } from "@/rag/processing/parse.js";
import { extractMetadata } from "@/rag/processing/metadata.js";
import type { IngestionState } from "../state.js";

export async function processNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "process";
  try {
    if (!state.rawContent) {
      throw new IngestionError(`[${nodeName}] rawContent is empty — run 'load' first`);
    }
    if (!state.documentId) {
      throw new IngestionError(`[${nodeName}] documentId is missing — run 'load' first`);
    }

    logger.info(
      { documentId: state.documentId, chars: state.rawContent.length },
      `[${nodeName}] start`,
    );

    const cleaned = cleanText(state.rawContent);
    const format =
      (state.metadata.format as string | undefined) ?? state.request.source;
    const sections = parseSections(cleaned, format);
    const docMeta = extractMetadata(
      { content: cleaned, id: state.documentId, source: state.request.source, title: state.title ?? "", metadata: state.metadata },
      {
        title: state.title,
        tags: state.request.tags,
        department: state.request.department,
        ...state.request.metadata,
      },
    );

    logger.info(
      { cleanedChars: cleaned.length, sections: sections.length },
      `[${nodeName}] done`,
    );

    return {
      processedContent: cleaned,
      sections,
      metadata: {
        ...state.metadata,
        ...docMeta,
        node: nodeName,
      },
    };
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new IngestionError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
