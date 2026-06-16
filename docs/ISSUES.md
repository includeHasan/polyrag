# Known Issues & Technical Debt

A consolidated list of issues, risks, and trade-offs identified in the current codebase, organized by severity. Each issue lists **where** it manifests, **why** it matters, and a **suggested fix**.

> Sources: `src/agents/query/graph.ts`, `src/agents/query/state.ts`, `src/ingestion/pipeline.ts`, `src/ingestion/queue.ts`, `src/retrieval/bm25Index.ts`, `src/security/`, `prisma/`, and `src/observability/`.

---

## Severity Legend

- **Critical** — Correctness, data loss, or production outage risk.
- **High** — Significant reliability, cost, or scalability concern.
- **Medium** — DX, maintainability, or quality concern that compounds over time.
- **Low** — Cosmetic, nice-to-have, or only matters at scale.

---

## Critical

### 1. No retry / backoff on transient OpenAI failures
- **Where:** `src/ingestion/pipeline.ts:146-156` (embed step), `src/agents/query/nodes/generate.ts`, `src/agents/query/nodes/understand.ts`.
- **Impact:** A single 429 / 5xx from OpenAI throws and aborts the whole ingestion job or the whole query turn. The caller must re-run from scratch. Cost: duplicated work, lost checkpoints.
- **Fix:** Wrap LLM/embedding calls with exponential backoff + jitter (e.g. `p-retry` or a small `withRetry` helper). Cap retry attempts, log each attempt with `attempt`, `error`, and `delayMs`. Apply at the embedding/embedding-cache seam so a transient miss retries, not just at the top level.

### 2. Embedding count mismatch aborts the entire document
- **Where:** `src/ingestion/pipeline.ts:157-161`.
- **Impact:** If the embedder returns one fewer or one more vector than chunks, the whole document is rejected. There is no partial-success path — a single bad chunk can poison an otherwise good ingest.
- **Fix:** Per-chunk embed with a try/catch that drops or retries the bad chunk and logs its `chunk.id`. The document ingests as `partialSuccess: true` with a `failedChunkIds[]` list returned to the caller.

### 3. BM25 index is in-process and not shared across replicas
- **Where:** `src/retrieval/bm25Index.ts`, called from `src/ingestion/pipeline.ts:181-196`.
- **Impact:** On a multi-replica deployment, only the replica that handled the ingest has the keyword leg. The other replicas return empty BM25 results, silently degrading hybrid search. The current code logs a warning and continues, masking the problem in production.
- **Fix:** Move BM25 to a shared backend (Redis inverted index, Elasticsearch, or a sidecar service). At minimum, surface this as a `degraded` health metric and refuse to mark `HYBRID_SEARCH_ENABLED=true` healthy in `/healthz` when the index is known-empty on this node.

### 4. Citation enforcement is prompt-only
- **Where:** `src/prompts/citation.ts` + `src/agents/query/nodes/generate.ts`.
- **Impact:** Answers are required to contain `[N]` markers by prompt instruction only. A non-compliant model can still skip them, and the evaluator only flags this — it does not correct it. Downstream consumers (UI, legal/compliance) cannot trust citations exist without a post-hoc regex pass.
- **Fix:** Add a post-generation validator: extract all `[N]` references, verify each resolves to a chunk in `state.contextChunks`, and either (a) re-prompt the model with a forced "add citations" instruction, or (b) fall back to a deterministic template answer. Never return an answer with unresolved citations.

### 5. Knowledge graph extraction is LLM-driven and unvalidated
- **Where:** `src/ingestion/kgExtractor.ts`, called from `src/ingestion/pipeline.ts:201-210`.
- **Impact:** Entities and relations are extracted by the LLM with no schema validation. Malformed/duplicate entities silently accumulate. KG retrieval returns junk with no signal of failure.
- **Fix:** Validate every extracted entity/relation against a Zod schema before insert. De-duplicate on `(name, tenantId, type)`. Emit a metric `kg_extraction_invalid_count` and a per-document quality score. On degraded extraction, mark the document `kg_quality: low` so the retriever can down-weight it.

---

## High

### 6. No incremental re-indexing
- **Where:** `src/api/routes/reindex.ts`, `src/ingestion/pipeline.ts`.
- **Impact:** Reindexing a document re-embeds every chunk from scratch. For a large document (10k+ chunks), this is expensive in dollars and time. There is no diff or delta path.
- **Fix:** Track `chunk.contentHash` in Postgres. On reindex, skip chunks whose hash is unchanged. For changed chunks, swap them in Qdrant and BM25 atomically. Surface `chunksSkipped`, `chunksReplaced`, `chunksAdded` in the response.

### 7. In-process checkpointer is the default
- **Where:** `src/agents/query/graph.ts:51` (`getCheckpointer()` default), `src/memory/session.ts`.
- **Impact:** `MemorySaver` does not survive process restart. A server redeploy loses all in-flight conversation state. Easy to misconfigure in production.
- **Fix:** Make `PostgresSaver` the default when `DATABASE_URL` is set; require an explicit `CHECKPOINTER=memory` opt-in for dev. Fail at startup if `CHECKPOINTER=postgres` is requested but the migrations table is missing.

### 8. Self-evaluator is advisory only
- **Where:** `src/agents/query/nodes/evaluate.ts`.
- **Impact:** When the LLM judge flags the answer as ungrounded or uncited, the verdict is recorded but the graph still ends with the bad answer. There is no retry/regenerate loop.
- **Fix:** Branch on the evaluator verdict: on `fail`, re-enter `generate` with an augmented prompt that includes the judge's reasoning, up to `MAX_REGEN_ATTEMPTS` (default 2). Track `regenCount` in the response so callers can see what happened.

### 9. No PII / secret redaction in processing
- **Where:** `src/processing/clean.ts`, `src/processing/parse.ts`.
- **Impact:** Raw text — including names, emails, SSNs, API keys, customer data — flows into chunks, embeddings, BM25, and the knowledge graph with no scrubbing. Embeddings in particular are persistent and may surface in similarity search.
- **Fix:** Add a `redact()` step in the processing pipeline that masks emails, phone numbers, credit cards, and a configurable set of regex patterns per tenant. Run it before chunking. Maintain a `redactionLog` per document for audit.

### 10. Multi-tenant isolation is partial
- **Where:** `src/security/rbac.ts`, `src/security/documentPerms.ts`, every storage call site.
- **Impact:** RBAC and per-doc ACLs exist, but a missing `tenantId` filter on a single Qdrant or Postgres call can leak data across tenants. The current code has no automated test that proves isolation.
- **Fix:** Introduce a `TenantContext` (AsyncLocalStorage) that all storage layers must read from. Add a CI test suite that seeds two tenants and asserts zero cross-tenant results from any retriever or query.

### 11. `as any` cast hides type errors in the query graph
- **Where:** `src/agents/query/graph.ts:32`.
- **Impact:** The strict generics of `StateGraph` are bypassed with `const workflow: any = new StateGraph(...)`. Any node-name typo or state-shape mismatch is now a runtime error instead of a compile error.
- **Fix:** Either pin to a langgraph version with looser generics, or build a thin `addNode<N extends NodeName>(name: N, fn: NodeFn<N>)` wrapper that preserves type safety. Remove the cast.

### 12. No graceful shutdown
- **Where:** `src/server.ts`, `src/api/server.ts`.
- **Impact:** On SIGTERM, in-flight queries are killed mid-stream. BullMQ workers may leave jobs in `active` state. Checkpoints may be half-written.
- **Fix:** Wire `process.on('SIGTERM', ...)` to: stop accepting new HTTP, drain in-flight requests, close the LangGraph checkpointer, close DB/Redis/Qdrant clients, then `process.exit(0)` with a timeout guard.

---

## Medium

### 13. BM25 and KG steps are best-effort but silent
- **Where:** `src/ingestion/pipeline.ts:181-210`.
- **Impact:** When these steps fail, the document is still marked "ingested" successfully. Downstream search silently returns less. No `kg_indexed: false` flag is persisted on the document.
- **Fix:** Persist `bm25Indexed: boolean` and `kgIndexed: boolean` on the document record. Surface a non-fatal warning in the API response. Allow `POST /api/reindex` with `{ bm25: true, kg: true }` to backfill.

### 14. Hard-coded OpenAI provider
- **Where:** `src/embeddings/factory.ts`, `src/agents/query/nodes/generate.ts`.
- **Impact:** Switching to Anthropic, Azure OpenAI, or a local model requires code changes in multiple files.
- **Fix:** Define a `LLMProvider` interface in `src/shared/interfaces.ts` and inject via the factory pattern already used for retrievers/rerankers.

### 15. Two Postgres abstractions
- **Where:** `prisma/` (Prisma client) and `src/database/postgres.ts` (raw `pg`).
- **Impact:** Schema lives in Prisma, but checkpointer and some queries use `pg` directly. Two mental models, two connection pools, two migration stories.
- **Fix:** Pick one. If Prisma wins, route all queries through it (the `pg`-backed checkpointer can be wrapped in a Prisma `UNSAFE` raw call). If raw `pg` wins, drop Prisma.

### 16. No automated tenant-isolation tests
- **Where:** `src/tests/`.
- **Impact:** See #10. There is no regression coverage that "tenant A cannot read tenant B's chunks." A single careless commit can break it.
- **Fix:** Add a `tenant-isolation.test.ts` per storage backend (Qdrant, Postgres, BM25, KG). Fail the build on any cross-tenant hit.

### 17. Eval harness is not wired into CI
- **Where:** `src/evaluation/harness.ts`, `scripts/run-eval.ts`.
- **Impact:** `npm run eval` works manually but is not part of the default CI pipeline. Retrieval regressions ship to production unnoticed.
- **Fix:** Add `eval` to the CI workflow. Fail the build on a configurable recall/F1 regression. Store eval results in Postgres for trend tracking.

### 18. Streaming response has no backpressure
- **Where:** `src/api/routes/query.ts` (SSE path).
- **Impact:** A slow client can pin a worker on a long-lived SSE connection, exhausting the Fastify pool.
- **Fix:** Add a per-connection idle timeout, drop connections that fall behind, and put a hard cap on concurrent streams per user.

### 19. PII / tenant data in logs
- **Where:** `src/api/middleware/requestLogger.ts`, `src/shared/logger.ts`.
- **Impact:** Request bodies and prompts are logged with `pino` at debug level. Sensitive content can land in centralized log storage.
- **Fix:** Default to `redact: ['req.body.query', 'req.body.content', 'state.contextChunks[*].text']` in the pino config. Make redaction patterns per-tenant configurable.

### 20. No rate limit on LangGraph runs themselves
- **Where:** `src/api/middleware/rateLimit.ts`.
- **Impact:** Rate limit is applied at the HTTP route, not on LangGraph `invoke()`. A misbehaving internal caller can bypass it.
- **Fix:** Apply the limiter inside the graph's `understand` or `retrieve` node by tenant+session.

---

## Low

### 21. Podman-only infra scripts
- **Where:** `scripts/podman-up.sh`, `scripts/podman-down.sh`, `package.json:18-19`.
- **Impact:** Windows users without WSL or with Docker only must translate the scripts manually.
- **Fix:** Provide a `docker-compose.yml` equivalent and a Makefile that dispatches to whichever is present.

### 22. No OpenAPI / typed client SDK
- **Where:** `src/api/routes/*`.
- **Impact:** Consumers hand-write clients against the JSON contracts.
- **Fix:** Generate an OpenAPI spec from the Zod schemas (`@asteasolutions/zod-to-openapi` or similar) and publish a generated TS client.

### 23. `eval:full` vs `eval` script confusion
- **Where:** `package.json:16-17`.
- **Impact:** Two near-identical scripts (`eval` and `eval:full`) with subtle differences. Easy to run the wrong one.
- **Fix:** Consolidate to one `eval` script with `--full` and `--quick` flags. Document the difference in `--help`.

### 24. No structured logging for retrieval diagnostics
- **Where:** `src/agents/query/nodes/retrieve.ts`.
- **Impact:** When a query returns bad results, there is no easy way to inspect which retriever leg contributed which chunks and at what score.
- **Fix:** Log a single structured event per query with `{ vectorHits, bm25Hits, kgHits, topScores, dedupedCount }`. Optionally expose via `/api/query/debug`.

### 25. Hard-coded recursion limit
- **Where:** `src/agents/query/graph.ts:57` (default 25).
- **Impact:** If a future node is added that requires a longer chain, the graph silently truncates.
- **Fix:** Make the limit `RECURSION_LIMIT` env-driven and warn at startup if it is below the static chain length of the compiled graph.

### 26. README references an absolute path
- **Where:** `README.md:62,148`.
- **Impact:** `C:\Users\HasanKhan\.claude\plans\glittery-booping-hippo.md` is unreachable to anyone cloning the repo.
- **Fix:** Move the plan into `docs/` and link relatively.

### 27. Inconsistent error contracts
- **Where:** `src/shared/errors.ts`, every `throw` site.
- **Impact:** Some routes return `{ error: string }`, others `{ code, message, details }`. The error handler middleware is the only normalization point.
- **Fix:** Define a single `ApiError` response shape in Zod and route all errors through the handler.

### 28. No request ID propagation
- **Where:** `src/api/middleware/requestLogger.ts`, `src/shared/logger.ts`.
- **Impact:** A `requestId` is generated per HTTP request but is not propagated into the LangGraph `configurable.thread_id` or into BullMQ job metadata. Cross-system traces are hard to correlate.
- **Fix:** Generate a UUID per HTTP request, attach it to the logger context, pass it as `configurable.requestId` into the graph, and stamp it on every emitted metric and log line.

### 29. No graceful degradation when Qdrant is down
- **Where:** `src/retrieval/vector.ts`, `src/agents/query/nodes/retrieve.ts`.
- **Impact:** If Qdrant is unavailable, the whole query fails. BM25 + KG could still answer, but they are not consulted.
- **Fix:** Wrap the vector leg in a try/catch, mark it as `unavailable`, and proceed with the remaining legs. Mark the response `degraded: true` and explain why.

### 30. Test fixtures not deterministic
- **Where:** `src/tests/`.
- **Impact:** LLM- and embedding-dependent tests are flaky in CI.
- **Fix:** Inject a fake `EmbeddingProvider` / `LLM` in tests. For integration tests, record-replay OpenAI responses (or use a small local model).

---

## Tracking Matrix

| # | Severity | Area | Status | Owner |
|---|---|---|---|---|
| 1 | Critical | Reliability | Open | — |
| 2 | Critical | Ingestion | Open | — |
| 3 | Critical | Retrieval | Open | — |
| 4 | Critical | RAG quality | Open | — |
| 5 | Critical | RAG quality | Open | — |
| 6 | High | Ingestion | Open | — |
| 7 | High | Memory | Open | — |
| 8 | High | RAG quality | Open | — |
| 9 | High | Security/Privacy | Open | — |
| 10 | High | Security/Tenancy | Open | — |
| 11 | High | DX | Open | — |
| 12 | High | Ops | Open | — |
| 13 | Medium | Ingestion | Open | — |
| 14 | Medium | Pluggability | Open | — |
| 15 | Medium | DX | Open | — |
| 16 | Medium | Testing | Open | — |
| 17 | Medium | Quality | Open | — |
| 18 | Medium | Ops | Open | — |
| 19 | Medium | Security | Open | — |
| 20 | Medium | Security | Open | — |
| 21-30 | Low | Various | Open | — |

---

## Recommended Order of Attack

1. **#1, #2** — Resilience on the hot path. Low effort, high payoff.
2. **#3, #4, #5** — Trust in retrieval and citations. Required before exposing to real users.
3. **#9, #10, #16** — Tenant isolation. Required before multi-tenant go-live.
4. **#7, #8, #12** — Production hardening.
5. **#6, #14, #15, #17** — Quality and velocity.
6. **#13, #18-30** — Continuous improvement.
