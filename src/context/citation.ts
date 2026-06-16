/**
 * Citation extraction — finds `[N]` markers in an LLM answer and validates
 * that each `N` corresponds to a real source in the `sources` array.
 *
 * Multiple brackets next to each other (`[1][3]`) are each treated as a
 * separate marker; nested or out-of-range markers are reported as invalid
 * but the surrounding valid markers are still returned.
 */
export interface Citation {
  marker: string;        // e.g. "[1]"
  sourceIndex: number;   // 1-based
}

export interface CitationExtractionResult {
  valid: boolean;
  citations: Citation[];
}

const MARKER_REGEX = /\[(\d+)\]/g;

export function extractCitations(
  answer: string,
  sources: ReadonlyArray<unknown>,
): CitationExtractionResult {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let allValid = true;

  for (const m of answer.matchAll(MARKER_REGEX)) {
    const n = Number(m[1]);
    const marker = `[${n}]`;
    if (seen.has(marker)) continue;
    seen.add(marker);

    if (Number.isInteger(n) && n >= 1 && n <= sources.length) {
      citations.push({ marker, sourceIndex: n });
    } else {
      allValid = false;
    }
  }

  return { valid: allValid && citations.length > 0, citations };
}
