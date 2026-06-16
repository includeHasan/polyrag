/**
 * DOCX connector. Uses `mammoth.extractRawText` to recover plain text and
 * falls back to the filename (no extension) for the document title.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import mammoth from "mammoth";
import { IngestionError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Document } from "@/core/shared/types.js";
import { BaseConnector, type BaseConnectorOptions } from "./base.js";

export class DocxConnector extends BaseConnector {
  readonly kind = "docx" as const;

  constructor(opts: BaseConnectorOptions) {
    super(opts);
    if (!opts.request.path) {
      throw new IngestionError("DocxConnector requires request.path");
    }
  }

  async load(): Promise<Document[]> {
    const filePath = this.request.path!;
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (err) {
      this.wrap(`read docx ${filePath}`, err);
    }

    let result: { value: string; messages: unknown[] };
    try {
      result = await mammoth.extractRawText({ buffer });
    } catch (err) {
      this.wrap("mammoth.extractRawText", err);
    }

    const title = path.basename(filePath, path.extname(filePath));
    const doc: Document = {
      id: uuidv4(),
      source: "docx",
      uri: filePath,
      title,
      content: result.value ?? "",
      metadata: {
        format: "docx",
        filename: path.basename(filePath),
        mammothMessages: Array.isArray(result.messages) ? result.messages.length : 0,
      },
    };

    logger.info(
      { documentId: doc.id, chars: doc.content.length, file: filePath },
      "loaded DOCX",
    );
    return [doc];
  }
}
