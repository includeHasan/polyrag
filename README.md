# Advanced RAG Platform

A **multi-tenant, domain-agnostic, enterprise-grade Retrieval Augmented Generation (RAG) platform** built on Node.js + TypeScript + LangChain.js + LangGraph.js + OpenAI.

Designed to be customized (per-tenant, no code changes) into Legal RAG, Healthcare RAG, Enterprise Knowledge Base, Customer Support, and more. Each tenant is isolated in shared stores and can configure its own domain persona, LLMs, chunking/retrieval strategy, and quotas.

---

## Quickstart

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Configure
cp .env.example .env
# Edit .env — set OPENAI_API_KEY and LANGSMITH_API_KEY at minimum

# 3. Bring up infrastructure (Postgres, Redis, Qdrant, MinIO, Elasticsearch)
npm run podman:up
# Qdrant runs as a local binary at bin/qdrant.exe (port 6333)

# 4. Run database migrations
npm run db:migrate

# 5. Start the API + LangGraph server
npm run dev

# 6. Open the Swagger UI
open http://localhost:3000/docs

# 7. Ingest a document
npm run ingest -- ./docs/sample.pdf --tags legal

# 8. Query
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query":"What is the policy on remote work?"}'
```

---

## Architecture

```
User Query
   ↓
Query Understanding (intent, entities, expansion)
   ↓
Multi Retrieval Engine (vector + keyword + metadata, pluggable)
   ↓
Reranking (LLM or cross-encoder, pluggable)
   ↓
Context Builder (dedupe, fit to token budget)
   ↓
LangGraph Agent Workflow (planner → retriever → reranker → generator → evaluator)
   ↓
LLM Generation (OpenAI GPT-4o)
   ↓
Citations (mandatory [N] markers)
   ↓
Response (answer + sources + sessionId)
```

See `C:\Users\HasanKhan\.claude\plans\glittery-booping-hippo.md` for the full 5-phase implementation plan and `docs/ARCHITECTURE.md` for the deep dive.

---

## Repository layout (domain-grouped)

The source is grouped into six logical domains so you can navigate to a concern without scanning 19 flat folders. The `@/` path alias resolves under `src/`.

```
src/
├── core/                 Zod env, shared types, errors, logger, keyed cache
│   ├── shared/           types, interfaces, errors, logger
│   └── config/           env loader + per-feature config objects
├── infra/                External-service clients
│   ├── database/         Postgres, Qdrant, Redis, S3, Elasticsearch (+ migrations)
│   └── llm/              ChatOpenAI factory
├── rag/                  The RAG pipeline stages
│   ├── ingestion/        connectors, pipeline, KG extractor, queue
│   ├── processing/       clean, parse, metadata
│   ├── chunking/         fixed | recursive | (semantic/agentic stub → recursive)
│   ├── embeddings/       OpenAI provider, Redis cache, factory
│   ├── retrieval/        vector, keyword (BM25), hybrid (RRF), metadata, KG
│   ├── reranking/        noop | OpenAI LLM
│   └── context/          token counter, context builder, citation extractor
├── agents/               LangGraph graphs
│   ├── query/            the 6-node query StateGraph
│   ├── ingestion/        the ingestion StateGraph
│   ├── research/         the multi-agent research graph (planner→searcher→synthesizer)
│   └── prompts/          system, retrieval, citation, evaluation templates
├── platform/             Cross-cutting concerns
│   ├── security/         JWT auth, OAuth2, RBAC, document ACLs, rate limit
│   ├── tenancy/          Tenant model, TenantConfigService, ALS context, isolation guard
│   ├── observability/    LangSmith, OpenTelemetry, metrics, metering
│   ├── memory/           PostgresSaver checkpointer, long-term Store
│   └── evaluation/       retrieval/generation metrics, LLM judge, harness
├── api/                  HTTP layer (layered: routes → controllers → services)
│   ├── routes/           path + method + Swagger schema → delegates to a controller
│   ├── controllers/      HTTP layer: Zod validation, auth/tenant, response shaping
│   ├── services/         HTTP-agnostic domain logic
│   ├── middleware/       auth, tenant context, rate limit, request log, error handler
│   └── swagger.ts        OpenAPI 3.1 + Swagger UI
└── server.ts             Entry point
```

Every swappable component implements an interface in `src/core/shared/interfaces.ts` and is built by a **per-tenant-config-keyed factory** under the matching concern folder — no global singletons.

---

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`  | `/healthz` | — | Liveness & readiness probe |
| `GET`  | `/metrics` | — | Metrics snapshot |
| `GET`  | `/docs` | — | **Interactive Swagger UI** |
| `GET`  | `/docs/json` | — | OpenAPI 3.1 spec (JSON) |
| `POST` | `/api/ingest` | Bearer | Ingest a document (PDF/DOCX/MD/TXT/URL); tenant-scoped |
| `POST` | `/api/query` | Bearer | Run a RAG query (supports SSE streaming) |
| `POST` | `/api/search` | Bearer | Raw retrieval (no generation) |
| `POST` | `/api/reindex` | Bearer | Re-index a document (HITL-aware) |
| `POST` | `/api/reindex/resume` | Bearer | Resume a paused re-index |
| `POST` | `/api/feedback` | Bearer | Submit user feedback on a query |
| `POST` | `/api/evaluate` | Bearer | Run the evaluation harness over a dataset |
| `GET`  | `/api/sessions/:id/history` | Bearer | Session conversation history |
| `GET`  | `/api/sessions/:id/state` | Bearer | Session graph state |
| `GET`  | `/api/billing/usage` | Bearer | Per-tenant usage breakdown |
| `GET`  | `/api/billing/quota` | Bearer | Current usage vs monthly quota |
| `GET`  | `/api/oauth2/:provider/login` | — | Begin OAuth2 login |
| `GET`  | `/api/oauth2/:provider/callback` | — | OAuth2 callback |
| `POST` | `/api/admin/tenants` | Bearer (super_admin) | Create a tenant |
| `GET`  | `/api/admin/tenants` | Bearer (super_admin) | List tenants |
| `GET`  | `/api/admin/tenants/:id` | Bearer (super_admin) | Get tenant + config |
| `PATCH`| `/api/admin/tenants/:id` | Bearer (super_admin) | Update tenant name/status |
| `POST` | `/api/admin/tenants/:id/admins` | Bearer (super_admin) | Assign a user to a tenant |
| `GET`  | `/api/admin/tenants/:id/config` | Bearer | Get tenant config overrides |
| `PUT`  | `/api/admin/tenants/:id/config` | Bearer | Update tenant config overrides |

The full machine-readable spec is at `/docs/json`.

---

## Multi-tenancy

Every request carries a **tenant context** (`src/platform/tenancy/`) resolved from the JWT:

- **Isolation:** shared stores (one Qdrant collection, one BM25 index, one ES index, shared S3) with a mandatory `tenantId` filter enforced by `assertTenantFilter`. Chunks/documents are stamped with `tenantId` at ingest; the retrieve node passes the filter through every leg (vector, BM25, KG, hybrid).
- **Customization:** each tenant has a `TenantConfig` (JSON override tree) deep-merged with global defaults. Tenants can configure their **domain persona** + prompts, **generation/eval/rerank LLM**, **chunking & retrieval toggles**, and **quotas/rate limits** — without redeploys.
- **Pinned platform-wide:** the **embedding model and dimension** is fixed for everyone, because a shared Qdrant collection assumes a single embedding space. `TenantConfigService` rejects any embedding override.
- **Propagation:** `AsyncLocalStorage` for non-graph code; inside LangGraph, a `tenantConfigKey` (the config `version`) is threaded through graph state so nodes re-resolve config deterministically (checkpointer-resume-safe, worker-offload-safe).
- **Provisioning:** platform-admin (`super_admin`) creates tenants and assigns the first tenant-admin via `/api/admin/tenants`.

---

## Configuration

Every config is a Zod-validated env var in `.env`. Key knobs:

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required** |
| `OPENAI_MODEL_GENERATION` | `gpt-4o` | Answer-generation model |
| `OPENAI_MODEL_EVALUATION` | `gpt-4o-mini` | Evaluation model |
| `OPENAI_MODEL_RERANK` | `gpt-4o-mini` | Reranking model |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model (**pinned platform-wide**) |
| `OPENAI_EMBEDDING_DIM` | `1536` | Embedding dimension |
| `RETRIEVAL_TOP_K` | `10` | Initial retrieval depth |
| `RETRIEVAL_RERANK_TOP_K` | `20` | Depth before reranking (tune with `topK`) |
| `RERANKER_ENABLED` | `false` | Toggle the reranking node |
| `HYBRID_SEARCH_ENABLED` | `false` | Toggle vector + BM25 hybrid |
| `CHUNK_SIZE` | `1000` | Recursive splitter chunk size |
| `CHUNK_OVERLAP` | `150` | Recursive splitter overlap |
| `CHUNKER_STRATEGY` | `recursive` | `fixed` \| `recursive` \| `semantic` \| `agentic` |
| `LANGSMITH_TRACING` | `false` | Set `true` to enable LangSmith tracing |
| `AUTH_REQUIRE_TOKEN` | — | When `true`, requests with no token get a 401 (instead of the dev user) |
| `DEV_TENANT_ID` | `default` | Tenant assigned to the dev-user fallback |

---

## Development

```bash
npm run dev           # Fastify + LangGraph dev server with hot reload (port 3000)
npm run build         # tsc -p . → dist/
npm run typecheck     # tsc --noEmit — the real "lint" (there is no linter)
npm test              # vitest
npm run test:unit     # Unit tests only
npm run podman:up     # Bring up infra
npm run podman:down   # Tear down infra
```

LangGraph graphs (`langgraph.json` exposes `query-agent`, `ingestion-agent`, `research-agent`) also run standalone:

```bash
npx @langchain/langgraph-cli dev   # Port 2024
npx @langchain/langgraph-cli up    # Port 8123 (production-like)
```

Open the Swagger UI at <http://localhost:3000/docs> while `npm run dev` is running.

---

## Roadmap

The full 5-phase roadmap is in `C:\Users\HasanKhan\.claude\plans\glittery-booping-hippo.md`:

- **Phase 1** (shipped): basic RAG, OpenAI, Qdrant, citations, LangSmith
- **Phase 2** (shipped): hybrid search (vector + BM25), reranking, eval harness
- **Phase 3** (shipped): LangGraph memory, HITL, evaluator node
- **Phase 4** (shipped): multi-agent research, knowledge graph retrieval
- **Phase 5** (shipped): multi-tenant SaaS, RBAC, document-level ACLs

---

## Conventions

- **ESM TypeScript** with `.js` import extensions.
- **Strict** TypeScript (no implicit any, strict null checks).
- **Zod** for all schema validation (env, requests, state).
- **pino** structured logging.
- **`@/`** path alias maps to `src/`.
- **Errors:** throw `RagError` subclasses; never `Error` directly.
- **All swappable components implement interfaces** in `src/core/shared/interfaces.ts`.
- **Pluggability:** `interface → factory (config-keyed cache) → env flag` to add a new backend.
- **API layering:** `src/api/routes/` is thin (path + schema), `controllers/` owns the HTTP layer, `services/` owns HTTP-agnostic domain logic.
