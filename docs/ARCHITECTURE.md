# Architecture

A domain-agnostic, enterprise-grade **Retrieval-Augmented Generation (RAG) platform** built on Node.js + TypeScript + LangChain.js + LangGraph.js + OpenAI, with a Fastify HTTP API, pluggable retrieval/reranking/chunking/embedding backends, multi-tenant security, LangGraph stateful workflows, evaluation, and full observability.

This document describes the moving parts, the request/ingest lifecycles, the data model, and the design decisions that shape the system.

---

## 1. Goals & Non-Goals

**Goals**
- One codebase that can be configured (not rewritten) into Legal RAG, Healthcare RAG, Enterprise KB, Customer Support, etc.
- Pluggable components at every boundary: connector, chunker, embedder, vector store, retriever, reranker, LLM.
- Production-grade: auth, RBAC, per-document ACLs, rate limiting, structured logging, tracing, metrics, metering, eval harness.
- Stateful multi-turn conversations grounded in retrieved sources with mandatory citations.
- Background ingestion that scales via a job queue.

**Non-Goals (today)**
- Fully managed multi-tenant SaaS billing UI (Phase 5).
- Looped self-correction in the query graph (planned for Phase 3).
- Cross-replica shared keyword index (BM25 is in-process; see §10).

---

## 2. High-Level Architecture

```
                              ┌──────────────────────────────────────────┐
                              │            CLIENT (curl / UI)            │
                              └────────────────┬─────────────────────────┘
                                               │ HTTP (JSON / SSE)
                                               ▼
                       ┌──────────────────────────────────────────────┐
                       │         Fastify API (src/api/server.ts)       │
                       │  /api/ingest  /api/query  /api/search  ...    │
                       │  Middleware: auth, RBAC, rate limit, logging  │
                       └────────────────┬─────────────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────────┐
            │                          │                              │
            ▼                          ▼                              ▼
   ┌────────────────┐       ┌────────────────────┐         ┌────────────────┐
   │ Ingestion path │       │  Query path        │         │  Eval / Admin  │
   │  (pipeline.ts) │       │  (query graph)     │         │  (harness)     │
   └───────┬────────┘       └─────────┬──────────┘         └────────┬───────┘
           │                          │                             │
           │                          │                             │
           ▼                          ▼                             ▼
   ┌────────────────────┐     ┌──────────────────────┐      ┌─────────────────┐
   │  Storage layer     │     │  Retrieval layer     │      │  Evaluation     │
   │ Qdrant · Postgres  │     │ Vector · BM25 · KG   │      │ LLM judge +     │
   │ Redis · S3 · ES    │     │ Hybrid · Metadata    │      │ retrieval/gen   │
   └────────────────────┘     └──────────────────────┘      └─────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  OpenAI (LLM+EMB)│
                              └──────────────────┘
```

Three external surfaces:

1. **HTTP API** — Fastify routes under `src/api/routes/*`.
2. **LangGraph server** — `langgraph.json` exposes three compiled graphs (query, ingestion, research) on port 2024/8123.
3. **CLI** — `npm run ingest|query|eval` for one-off operations.

---

## 3. Module Layout

```
src/
├── api/                Fastify routes, middleware, server bootstrap
├── agents/             LangGraph graphs (query, ingestion, research)
├── ingestion/          DataConnectors (PDF, DOCX, MD, TXT, Web) + pipeline
├── processing/         Cleaning, section parsing, metadata extraction
├── chunking/           fixed | recursive | semantic | agentic strategies
├── embeddings/         OpenAI provider, Redis cache, factory
├── database/           Postgres, Qdrant, Redis, S3, Elasticsearch clients
├── retrieval/          Vector, keyword, hybrid, metadata, KG retrievers
├── reranking/          Noop, OpenAI, BGE
├── context/            Token counter, context builder, citation extractor
├── memory/             PostgresSaver checkpointer, long-term Store
├── security/           JWT auth, OAuth2, RBAC, document perms
├── evaluation/         Retrieval/generation metrics, LLM judge, harness
├── observability/      LangSmith, metrics, OpenTelemetry, metering
├── prompts/            Versioned prompt templates
├── config/             Zod-validated env, per-feature configs
├── shared/             Types, interfaces, errors, logger
└── server.ts           Entry point
```

Every swappable component implements an interface in `src/shared/interfaces.ts`; factories in `*/factory.ts` build the configured implementation from `src/config/env.ts`.

---

## 4. Data & Control Flows

### 4.1 Ingestion (offline)

Triggered by `POST /api/ingest` or `npm run ingest -- ./file.pdf --tags legal`. Optionally enqueued via BullMQ (`src/ingestion/queue.ts`).

```
                  ┌──────────────────────────┐
                  │  Request / File / URL     │
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   Connector (PDF/DOCX/   │   src/ingestion/connectors/*
                  │   MD/TXT/Web)            │   registry.ts picks by source type
                  └─────────────┬────────────┘
                                ▼  raw Document
                  ┌──────────────────────────┐
                  │   cleanText()            │   strip noise, normalize whitespace
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   parseSections()        │   detect headings/pages
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   extractMetadata()      │   author/date/tags/tenant/department
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   Chunker (pluggable)    │   fixed | recursive | semantic | agentic
                  └─────────────┬────────────┘
                                ▼  N Chunks
                  ┌──────────────────────────┐
                  │   EmbeddingProvider      │   OpenAI text-embedding-3-small
                  │   (Redis-cached)         │   embeddings/cache.ts
                  └─────────────┬────────────┘
                                ▼  Vectors
                  ┌──────────────────────────┐
                  │   Upsert to Qdrant       │   vector store (cosine)
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   BM25 index update      │   in-process, persisted to disk
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   KG extraction (LLM)    │   entities + relations → graph
                  └─────────────┬────────────┘
                                ▼
                  ┌──────────────────────────┐
                  │   Persist metadata in    │   Postgres (Prisma): doc, perms,
                  │   Postgres + S3 raw file │   tags, tenant
                  └──────────────────────────┘
```

**Source:** `src/ingestion/pipeline.ts:49-229` (`runIngestion`).

Each stage is wrapped in stage-specific error handling and structured logging. The BM25 and KG steps are best-effort — failure is logged but does not abort ingestion.

### 4.2 Query (online)

Triggered by `POST /api/query` (supports SSE streaming). Runs a **LangGraph StateGraph** with a Postgres checkpointer for memory.

```
   ┌─────────┐
   │  START  │
   └────┬────┘
        ▼
   ┌──────────────────┐
   │  1. understand   │   LLM extracts: intent, entities, expanded queries, filters
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  2. retrieve     │   Fan-out: vector (Qdrant) + BM25 + KG + metadata
   │                  │   → top-K candidates (default K=10)
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  3. rerank       │   Noop | OpenAI LLM | BGE cross-encoder
   │                  │   (toggle via RERANKER_ENABLED)
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  4. buildContext │   dedupe, fit to token budget (tiktoken), attach [N] ids
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  5. generate     │   OpenAI gpt-4o, citation-enforced prompt
   │                  │   → answer with mandatory [N] markers
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  6. evaluate     │   self-check: grounded? citations valid? (LLM judge)
   │                  │   on failure → could loop back (Phase 3)
   └────────┬─────────┘
            ▼
   ┌─────────┐
   │   END   │  → { answer, sources[N], sessionId, metrics }
   └─────────┘
```

**Source:** `src/agents/query/graph.ts:26-61` — straight-line edges between six nodes, compiled with `MemorySaver` or `PostgresSaver` so multi-turn sessions keep state under `thread_id`.

#### Retrieval sub-flow (step 2 expanded)

```
                   ┌────────────────────┐
                   │     understand     │
                   └──────────┬─────────┘
                              │ query + filters + intent
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
 ┌─────────────┐      ┌──────────────┐      ┌──────────────┐
 │ Vector (Qdrant)│   │  BM25 keyword │      │  KG (entities│
 │ cosine sim    │   │  lexical      │      │  + relations)│
 └──────┬──────┘      └──────┬───────┘      └──────┬───────┘
        └──────────┬──────────┘                    │
                   ▼                               │
          ┌──────────────────┐                     │
          │  Hybrid fusion   │  ←── optional metadata filter
          │  (RRF / score mix)│
          └────────┬─────────┘
                   ▼
              top-K chunks
```

### 4.3 End-to-end request lifecycle

```
Client ──HTTP──▶ Fastify route ──▶ auth + RBAC ──▶ rate limit
       ──▶ Zod-validated handler ──▶ LangGraph invoke (thread_id = sessionId)
       ──▶ retrieval/embedding cache hit? skip OpenAI
       ──▶ generate ──▶ evaluate ──▶ stream/return JSON {answer, sources, sessionId}
       ──▶ log + trace (LangSmith/OTel) + record metrics/metering
       ──▶ persist checkpoint to Postgres (for next turn)
```

---

## 5. State Management

Two distinct notions of "state" coexist:

**Per-request graph state (`QueryState`)** — defined in `src/agents/query/state.ts` with a Zod schema. Carries the query, retrieved chunks, reranked chunks, built context, generated answer, evaluation verdict, and any node-side annotations across the six query nodes.

**Durable session state (Postgres)** — `PostgresSaver` writes a checkpoint after every node. Each request is identified by `thread_id = sessionId`, so the next turn resumes with full history. The `Store` interface (`src/memory/longTerm.ts`) carries facts that should survive beyond a single thread (user preferences, summarized memories).

This split lets the graph stay focused on a single turn's working memory while still supporting long-term personalization.

---

## 6. Storage Layer

| Store | Role | Driver |
|---|---|---|
| **Qdrant** | Vector index of chunk embeddings (cosine). | `@langchain/qdrant` |
| **Postgres** | Document/chunk metadata, RBAC/ACL, checkpointer, eval datasets, feedback. | `pg` + Prisma |
| **Redis** | Embedding cache, BullMQ queue, rate limit counters. | `ioredis` |
| **S3 (MinIO)** | Raw file blobs. | `@aws-sdk/client-s3` |
| **Elasticsearch** | Optional full-text/keyword leg and log search. | `@elastic/elasticsearch` |
| **In-process BM25** | Lexical index, persisted to disk. | `src/retrieval/bm25Index.ts` |

Chunk IDs are stable across storage backends, so a chunk can be deleted from Qdrant, the BM25 index, the KG, and Postgres in one operation.

---

## 7. Pluggability Surface

Every variable in the pipeline implements an interface in `src/shared/interfaces.ts` and is instantiated by a factory under `*/factory.ts` based on `src/config/env.ts`.

| Concern | Interface | Implementations |
|---|---|---|
| Source connector | `Connector` | PDF, DOCX, MD, TXT, Web |
| Chunker | `Chunker` | fixed, recursive, semantic, agentic |
| Embedder | `EmbeddingProvider` | OpenAI (+ Redis cache wrapper) |
| Vector store | `VectorStore` | Qdrant |
| Retriever | `Retriever` | vector, keyword, hybrid, metadata, KG |
| Reranker | `Reranker` | Noop, OpenAI, BGE |
| Checkpointer | LangGraph | MemorySaver, PostgresSaver |

A new backend is typically: implement the interface → register in the factory → add an env flag.

---

## 8. Security

- **JWT** auth middleware (`src/security/auth.ts`) on every API route.
- **OAuth2** flow (`src/security/oauth2.ts`) for delegated identity.
- **RBAC** (`src/security/rbac.ts`) maps roles to capabilities.
- **Per-document permissions** (`src/security/documentPerms.ts`) override role defaults — a user can have `read` on one doc and `admin` on another.
- **Rate limit** (`src/api/middleware/rateLimit.ts`) per (user, route, IP).
- **Request logging** and **error handling** produce safe responses (`RagError` subclasses with codes; no stack leaks in production).

Note: full multi-tenant data isolation is a Phase 5 deliverable; the primitives are in place but not yet enforced at every storage call site.

---

## 9. Observability

Three parallel telemetry streams:

- **LangSmith** (`src/observability/langsmith.ts`) — per-graph and per-LLM traces, enabled with `LANGSMITH_TRACING=true`.
- **OpenTelemetry** (`src/observability/otel.ts`) — auto-instrumented HTTP/DB/Redis spans, OTLP exporter.
- **Metrics + metering** (`src/observability/metrics.ts`, `metering.ts`) — counters/histograms for query latency, retrieval recall, token usage, and per-tenant usage for billing.

All emitted under the same `jobId`/`sessionId`/`thread_id` so a single request can be traced end-to-end across API → graph → LLM → storage.

---

## 10. Known Constraints & Trade-offs

| Area | Choice | Trade-off |
|---|---|---|
| **BM25 index** | In-process, persisted to disk | Cannot share across replicas; will be empty on a fresh node until the first ingest runs there. |
| **Vector store** | Qdrant only at the moment | Adding Pinecone/Weaviate is a factory swap, not a code change. |
| **KG extraction** | LLM-driven, best-effort | Subject to drift; not schema-validated. KG retrieval silently degrades on failure. |
| **Citation enforcement** | Prompt-enforced `[N]` markers | Not schema-enforced; a non-compliant model can still skip them. |
| **Eval node** | Records verdict only | Does not yet loop back to re-retrieve/re-generate on failure (Phase 3). |
| **Reindexing** | Full re-embed per document | No diff/delta path; large docs are expensive to refresh. |
| **PII redaction** | None | Sensitive content flows into chunks/embeddings unredacted. |
| **Multi-tenant** | Phase 5 | Primitives exist; full isolation is not yet enforced. |
| **Postgres access** | `pg` + Prisma coexist | Two abstractions over the same DB increase surface area. |

These are tracked on the roadmap; the in-code comments at each decision point call out the follow-up.

---

## 11. Configuration Surface

Everything is driven by Zod-validated env vars (`src/config/env.ts`). Highlights:

| Var | Default | Effect |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for LLM + embeddings. |
| `OPENAI_MODEL_GENERATION` | `gpt-4o` | Answer-generation model. |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model. |
| `RETRIEVAL_TOP_K` | `10` | Initial retrieval depth. |
| `RERANKER_ENABLED` | `false` | Toggle the reranking node. |
| `HYBRID_SEARCH_ENABLED` | `false` | Toggle vector + BM25 fusion. |
| `CHUNKER_STRATEGY` | `recursive` | `fixed` \| `recursive` \| `semantic` \| `agentic` |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `1000` / `150` | Splitter parameters. |
| `LANGSMITH_TRACING` | `false` | Enable LangSmith. |
| `RECURSION_LIMIT` | `25` | LangGraph recursion guard. |

The env loader fails fast at startup if a required var is missing or malformed — there is no "default to nothing" silently.

---

## 12. Cross-Cutting Conventions

- **ESM TypeScript**, `.js` import extensions, strict mode.
- **`@/`** path alias → `src/`.
- **Zod** at every external boundary (env, request bodies, state schemas).
- **`pino`** structured logging with child loggers per request/job.
- **Custom error hierarchy** — throw `RagError` subclasses; never raw `Error`.
- **LangGraph CLI compatible** — `langgraph.json` declares three graphs.

These conventions are enforced by code review rather than a heavy linter, but they are consistent across the codebase.

---

## 13. Where to Look Next

| If you want to... | Start here |
|---|---|
| Add a new data source | `src/ingestion/connectors/` + register in `registry.ts` |
| Add a new retrieval backend | `src/retrieval/` + factory + interface |
| Add a new LLM provider | `src/embeddings/` and the prompt templates in `src/prompts/` |
| Add a query-graph node | `src/agents/query/` — node in `nodes/`, wire in `graph.ts`, state in `state.ts` |
| Add a new API endpoint | `src/api/routes/` + register in `routes/index.ts` |
| Tune retrieval quality | `src/retrieval/hybrid.ts`, `src/reranking/`, `src/context/builder.ts` |
| Add metrics or traces | `src/observability/` |
| Run an eval | `npm run eval` or `POST /api/evaluate` |
