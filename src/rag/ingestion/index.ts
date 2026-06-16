/**
 * Public surface of the Ingestion module. Everything callers need —
 * pipeline, queue, and the connector factory — is re-exported here so
 * `import { runIngestion, getIngestQueue, getConnector } from "@/rag/ingestion/"`
 * Just Works.
 */
export { getConnector } from "./connectors/registry.js";
export type {
  BaseConnector,
  BaseConnectorOptions,
} from "./connectors/base.js";
export { DocxConnector } from "./connectors/docx.js";
export { MarkdownConnector } from "./connectors/markdown.js";
export { PdfConnector } from "./connectors/pdf.js";
export { TxtConnector } from "./connectors/txt.js";
export { WebConnector } from "./connectors/web.js";

export {
  enqueueIngest,
  getIngestQueue,
  INGEST_QUEUE_NAME,
  startIngestWorker,
  stopIngestWorker,
  type IngestProcessor,
} from "./queue.js";

export {
  runIngestion,
  type IngestionResult,
} from "./pipeline.js";
