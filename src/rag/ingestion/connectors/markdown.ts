/**
 * Markdown connector. Reads a `.md` file and returns a single Document whose
 * `metadata.format` is `"md"` so the section parser picks the Markdown
 * heading path.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@/core/shared/logger.js";
import type { Document } from "@/core/shared/types.js";
import { BaseConnector, type BaseConnectorOptions } from "./base.js";

export class MarkdownConnector extends BaseConnector {
  readonly kind = "md" as const;

  constructor(opts: BaseConnectorOptions) {
    super(opts);
    if (!opts.request.path) {
      throw new Error("MarkdownConnector requires request.path");
    }
  }

  async load(): Promise<Document[]> {
    const filePath = this.request.path!;
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (err) {
      this.wrap(`read markdown ${filePath}`, err);
    }

    const title = path.basename(filePath, path.extname(filePath));
    const doc: Document = {
      id: uuidv4(),
      source: "md",
      uri: filePath,
      title,
      content: content ?? "",
      metadata: { format: "md", filename: path.basename(filePath) },
    };

    logger.info(
      { documentId: doc.id, chars: doc.content.length, file: filePath },
      "loaded Markdown",
    );
    return [doc];
  }
}
