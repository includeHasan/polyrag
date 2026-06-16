/**
 * Lightweight structural parser. Splits a document into coarse sections
 * (heading + body) before the chunker runs, so each `Chunk` can carry the
 * `section` it came from.
 *
 * Heuristics only — no AST, no LLM. Good enough to recover Markdown / numbered
 * heading structure; the chunker downstream is the source of truth for
 * chunk boundaries.
 */
import type { Document } from "../shared/types.js";

export interface ParsedSection {
  heading: string;
  body: string;
  /** 1-indexed page number, when the format preserves it. */
  page?: number;
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const NUMBERED_HEADING =
  /^\s*(\d+(?:\.\d+){0,4})[\.\)]?\s+([A-Z][^\n]{2,80})\s*$/;
// Form-feed pages are emitted by `pdftotext` and `pdf-parse`; treat them as
// page boundaries we can count.
const FORM_FEED = "\f";

export function parseSections(
  text: string,
  format: Document["metadata"]["format"] | "txt" | "md" | "pdf" | "docx" = "txt",
): ParsedSection[] {
  if (!text || !text.trim()) return [];
  const fmt = String(format).toLowerCase();

  if (fmt === "md" || fmt === "markdown") {
    return parseMarkdown(text);
  }
  if (fmt === "pdf") {
    return parseWithPageBreaks(text, (line) => MD_HEADING.test(line) || NUMBERED_HEADING.test(line));
  }
  if (fmt === "docx") {
    // DOCX headings aren't preserved by `mammoth.extractRawText`, so fall back
    // to numbered-heading detection. If none, return a single section.
    const out = parseNumbered(text);
    return out.length > 0 ? out : [{ heading: "Document", body: text.trim() }];
  }
  // Default: plain text with numbered headings.
  const out = parseNumbered(text);
  return out.length > 0 ? out : [{ heading: "Document", body: text.trim() }];
}

function parseMarkdown(text: string): ParsedSection[] {
  const lines = text.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { heading: "Document", body: "" };

  for (const line of lines) {
    const m = MD_HEADING.exec(line);
    if (m) {
      if (current.body.trim() || current.heading !== "Document") {
        sections.push(finalize(current));
      }
      current = { heading: m[2].trim(), body: "" };
    } else {
      current.body += current.body ? `\n${line}` : line;
    }
  }
  sections.push(finalize(current));
  return sections.filter((s) => s.body.trim().length > 0 || s.heading !== "Document");
}

function parseNumbered(text: string): ParsedSection[] {
  const lines = text.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { heading: "Document", body: "" };

  for (const line of lines) {
    const m = NUMBERED_HEADING.exec(line);
    if (m) {
      if (current.body.trim() || current.heading !== "Document") {
        sections.push(finalize(current));
      }
      current = { heading: `${m[1]} ${m[2]}`.trim(), body: "" };
    } else {
      current.body += current.body ? `\n${line}` : line;
    }
  }
  sections.push(finalize(current));
  return sections.filter((s) => s.body.trim().length > 0 || s.heading !== "Document");
}

/** For PDFs, walk the text using form-feed characters as page markers. */
function parseWithPageBreaks(
  text: string,
  isHeading: (line: string) => boolean,
): ParsedSection[] {
  const pages = text.split(FORM_FEED);
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { heading: "Document", body: "", page: 1 };

  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    const lines = pageText.split("\n");
    for (const line of lines) {
      if (isHeading(line)) {
        if (current.body.trim() || current.heading !== "Document") {
          sections.push(finalize(current));
        }
        current = {
          heading: line.replace(/^#+\s*/, "").trim(),
          body: "",
          page: pageNum,
        };
      } else {
        if (!current.page) current.page = pageNum;
        current.body += current.body ? `\n${line}` : line;
      }
    }
  });
  sections.push(finalize(current));
  return sections.filter((s) => s.body.trim().length > 0 || s.heading !== "Document");
}

function finalize(s: ParsedSection): ParsedSection {
  return {
    heading: s.heading,
    body: s.body.replace(/\s+$/g, "").replace(/^\s+/g, ""),
    page: s.page,
  };
}
