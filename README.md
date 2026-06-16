# Advanced RAG Platform

A **generic, domain-agnostic, enterprise-grade Retrieval Augmented Generation (RAG) platform** built on Node.js + TypeScript + LangChain.js + LangGraph.js + OpenAI.

Designed to be customized (via configuration, not code changes) into Legal RAG, Healthcare RAG, Enterprise Knowledge Base, Customer Support, and more.

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

# 6. Ingest a document
npm run ingest -- ./docs/sample.pdf --tags legal

# 7. Query
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

See `C:\Users\HasanKhan\.claude\plans\glittery-booping-hippo.md` for the full 5-phase implementation plan.

---

## Repository layout

```
src/
├── api/                Fastify routes, middleware, server
├── agents/             LangGraph graphs (query, ingestion, research)
├── ingestion/          DataConnectors (PDF, DOCX, MD, TXT, Web)
├── processing/         Cleaning, parsing, metadata extraction
├── chunking/           Fixed, recursive, semantic, agentic strategies
├── embeddings/         OpenAI provider, Redis cache, factory
├── database/           Postgres, Qdrant, Redis, S3, Elasticsearch
├── retrieval/          Vector, keyword, hybrid, metadata retrievers
├── reranking/          Noop, OpenAI, BGE
├── context/            Token counter, context builder, citation extractor
├── memory/             PostgresSaver checkpointer, long-term store
├── security/           JWT auth, RBAC, document perms
├── evaluation/         Retrieval/generation metrics, LLM judge, harness
├── observability/      LangSmith, metrics, OpenTelemetry
├── prompts/            System, retrieval, citation, evaluation templates
├── config/             Zod-validated env, per-feature configs
├── shared/             Types, interfaces, errors, logger
└── server.ts           Entry point
```

---

## Endpoints (Phase 1)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/healthz` | Health check |
| `GET`  | `/metrics` | Metrics snapshot |
| `POST` | `/api/ingest` | Ingest a document (PDF/DOCX/MD/TXT/URL) |
| `POST` | `/api/query` | Run a RAG query (supports streaming via SSE) |
| `POST` | `/api/search` | Raw retrieval (no generation) |
| `POST` | `/api/reindex` | Re-index a document (Phase 3: with HITL) |
| `POST` | `/api/feedback` | Submit user feedback on a query |
| `POST` | `/api/evaluate` | Run an evaluation harness over a dataset |

---

## Configuration

Every config is a Zod-validated env var in `.env`. Key knobs:

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required** |
| `OPENAI_MODEL_GENERATION` | `gpt-4o` | Answer-generation model |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `RETRIEVAL_TOP_K` | `10` | Initial retrieval depth |
| `RERANKER_ENABLED` | `false` | Toggle the reranking step (Phase 2) |
| `HYBRID_SEARCH_ENABLED` | `false` | Toggle vector + BM25 hybrid (Phase 2) |
| `CHUNK_SIZE` | `1000` | Recursive splitter chunk size |
| `CHUNK_OVERLAP` | `150` | Recursive splitter overlap |
| `CHUNKER_STRATEGY` | `recursive` | `fixed` \| `recursive` \| `semantic` \| `agentic` |
| `LANGSMITH_TRACING` | `false` | Set `true` to enable LangSmith tracing |

---

## Development

```bash
npm run dev           # Fastify + LangGraph dev server with hot reload
npm run typecheck     # tsc --noEmit
npm test              # Vitest
npm run test:unit     # Unit tests only
npm run podman:up     # Bring up infra
npm run podman:down   # Tear down infra
```

LangGraph graphs are also runnable via the LangGraph CLI:

```bash
npx @langchain/langgraph-cli dev   # Port 2024
npx @langchain/langgraph-cli up    # Port 8123 (production-like)
```

---

## Roadmap

The full 5-phase roadmap is in `C:\Users\HasanKhan\.claude\plans\glittery-booping-hippo.md`:

- **Phase 1** (this): basic RAG, OpenAI, Qdrant, citations, LangSmith
- **Phase 2**: hybrid search (vector + BM25), reranking, eval harness
- **Phase 3**: LangGraph memory, HITL, evaluator node
- **Phase 4**: multi-agent research, knowledge graph retrieval
- **Phase 5**: multi-tenant SaaS, RBAC, document-level ACLs

---

## Conventions

- **ESM TypeScript** with `.js` import extensions
- **Strict** TypeScript (no implicit any, strict null checks)
- **Zod** for all schema validation (env, requests, state)
- **pino** structured logging
- **`@/`** path alias maps to `src/`
- **Errors**: throw `RagError` subclasses; never `Error` directly
- **All swappable components implement interfaces** in `src/shared/interfaces.ts`
