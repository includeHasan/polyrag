/**
 * Plain-text connector. Reads a `.txt` file, returns a single Document.
 * Encoding is assumed to be UTF-8 (which Node's `fs.readFile` defaults to).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@/core/shared/logger.js";
import type { Document } from "@/core/shared/types.js";
import { BaseConnector, type BaseConnectorOptions } from "./base.js";

export class TxtConnector extends BaseConnector {
  readonly kind = "txt" as const;

  constructor(opts: BaseConnectorOptions) {
    super(opts);
    if (!opts.request.path) {
      throw new Error("TxtConnector requires request.path");
    }
  }

  async load(): Promise<Document[]> {
    const filePath = this.request.path!;
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (err) {
      this.wrap(`read txt ${filePath}`, err);
    }

    const title = path.basename(filePath, path.extname(filePath));
    const doc: Document = {
      id: uuidv4(),
      source: "txt",
      uri: filePath,
      title,
      content: content ?? "",
      metadata: { format: "txt", filename: path.basename(filePath) },
    };

    logger.info(
      { documentId: doc.id, chars: doc.content.length, file: filePath },
      "loaded TXT",
    );
    return [doc];
  }
}
