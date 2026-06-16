/**
 * Error taxonomy for the RAG platform.
 */
export class RagError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "RagError";
    this.code = code;
    this.cause = cause;
  }
}

export class IngestionError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("INGESTION_ERROR", message, cause);
    this.name = "IngestionError";
  }
}

export class RetrievalError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("RETRIEVAL_ERROR", message, cause);
    this.name = "RetrievalError";
  }
}

export class GenerationError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("GENERATION_ERROR", message, cause);
    this.name = "GenerationError";
  }
}

export class ConfigurationError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("CONFIGURATION_ERROR", message, cause);
    this.name = "ConfigurationError";
  }
}

export class AuthError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("AUTH_ERROR", message, cause);
    this.name = "AuthError";
  }
}

export class AuthorizationError extends RagError {
  constructor(message: string, cause?: unknown) {
    super("AUTHORIZATION_ERROR", message, cause);
    this.name = "AuthorizationError";
  }
}
