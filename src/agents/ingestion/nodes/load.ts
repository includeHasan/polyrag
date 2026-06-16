/**
 * `load` node — pick a `DataConnector` from the registry for the request's
 * `source` kind, connect, and pull a single `Document`.
 */
import { logger } from "../../../shared/logger.js";
import { IngestionError } from "../../../shared/errors.js";
import { getConnector } from "../../../ingestion/connectors/registry.js";
import type { IngestionState } from "../state.js";

export async function loadNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const nodeName = "load";
  try {
    logger.info(
      { kind: state.request.source, path: state.request.path, url: state.request.url },
      `[${nodeName}] start`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connector = getConnector(state.request.source as any);
    await connector.connect();
    try {
      const docs = await connector.load();
      if (docs.length === 0) {
        throw new IngestionError(
          `[${nodeName}] connector '${state.request.source}' returned no documents`,
        );
      }
      const doc = docs[0];
      logger.info(
        { documentId: doc.id, title: doc.title, chars: doc.content.length },
        `[${nodeName}] loaded`,
      );

      return {
        documentId: doc.id,
        title: doc.title,
        rawContent: doc.content,
        status: "processing",
        metadata: {
          ...state.metadata,
          source: state.request.source,
          node: nodeName,
        },
      };
    } finally {
      if (connector.disconnect) {
        await connector.disconnect().catch(() => undefined);
      }
    }
  } catch (err) {
    logger.error({ err }, `[${nodeName}] failed`);
    throw new IngestionError(
      `[${nodeName}] failed: ${(err as Error).message}`,
      err,
    );
  }
}
