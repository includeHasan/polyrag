/**
 * Connector registry — pick a `DataConnector` from an `IngestRequest`.
 *
 * The shape mirrors `IngestRequest.source` (one of "pdf" | "docx" | "txt"
 * | "md" | "url"). Adding a new source means: a new file, one entry in the
 * switch below, and an update to the `IngestRequestSchema` enum.
 */
import { IngestionError } from "@/core/shared/errors.js";
import type { DataConnector } from "@/core/shared/interfaces.js";
import type { IngestRequest } from "@/core/shared/types.js";
import { BaseConnector } from "./base.js";
import { DocxConnector } from "./docx.js";
import { MarkdownConnector } from "./markdown.js";
import { PdfConnector } from "./pdf.js";
import { TxtConnector } from "./txt.js";
import { WebConnector } from "./web.js";

export function getConnector(request: IngestRequest): DataConnector {
  const ctor: new (opts: { request: IngestRequest }) => BaseConnector = (() => {
    switch (request.source) {
      case "pdf":
        return PdfConnector as unknown as new (opts: { request: IngestRequest }) => BaseConnector;
      case "docx":
        return DocxConnector as unknown as new (opts: { request: IngestRequest }) => BaseConnector;
      case "txt":
        return TxtConnector as unknown as new (opts: { request: IngestRequest }) => BaseConnector;
      case "md":
        return MarkdownConnector as unknown as new (opts: { request: IngestRequest }) => BaseConnector;
      case "url":
        return WebConnector as unknown as new (opts: { request: IngestRequest }) => BaseConnector;
      default: {
        const _exhaustive: never = request.source;
        void _exhaustive;
        throw new IngestionError(`Unsupported ingestion source: ${String(request.source)}`);
      }
    }
  })();
  return new ctor({ request });
}

export {
  BaseConnector,
  DocxConnector,
  MarkdownConnector,
  PdfConnector,
  TxtConnector,
  WebConnector,
};
