# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Generic, domain-agnostic, enterprise-grade RAG platform: Node.js + TypeScript (ESM) + LangChain.js + LangGraph.js + OpenAI, with a Fastify HTTP API. It is meant to be configured (not rewritten) into Legal/Healthcare/Enterprise-KB RAG via env vars.

Two deeper docs already exist and are the source of truth for design — read them before large changes:
- `README.md` — quickstart, endpoints, config table.
- `docs/ARCHITECTURE.md` — module layout, ingestion/query lifecycles, storage roles, pluggability surface, known trade-offs.

## Commands

```bash
npm install --legacy-peer-deps   # REQUIRED — peer deps conflict without this flag
npm run dev                      # tsx watch src/server.ts — Fastify API on :3000, hot reload
npm run build                    # tsc -p . → dist/
npm run typecheck                # tsc --noEmit — the real "lint" (see note below)
npm run db:migrate               # apply SQL migrations (scripts/migrate.ts)

# Infra (Postgres, Redis, Elasticsearch, MinIO, Qdrant) via podman
npm run podman:up                # start containers
npm run podman:down              # stop
npm run podman:status            # list running containers

# CLI one-offs
npm run ingest -- ./docs/sample.pdf --tags legal   # ingest a file/URL
npm run query  -- "your question"
npm run eval                     # scripts/eval.ts
npm run eval:full                # scripts/run-eval.ts — full harness over eval/datasets
```

LangGraph graphs (`langgraph.json` exposes `query-agent`, `ingestion-agent`, `research-agent`) also run standalone:
```bash
npx @langchain/langgraph-cli dev   # :2024
npx @langchain/langgraph-cli up    # :8123
```

## Testing — important

- `npm run lint` is a **placeholder** (`echo`). There is no linter; `npm run typecheck` is what enforces correctness. Run it before considering a change done.
- `vitest.config.ts` and the `test`/`test:unit`/`test:integration` scripts point at `src/tests/**`, **but that directory does not currently exist** — there are no `*.test.ts` files, so `npm test` finds nothing.
- The actual end-to-end suite is `scripts/e2e-test.ts` (run with `tsx scripts/e2e-test.ts`). It ingests the fixtures in `docs/fixtures`, runs a battery of query/auth/RBAC/ACL/HITL cases against a **live server + full infra**, and writes a report to `eval/reports/`. It is not wired to an npm script. Bring up `npm run podman:up` + `npm run dev` first.

## Conventions (enforced by review, not tooling)

- **ESM + strict TypeScript.** Relative imports MUST use `.js` extensions (e.g. `import { x } from "./foo.js"`) even though the source is `.ts`. `@/` is a path alias for `src/`.
- **Zod at every external boundary** — env (`src/config/env.ts`), request bodies, and LangGraph state schemas. The env loader fails fast at startup on a missing/malformed var.
- **Errors:** throw `RagError` subclasses (`src/shared/`), never raw `Error`.
- **Logging:** `pino` structured logger (`src/shared/logger.ts`), child loggers per request/job.
- **Pluggability:** every swappable component implements an interface in `src/shared/interfaces.ts` (`DataConnector`, `Chunker`, `EmbeddingProvider`, `VectorStore`, `Retriever`, `Reranker`, `ContextBuilder`, `LLMProvider`, `EvaluationMetric`). Concrete impls live in the matching `src/<concern>/` folder and are built by a `*/factory.ts` from config. Adding a backend = implement interface → register in factory → add env flag.

## Architecture quick map

- **Query path** = a 6-node LangGraph StateGraph (`src/agents/query/graph.ts`): `understand → retrieve → rerank → buildContext → generate → evaluate`. Checkpointed by `PostgresSaver` keyed on `thread_id = sessionId` for multi-turn memory.
- **Ingestion path** = `src/ingestion/pipeline.ts` (`runIngestion`): connector → cleanText → parseSections → extractMetadata → chunk → embed (Redis-cached) → upsert Qdrant → BM25 index → KG extraction → persist Postgres + S3. BM25 and KG steps are best-effort (failures logged, don't abort).
- **Storage roles:** Qdrant = vectors; Postgres = metadata/RBAC/ACL/checkpoints/eval/feedback (accessed via **both** `pg` and Prisma — they coexist); Redis = embedding cache + BullMQ queue + rate-limit counters; S3/MinIO = raw blobs; Elasticsearch = optional keyword leg; in-process BM25 (`src/retrieval/bm25Index.ts`) persisted to disk.
- **API:** Fastify routes in `src/api/routes/`, registered via `routes/index.ts`; middleware (auth, RBAC, rate limit) in `src/api/middleware/`.

## Gotchas

- **Qdrant runs two ways:** `npm run podman:up` starts a `rag-qdrant` container on :6333, but the repo also ships a local binary `bin/qdrant.exe` (and a `.qdrant-initialized` marker) for running it natively on Windows. Pick one — don't run both on :6333.
- Many features are phased; `docs/ARCHITECTURE.md` §10 lists deliberate constraints (BM25 not shared across replicas, no PII redaction, full re-embed on reindex, multi-tenant isolation not fully enforced). Check there before assuming something is a bug.
- Prisma schema is at `prisma/schema.prisma` (assembled from `prisma/models/` via `npm run prisma:build`); `DATABASE_URL` must stay in sync with the `POSTGRES_*` vars in `.env`.
