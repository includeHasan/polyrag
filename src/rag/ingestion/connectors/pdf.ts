/**
 * PDF connector. Uses `pdf-parse` (default export) — the library is CJS, so
 * we dynamic-import it inside `load()` to keep ESM context happy.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { IngestionError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Document } from "@/core/shared/types.js";
import { BaseConnector, type BaseConnectorOptions } from "./base.js";

interface PdfParseInfo {
  Title?: string;
  Author?: string;
  CreationDate?: string;
  ModDate?: string;
  Creator?: string;
  Producer?: string;
  [k: string]: unknown;
}

interface PdfParseResult {
  numpages: number;
  numrender: number;
  info: PdfParseInfo;
  metadata: unknown;
  text: string;
  version: string;
}

type PdfParseFn = (dataBuffer: Buffer) => Promise<PdfParseResult>;

export class PdfConnector extends BaseConnector {
  readonly kind = "pdf" as const;

  constructor(opts: BaseConnectorOptions) {
    super(opts);
    if (!opts.request.path) {
      throw new IngestionError("PdfConnector requires request.path");
    }
  }

  async load(): Promise<Document[]> {
    const filePath = this.request.path!;
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (err) {
      this.wrap(`read pdf ${filePath}`, err);
    }

    let parsed: PdfParseResult;
    try {
      // pdf-parse is CJS; use a dynamic import so ESM resolution is clean.
      const mod = (await import("pdf-parse")) as { default: PdfParseFn } | PdfParseFn;
      const fn: PdfParseFn = typeof mod === "function" ? mod : mod.default;
      parsed = await fn(buffer);
    } catch (err) {
      this.wrap("pdf-parse", err);
    }

    const titleFromInfo = parsed.info?.Title?.trim();
    const fallbackTitle = path.basename(filePath, path.extname(filePath));
    const title = titleFromInfo && titleFromInfo.length > 0 ? titleFromInfo : fallbackTitle;

    const doc: Document = {
      id: uuidv4(),
      source: "pdf",
      uri: filePath,
      title,
      content: parsed.text ?? "",
      metadata: {
        format: "pdf",
        pageCount: parsed.numpages,
        author: parsed.info?.Author,
        date: parsed.info?.CreationDate ?? parsed.info?.ModDate,
        pdfInfo: parsed.info,
        filename: path.basename(filePath),
      },
    };

    logger.info(
      { documentId: doc.id, pages: parsed.numpages, file: filePath },
      "loaded PDF",
    );
    return [doc];
  }
}
