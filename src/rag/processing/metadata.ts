/**
 * Metadata extraction & merging. The chunker calls this once per document
 * so that every produced `Chunk` carries a uniform `ChunkMetadata` block.
 *
 * Merge order (later wins on key conflict):
 *   1. Document's own `metadata` (set by the connector).
 *   2. Caller-provided `hint` (IngestRequest.metadata + tags + department).
 *   3. PDF `info` fields (`Author`, `CreationDate`, `ModDate`, `Title`),
 *      only if the document came from a PDF and the document metadata
 *      doesn't already have `author` / `date`.
 */
import type { ChunkMetadata, Document, IngestRequest } from "@/core/shared/types.js";

export interface MetadataHint {
  /** Free-form extra fields from the IngestRequest. */
  fields?: Record<string, unknown>;
  /** Tags from the IngestRequest. */
  tags?: string[];
  /** Department from the IngestRequest. */
  department?: string;
  /** Override the resolved author. */
  author?: string;
  /** Override the resolved date. */
  date?: string;
}

/** Either an IngestRequest or a richer MetadataHint. */
export type MetadataInput = MetadataHint | IngestRequest | Record<string, unknown>;

export function extractMetadata(
  document: Document,
  hint: MetadataInput = {},
): ChunkMetadata {
  const docMeta = (document.metadata ?? {}) as Record<string, unknown>;

  // Pull PDF `info` if present. The PDF connector stores it under `pdfInfo`.
  const pdfInfo = (docMeta.pdfInfo ?? {}) as Record<string, unknown>;
  const hintObj = (hint ?? {}) as Record<string, unknown>;

  const author =
    pickString(hintObj, "author") ??
    pickString(docMeta, "author") ??
    pickString(pdfInfo, "Author");
  const date =
    pickString(hintObj, "date") ??
    pickString(docMeta, "date") ??
    pickString(pdfInfo, "CreationDate") ??
    pickString(pdfInfo, "ModDate");

  const base: ChunkMetadata = {
    source: document.source,
    author,
    date,
    department:
      pickString(hintObj, "department") ?? pickString(docMeta, "department"),
    tags: [],
  };

  // Tags: hint > document.metadata.tags > []
  const tagSet = new Set<string>();
  for (const t of hintTags(hint)) tagSet.add(t);
  const docTags = docMeta.tags;
  if (Array.isArray(docTags)) {
    for (const t of docTags) {
      if (typeof t === "string") tagSet.add(t);
    }
  }
  base.tags = Array.from(tagSet);

  // Allow arbitrary extra fields to be passed through on the document metadata
  // side; we don't surface them in `ChunkMetadata` directly (schema is closed)
  // but callers can store them on the Document and read them in the retriever.
  return base;
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (typeof v === "string" && v.trim().length > 0) return v;
  if (v instanceof Date) return v.toISOString();
  return undefined;
}

function hintTags(hint: MetadataInput): string[] {
  if (!hint || typeof hint !== "object") return [];
  const candidate = (hint as { tags?: unknown }).tags;
  if (Array.isArray(candidate)) {
    return candidate.filter((t): t is string => typeof t === "string");
  }
  return [];
}
