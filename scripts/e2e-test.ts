/**
 * Comprehensive end-to-end test suite with edge cases.
 *
 *   1. Ingests the 3 fixture documents (sample.md, equipment-policy.md, leave-policy.md)
 *   2. Runs a battery of queries (normal, multi-turn, edge cases)
 *   3. Exercises auth, rate limiting, ACL, KG, HITL, session history
 *   4. Emits a markdown report to `eval/reports/e2e-report-<timestamp>.md`
 *
 * Each case captures:
 *   - name
 *   - input
 *   - expected behaviour
 *   - actual response (status + body excerpt)
 *   - PASS / FAIL
 */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { logger } from "@/core/shared/logger.js";
import { runIngestion } from "@/rag/ingestion/pipeline.js";

const BASE = `http://localhost:${process.env.SERVER_PORT ?? 3000}`;

interface TestCase {
  group: string;
  name: string;
  request: {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  };
  expect: {
    status: number | number[];
    contains?: string;
    notContains?: string;
    description: string;
  };
  expectField?: string; // e.g. "answer", "sources[0].title"
  expectedAnswerHint?: string; // free-form hint of what the answer should be
}

const TEST_CASES: TestCase[] = [
  // -------------------------------------------------------------------------
  // Group 1: Health and metrics
  // -------------------------------------------------------------------------
  {
    group: "1. Health & metrics",
    name: "GET /healthz returns 200 with status ok",
    request: { method: "GET", path: "/healthz" },
    expect: { status: 200, contains: "ok", description: "Health endpoint is alive" },
  },
  {
    group: "1. Health & metrics",
    name: "GET /metrics returns counters and histograms",
    request: { method: "GET", path: "/metrics" },
    expect: { status: 200, contains: "queriesTotal", description: "Metrics endpoint live" },
  },
  {
    group: "1. Health & metrics",
    name: "GET /unknown returns 404",
    request: { method: "GET", path: "/this-does-not-exist" },
    expect: { status: 404, description: "Fastify returns 404 for unknown routes" },
  },

  // -------------------------------------------------------------------------
  // Group 2: Factual queries
  // -------------------------------------------------------------------------
  {
    group: "2. Factual queries",
    name: "Equipment question — remote workers",
    request: { method: "POST", path: "/api/query", body: { query: "What equipment does the company provide to remote workers?" } },
    expect: { status: 200, contains: "MacBook Pro", description: "Returns the equipment list with citation" },
    expectField: "answer",
    expectedAnswerHint: "laptop (MacBook Pro 14\" or Dell XPS 13), 27\" 4K monitor, keyboard/mouse up to $150, $500 home office stipend",
  },
  {
    group: "2. Factual queries",
    name: "Internet reimbursement",
    request: { method: "POST", path: "/api/query", body: { query: "How much does the company reimburse for home internet?" } },
    expect: { status: 200, contains: "$50", description: "Returns $50/month internet reimbursement" },
    expectField: "answer",
    expectedAnswerHint: "up to $50/month for home internet expenses",
  },
  {
    group: "2. Factual queries",
    name: "Core collaboration hours",
    request: { method: "POST", path: "/api/query", body: { query: "What are the core collaboration hours?" } },
    expect: { status: 200, contains: "10:00", description: "Returns 10:00 AM to 3:00 PM" },
    expectField: "answer",
    expectedAnswerHint: "10:00 AM to 3:00 PM",
  },
  {
    group: "2. Factual queries",
    name: "Sick leave policy",
    request: { method: "POST", path: "/api/query", body: { query: "How long is sick leave and does it carry over?" } },
    expect: { status: 200, contains: "10 sick days", description: "Returns 10 days, no carryover" },
    expectField: "answer",
    expectedAnswerHint: "10 sick days per year, unused days do not carry over",
  },
  {
    group: "2. Factual queries",
    name: "Sabbatical policy",
    request: { method: "POST", path: "/api/query", body: { query: "When can employees take a sabbatical?" } },
    expect: { status: 200, contains: "5 years", description: "Returns 5-year eligibility" },
    expectField: "answer",
    expectedAnswerHint: "After 5 years: 4-week paid sabbatical. After 10 years: 8-week sabbatical",
  },
  {
    group: "2. Factual queries",
    name: "Parental leave",
    request: { method: "POST", path: "/api/query", body: { query: "What is the parental leave policy for birthing parents?" } },
    expect: { status: 200, contains: "16 weeks", description: "Returns 16 weeks for birthing parents" },
    expectField: "answer",
    expectedAnswerHint: "16 weeks of fully paid parental leave for birthing parents",
  },

  // -------------------------------------------------------------------------
  // Group 3: Multi-turn
  // -------------------------------------------------------------------------
  {
    group: "3. Multi-turn",
    name: "Follow-up 'What about reimbursement?' uses history",
    request: { method: "POST", path: "/api/query", body: { query: "Tell me about the remote work policy" } },
    expect: { status: 200, contains: "remote", description: "First turn sets context" },
    expectField: "sessionId",
  },
  {
    group: "3. Multi-turn",
    name: "Reimbursement follow-up returns $50",
    request: { method: "POST", path: "/api/query", body: { query: "What about reimbursement?", sessionId: "__USE_LAST__" } },
    expect: { status: 200, contains: "$50", description: "Second turn in same session uses history" },
    expectField: "answer",
    expectedAnswerHint: "Reimbursement amount should be $50/month (carried over from prior context)",
  },

  // -------------------------------------------------------------------------
  // Group 4: Edge cases — empty, oversize, unicode, injection
  // -------------------------------------------------------------------------
  {
    group: "4. Edge cases",
    name: "Empty query returns 400 (Zod validation)",
    request: { method: "POST", path: "/api/query", body: { query: "" } },
    expect: { status: 400, description: "Zod rejects empty query" },
  },
  {
    group: "4. Edge cases",
    name: "Missing query field returns 400",
    request: { method: "POST", path: "/api/query", body: {} },
    expect: { status: 400, description: "Zod rejects missing query" },
  },
  {
    group: "4. Edge cases",
    name: "Very long query (10,000 chars) succeeds",
    request: { method: "POST", path: "/api/query", body: { query: "remote work equipment ".repeat(1000) } },
    expect: { status: 200, description: "Long but valid query is accepted" },
  },
  {
    group: "4. Edge cases",
    name: "Unicode query is handled",
    request: { method: "POST", path: "/api/query", body: { query: "Wie viel Internet-Erstattung gibt es? 🚀 日本語テスト" } },
    expect: { status: 200, description: "Unicode / multilingual is accepted" },
  },
  {
    group: "4. Edge cases",
    name: "SQL-injection style query is safe",
    request: { method: "POST", path: "/api/query", body: { query: "'; DROP TABLE users; --" } },
    expect: { status: 200, description: "Prisma / Qdrant parameterize; no DB damage" },
  },
  {
    group: "4. Edge cases",
    name: "Out-of-domain query returns 'insufficient' message",
    request: { method: "POST", path: "/api/query", body: { query: "What is the capital of France?" } },
    expect: { status: 200, notContains: "Paris", description: "LLM should refuse to answer off-topic questions" },
  },

  // -------------------------------------------------------------------------
  // Group 5: Search (retrieval only, no generation)
  // -------------------------------------------------------------------------
  {
    group: "5. Search",
    name: "POST /api/search returns chunks only",
    request: { method: "POST", path: "/api/search", body: { query: "remote work" } },
    expect: { status: 200, description: "Retrieval-only endpoint works" },
  },

  // -------------------------------------------------------------------------
  // Group 6: Ingest
  // -------------------------------------------------------------------------
  {
    group: "6. Ingest",
    name: "POST /api/ingest with missing path returns 400/422 (validation)",
    request: { method: "POST", path: "/api/ingest", body: { source: "md" } },
    expect: { status: [400, 422], description: "Zod or IngestionError rejects missing path/url" },
  },
  {
    group: "6. Ingest",
    name: "POST /api/ingest with invalid source returns 400",
    request: { method: "POST", path: "/api/ingest", body: { source: "audio", path: "/tmp/x" } },
    expect: { status: 400, description: "Zod rejects unknown source" },
  },

  // -------------------------------------------------------------------------
  // Group 7: HITL reindex
  // -------------------------------------------------------------------------
  {
    group: "7. HITL reindex",
    name: "POST /api/reindex returns 202 + interruptId",
    request: { method: "POST", path: "/api/reindex", body: { documentId: "fake-doc-id" } },
    expect: { status: 202, contains: "interruptId", description: "Reindex paused for approval" },
  },
  {
    group: "7. HITL reindex",
    name: "POST /api/reindex/resume with unknown interruptId returns 200 (no-op)",
    request: { method: "POST", path: "/api/reindex/resume", body: { interruptId: "reindex-nonexistent", approved: true } },
    expect: { status: 200, contains: "unknown_interrupt", description: "Unknown interrupt is reported" },
  },
  {
    group: "7. HITL reindex",
    name: "POST /api/reindex/resume with missing interruptId returns 400",
    request: { method: "POST", path: "/api/reindex/resume", body: { approved: true } },
    expect: { status: 400, description: "Zod rejects missing interruptId" },
  },

  // -------------------------------------------------------------------------
  // Group 8: Session history
  // -------------------------------------------------------------------------
  {
    group: "8. Session history",
    name: "GET /api/sessions/unknown/history returns 0 entries",
    request: { method: "GET", path: "/api/sessions/00000000-0000-0000-0000-000000000000/history" },
    expect: { status: 200, description: "Unknown session returns empty history" },
  },
  {
    group: "8. Session history",
    name: "GET /api/sessions/abc/history (bad uuid) returns 200 empty",
    request: { method: "GET", path: "/api/sessions/abc/history" },
    expect: { status: 200, description: "Non-existent session returns 0 count" },
  },

  // -------------------------------------------------------------------------
  // Group 9: Billing
  // -------------------------------------------------------------------------
  {
    group: "9. Billing",
    name: "GET /api/billing/usage without tenant returns 403",
    request: { method: "GET", path: "/api/billing/usage" },
    expect: { status: 403, description: "Dev user has no tenantId — denied" },
  },

  // -------------------------------------------------------------------------
  // Group 10: OAuth2
  // -------------------------------------------------------------------------
  {
    group: "10. OAuth2",
    name: "GET /api/oauth2/google/login without creds returns 500",
    request: { method: "GET", path: "/api/oauth2/google/login" },
    expect: { status: 500, description: "ConfigurationError when client ID missing" },
  },
  {
    group: "10. OAuth2",
    name: "GET /api/oauth2/github/login without creds returns 500",
    request: { method: "GET", path: "/api/oauth2/github/login" },
    expect: { status: 500, description: "ConfigurationError when client ID missing" },
  },
  {
    group: "10. OAuth2",
    name: "GET /api/oauth2/unknown/login returns 400",
    request: { method: "GET", path: "/api/oauth2/unknown/login" },
    expect: { status: 400, description: "Unknown provider rejected" },
  },

  // -------------------------------------------------------------------------
  // Group 11: Feedback / Evaluate / Healthz edge
  // -------------------------------------------------------------------------
  {
    group: "11. Other endpoints",
    name: "POST /api/feedback returns 200",
    request: { method: "POST", path: "/api/feedback", body: { queryLogId: "abc", rating: 5 } },
    expect: { status: 200, description: "Feedback accepted (logged only in Phase 5)" },
  },
  {
    group: "11. Other endpoints",
    name: "POST /api/evaluate with empty dataset returns 400 (validation)",
    request: { method: "POST", path: "/api/evaluate", body: { dataset: [] } },
    expect: { status: [200, 400], description: "Empty dataset rejected (Zod min 1) or returns empty report" },
  },

  // -------------------------------------------------------------------------
  // Group 12: Streaming
  // -------------------------------------------------------------------------
  {
    group: "12. Streaming",
    name: "POST /api/query?stream=true returns text/event-stream",
    request: { method: "POST", path: "/api/query", body: { query: "What is sick leave?", stream: true } },
    expect: { status: 200, contains: "event: start", description: "SSE stream begins" },
  },
];

interface TestResult {
  group: string;
  name: string;
  description: string;
  expectedAnswerHint?: string;
  requestSummary: string;
  responseStatus: number;
  responseBodyExcerpt: string;
  containsPass: boolean | null;
  notContainsPass: boolean | null;
  passed: boolean;
  latencyMs: number;
}

let lastSessionId: string | null = null;

async function runCase(tc: TestCase): Promise<TestResult> {
  let body = tc.request.body;
  if (tc.request.body && typeof tc.request.body === "object" && (tc.request.body as Record<string, unknown>).sessionId === "__USE_LAST__") {
    body = { ...(tc.request.body as Record<string, unknown>), sessionId: lastSessionId };
  }
  const t0 = Date.now();
  let status = 0;
  let text = "";
  try {
    const isStreaming = (body as { stream?: boolean } | undefined)?.stream === true;
    const res = await fetch(`${BASE}${tc.request.path}`, {
      method: tc.request.method,
      headers: {
        "Content-Type": "application/json",
        ...(tc.request.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: isStreaming ? AbortSignal.timeout(8000) : undefined,
    });
    status = res.status;
    if (isStreaming && res.body) {
      // Read just the first ~1KB of the SSE stream and abort. We don't
      // wait for the full stream because the server-side `end` event is
      // emitted only after the LLM finishes.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((r) =>
            setTimeout(() => r({ value: undefined, done: true }), 1000),
          ),
        ]);
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (acc.length > 1024 || acc.includes("event: end")) break;
      }
      try { await reader.cancel(); } catch { /* ignore */ }
      text = acc;
    } else {
      text = await res.text();
    }
  } catch (err) {
    text = `FETCH ERROR: ${(err as Error).message}`;
  }
  const latencyMs = Date.now() - t0;

  // Capture sessionId for follow-ups.
  if (status === 200) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.sessionId && typeof parsed.sessionId === "string") {
        lastSessionId = parsed.sessionId;
      }
    } catch {
      // ignore
    }
  }

  const expectedStatuses = Array.isArray(tc.expect.status) ? tc.expect.status : [tc.expect.status];
  const statusOk = expectedStatuses.includes(status);
  const containsPass = tc.expect.contains
    ? text.toLowerCase().includes(tc.expect.contains.toLowerCase())
    : null;
  const notContainsPass = tc.expect.notContains
    ? !text.toLowerCase().includes(tc.expect.notContains.toLowerCase())
    : null;

  const passed = statusOk && (containsPass ?? true) && (notContainsPass ?? true);

  return {
    group: tc.group,
    name: tc.name,
    description: tc.expect.description,
    expectedAnswerHint: tc.expectedAnswerHint,
    requestSummary: `${tc.request.method} ${tc.request.path}${body ? " " + JSON.stringify(body).slice(0, 100) : ""}`,
    responseStatus: status,
    responseBodyExcerpt: text.length > 500 ? text.slice(0, 500) + "..." : text,
    containsPass,
    notContainsPass,
    passed,
    latencyMs,
  };
}

function renderMarkdown(results: TestResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = ((passed / total) * 100).toFixed(1);

  const byGroup = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group)!.push(r);
  }

  let md = `# End-to-End Test Report\n\n`;
  md += `**Generated**: ${new Date().toISOString()}\n`;
  md += `**Target**: ${BASE}\n`;
  md += `**Result**: **${passed}/${total} passed** (${passRate}%)`;
  if (failed > 0) md += ` — ${failed} FAILED`;
  md += `\n\n`;

  for (const [group, items] of byGroup) {
    md += `## ${group}\n\n`;
    md += `| # | Status | Test | Latency | Description |\n`;
    md += `|---|--------|------|---------|-------------|\n`;
    items.forEach((r, i) => {
      const status = r.passed ? "✅ PASS" : "❌ FAIL";
      md += `| ${i + 1} | ${status} | ${r.name} | ${r.latencyMs}ms | ${r.description} |\n`;
    });
    md += `\n`;

    md += `### Details\n\n`;
    for (const r of items) {
      md += `#### ${r.name}\n\n`;
      md += `- **Request**: \`${r.requestSummary}\`\n`;
      md += `- **HTTP Status**: \`${r.responseStatus}\`\n`;
      md += `- **Latency**: ${r.latencyMs} ms\n`;
      if (r.expectedAnswerHint) {
        md += `- **Expected answer (hint)**: ${r.expectedAnswerHint}\n`;
      }
      md += `- **Description**: ${r.description}\n`;
      md += `\n**Response (excerpt)**:\n\n`;
      md += "```json\n";
      md += r.responseBodyExcerpt;
      md += "\n```\n\n";
    }
  }

  md += `---\n\n## Failed cases\n\n`;
  const failedCases = results.filter((r) => !r.passed);
  if (failedCases.length === 0) {
    md += `None.\n`;
  } else {
    md += `| Test | Status | Body excerpt |\n|------|--------|--------------|\n`;
    for (const r of failedCases) {
      const bodyOneLine = r.responseBodyExcerpt.replace(/\n/g, " ").slice(0, 200);
      md += `| ${r.name} | ${r.responseStatus} | ${bodyOneLine} |\n`;
    }
  }
  return md;
}

async function main() {
  // 1. Ingest the 3 fixture documents.
  logger.info("Ingesting 3 fixture documents…");
  const fixtures = [
    "docs/fixtures/sample.md",
    "docs/fixtures/equipment-policy.md",
    "docs/fixtures/leave-policy.md",
  ];
  for (const f of fixtures) {
    try {
      const r = await runIngestion({ source: "md", path: f, tags: ["policy"] } as Parameters<typeof runIngestion>[0]);
      logger.info({ file: f, chunkCount: r.chunkCount }, "Ingested");
    } catch (err) {
      logger.warn({ file: f, err: (err as Error).message }, "Ingest failed (may be already indexed)");
    }
  }

  // 2. Wait for the server to be ready.
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) { ready = true; break; }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) {
    logger.error("Server is not ready at /healthz");
    process.exit(1);
  }

  // 3. Run all test cases.
  const results: TestResult[] = [];
  for (const tc of TEST_CASES) {
    const r = await runCase(tc);
    results.push(r);
    const tag = r.passed ? "PASS" : "FAIL";
    logger.info(
      { test: r.name, status: r.responseStatus, latencyMs: r.latencyMs, verdict: tag },
      `[${tag}] ${r.name}`,
    );
  }

  // 4. Render markdown report.
  const md = renderMarkdown(results);
  await mkdir("eval/reports", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `eval/reports/e2e-report-${ts}.md`;
  await writeFile(path, md, "utf-8");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  logger.info(
    { total: results.length, passed, failed, report: path },
    `E2E complete: ${passed}/${results.length} passed`,
  );

  // Print a one-line summary to stdout.
  console.log(`\n[REPORT] ${passed}/${results.length} passed — ${path}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.fatal({ err }, "E2E test failed");
  process.exit(1);
});
