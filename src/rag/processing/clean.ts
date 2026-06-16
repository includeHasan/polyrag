/**
 * Text cleaning utilities used between connector `load()` and the chunker.
 *
 * Goals (kept intentionally simple):
 *   1. Collapse runs of whitespace and normalize line endings.
 *   2. Strip page-header / page-footer style lines
 *      ("Page 3 of 12", "— 4 —", repeated copyright strings, ...).
 *   3. Drop any *line* that appears more than `repeatThreshold` times in the
 *      document (a robust signal for repeating boilerplate).
 *
 * Heavy NLP (lemmatization, sentence segmentation, ...) is intentionally
 * out of scope for the ingestion pipeline.
 */

const PAGE_HEADER_FOOTER_PATTERNS: RegExp[] = [
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
  /^\s*[-—–]\s*\d+\s*[-—–]\s*$/,
  /^\s*\d+\s*[-—–]\s*$/,
  /^\s*(chapter|section)\s+\d+(\.\d+)*\s*$/i,
  /^\s*copyright\s+\d{4}.*$/i,
  /^\s*all rights reserved\.?\s*$/i,
  /^\s*confidential\s*[-—–]?\s*$/i,
];

export interface CleanTextOptions {
  /** Lines seen more than this many times are considered boilerplate. */
  repeatThreshold?: number;
  /** Drop a line if it matches any of these regexes. */
  extraPatterns?: RegExp[];
  /** Normalize Unicode (NFKC). Off by default to preserve content. */
  normalizeUnicode?: boolean;
}

export function cleanText(text: string, options: CleanTextOptions = {}): string {
  if (!text) return "";
  const repeatThreshold = options.repeatThreshold ?? 3;
  const patterns = [...PAGE_HEADER_FOOTER_PATTERNS, ...(options.extraPatterns ?? [])];

  let working = text;

  // 1. Normalize line endings + (optionally) Unicode.
  working = working.replace(/\r\n?/g, "\n");
  if (options.normalizeUnicode) {
    working = working.normalize("NFKC");
  }

  // 2. Split into lines for the boilerplate pass.
  const rawLines = working.split("\n");

  // Count frequencies (after a trim+lowercase, so "  Page 1  " and "page 1" match).
  const freq = new Map<string, number>();
  for (const raw of rawLines) {
    const norm = raw.trim().toLowerCase();
    if (!norm) continue;
    freq.set(norm, (freq.get(norm) ?? 0) + 1);
  }

  const kept: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, "");
    if (!trimmed.trim()) {
      // Collapse runs of blank lines to a single blank line.
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (patterns.some((re) => re.test(trimmed))) continue;
    const norm = trimmed.trim().toLowerCase();
    if (freq.get(norm)! > repeatThreshold) continue;
    kept.push(trimmed);
  }

  // 3. Collapse multiple blank lines into a single blank line, then trim
  //    trailing whitespace on each line and the document as a whole.
  let result = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  // 4. Collapse runs of spaces (but not newlines) — keeps paragraph structure.
  result = result.replace(/[ \t]{2,}/g, " ");

  return result;
}
