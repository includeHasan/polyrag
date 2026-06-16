/**
 * Abstract `BaseConnector implements DataConnector`.
 *
 * Concrete subclasses override `load()`; `connect()` is provided as a no-op
 * default because most connectors are stateless. The base class wires up
 * the `kind` accessor and ensures consistent error wrapping.
 */
import { IngestionError } from "../../shared/errors.js";
import type { DataConnector } from "../../shared/interfaces.js";
import { logger } from "../../shared/logger.js";
import type { Document, IngestRequest } from "../../shared/types.js";

export interface BaseConnectorOptions {
  request: IngestRequest;
}

export abstract class BaseConnector implements DataConnector {
  abstract readonly kind: IngestRequest["source"];
  protected readonly request: IngestRequest;

  constructor(opts: BaseConnectorOptions) {
    this.request = opts.request;
  }

  /** Default: no resources to open. Override in streaming / API connectors. */
  async connect(): Promise<void> {
    /* no-op */
  }

  /** Default: nothing to close. */
  async disconnect(): Promise<void> {
    /* no-op */
  }

  abstract load(): Promise<Document[]>;

  /** Helper for subclasses: wrap unexpected errors as `IngestionError`. */
  protected wrap(stage: string, err: unknown): never {
    logger.error({ err: (err as Error).message, stage }, "connector failure");
    throw new IngestionError(`${stage} failed: ${(err as Error).message}`, err);
  }
}
