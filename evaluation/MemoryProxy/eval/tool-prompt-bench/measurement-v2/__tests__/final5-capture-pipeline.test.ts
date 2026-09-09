import { createServer, type Server } from "node:http";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpCapture, type CaptureEvent } from "../../final5-http-capture.js";
import { projectFinal5Evidence, type AttemptCapture } from "../../final5-evidence.js";
import { summarizeProviderUsage } from "../../final5-provider-usage.js";
import { compileFinal5Gold, final5RuntimeContracts } from "../../final5-gold-compiler.js";
import { scoreCaseChain } from "../scorer.js";
import type { Final5Record } from "../../final5-formal-datasource.js";
import { loadFinal5Dataset } from "../../final5-formal-datasource.js";
import { collectFinal5Evidence } from "../../collect-final5-evidence.js";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function upstream() {
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === "/v1/responses") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40}}}}\n\n');
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 0, data: { items: [{ skill_id: "real-1", version: 3 }] } }));
    }
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + (server.address() as { port: number }).port;
}
const row = (sequence = ["skill_search", "skill_view_by_id", "skill_files_read"]): Final5Record => ({ case_id: "case", team_id: "team", case: {}, evidence: {}, assets: {},
  gold: { should_call: sequence.length > 0, expected_sequence: sequence, target_resource_paths: ["references/a.md"] } });
const manifest: AttemptCapture = { schemaVersion: "final5-attempt-capture-v1", caseId: "case", client: "codex", variant: "V4", repeat: 1, sessionId: "session", lifecycleComplete: true, captureAvailable: true };
const event = (type: string, id: string, extra: Partial<CaptureEvent> = {}): CaptureEvent => ({ type, id, sessionId: "session", timestamp: "2026-09-08T00:00:00Z", ...extra });
function providerEvents(path = "http://provider/v1/responses", rawBody = JSON.stringify({ usage: { input_tokens: 10, output_tokens: 2 } })) {
  return [event("provider.start", "p", { path }), event("provider.end", "p", { rawBody, status: 200 })];
}
function chain() {
  return [
    { attemptId: "search", executorBound: true, family: "skill" as const, tool: "skill_search", endpoint: "/skill-bridge/v3/skill/search", method: "POST", arguments: { query: "target" }, status: 200,
      response: { code: 0, data: { items: [{ skill_id: "other", version: 2 }, { skill_id: "real", version: 3 }] } } },
    { attemptId: "view", executorBound: true, family: "skill" as const, tool: "skill_view_by_id", endpoint: "/skill-bridge/v3/skill/get", method: "POST", arguments: { skill_id: "real", version: 3 }, status: 200,
      response: { code: 0, data: { skill_id: "real", version: 3, manifest: [{ path: "references/a.md" }] } } },
    { attemptId: "file", executorBound: true, family: "skill" as const, tool: "skill_files_read", endpoint: "/skill-bridge/v3/skill/files/read", method: "POST", arguments: { skill_id: "real", path: "references/a.md", version: 3 }, status: 200,
      response: { code: 0, data: { content: "actual file" } } },
  ];
}
function score(attempts: any[]) {
  return scoreCaseChain({ observationWindow: "full-episode", gold: compileFinal5Gold(row()), runtimeContracts: final5RuntimeContracts,
    observation: { evaluationSchemaVersion: 2, caseId: "case", runId: "session", variantId: "V4", rawTraceStatus: "complete", attempts } });
}

describe("Final5 HTTP capture integration", () => {
  it("keeps cancelled title generation diagnostic without invalidating the completed task", () => {
    const main = [event("input.start", "main"), event("input.end", "main", { streamOutcome: "eof" }), ...providerEvents()];
    const auxiliary = [event("input.start", "title", { body: { messages: [{ role: "user", content: "Write the title in the predominant language of the session" }] } }),
      event("provider.start", "title-provider", { parentId: "title", path: "http://provider/v1/messages" }),
      event("input.end", "title", { streamOutcome: "cancelled", rawBody: "partial" })];
    const result = projectFinal5Evidence(row([]), "digest", manifest, [...main, ...auxiliary]);
    expect(result.scoring.observation.rawTraceStatus).toBe("complete");
    expect(result.providerUsage.failedRequestCount).toBe(0);
    expect(result.auxiliaryProviderUsage.failedRequestCount).toBe(1);
    const toolBearing = structuredClone(auxiliary);
    (toolBearing[0].body as any).tools = [{ name: "Bash" }];
    expect(projectFinal5Evidence(row([]), "digest", manifest, [...main, ...toolBearing]).scoring.observation.rawTraceStatus).toBe("partial");
  });
  it("separates successful title usage from task usage while retaining raw diagnostics", () => {
    const main = [event("input.start", "main"), event("input.end", "main"), ...providerEvents()];
    const title = [event("input.start", "title", { body: { messages: [{ role: "user", content: "Write the title in the predominant language of the session" }] } }),
      event("provider.start", "title-p", { parentId: "title", path: "http://provider/v1/messages" }),
      event("provider.end", "title-p", { status: 200, rawBody: JSON.stringify({ usage: { input_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 5 } }) }),
      event("input.end", "title")];
    const result = projectFinal5Evidence(row([]), "digest", manifest, [...main, ...title]);
    expect(result.providerUsageScope).toBe("task-only-excluding-cli-title");
    expect(result.providerUsage.requestCount).toBe(1);
    expect(result.providerUsage.fields.providerTotalInputTokens.value).toBe(10);
    expect(result.auxiliaryProviderUsage.fields.providerTotalInputTokens.value).toBe(3000);
    expect(result.scoring.observation.rawTraceStatus).toBe("complete");
    const toolBearing = structuredClone(title);
    (toolBearing[0].body as any).tools = [{ name: "Bash" }];
    expect(projectFinal5Evidence(row([]), "digest", manifest, [...main, ...toolBearing]).providerUsage.requestCount).toBe(2);
  });
  it("captures real HTTP provider SSE without modifying response bytes, and counts a fanout once", async () => {
    const url = await upstream();
    const events: CaptureEvent[] = [];
    const capture = createHttpCapture(e => events.push(e), fetch);
    const app = new Hono();
    app.use("*", capture.middleware);
    app.post("/codex/v1/responses", async c => capture.fetch(url + "/v1/responses", { method: "POST", body: JSON.stringify(await c.req.json()) }));
    app.post("/memory-bridge/v3/atomic/search", async c => {
      const responses = await Promise.all([1, 2].map(() => capture.fetch(url + "/v3/atomic/search", { method: "POST", body: JSON.stringify({ query: "test" }) })));
      await Promise.all(responses.map(response => response.text()));
      return c.json({ code: 0, data: { items: [{ id: "memory" }] } });
    });
    const response = await app.request("/codex/v1/responses", { method: "POST", headers: { "session-id": "session" }, body: JSON.stringify({ model: "fixture", input: "hello" }) });
    const text = await response.text();
    expect(text).toContain('"input_tokens":100');
    expect(events.find(e => e.type === "provider.end")?.rawBody).toBe(text);
    await (await app.request("/memory-bridge/v3/atomic/search", { method: "POST", headers: { "x-conversation-id": "session" }, body: JSON.stringify({ query: "test" }) })).text();
    expect(events.filter(e => e.type === "tool.bound")).toHaveLength(1);
    const projected = projectFinal5Evidence(row(["tdai_memory_search"]), "digest", manifest, events);
    expect(projected.scoring.observation.rawTraceStatus).toBe("complete");
    expect(projected.scoring.observation.attempts).toHaveLength(1);
    expect(projected.providerUsage?.fields.providerTotalInputTokens.value).toBe(100);
    expect(projected.providerUsage?.fields.outputTokens.value).toBe(20);
  });
  it("isolates concurrent sessions", async () => {
    const url = await upstream();
    const events: CaptureEvent[] = [];
    const capture = createHttpCapture(e => events.push(e), fetch);
    const app = new Hono(); app.use("*", capture.middleware);
    app.post("/v1/responses", c => capture.fetch(url + "/v1/responses", { method: "POST", body: JSON.stringify({ model: "fixture" }) }));
    await Promise.all(["left", "right"].map(async session => (await app.request("/v1/responses", { method: "POST", headers: { "session-id": session }, body: "{}" })).text()));
    for (const session of ["left", "right"]) {
      const own = events.filter(e => e.sessionId === session);
      expect(own.map(e => e.type).sort()).toEqual(["input.end", "input.start", "provider.end", "provider.start"]);
      expect(own.find(e => e.type === "provider.start")?.parentId).toBe(own.find(e => e.type === "input.start")?.id);
    }
  });
});
describe("Final5 compiled response bindings", () => {
  it("accepts a non-first search result and its actual file manifest", () => {
    expect(score(chain()).completeChainSuccess).toBe(true);
    expect(score(chain()).strictChainExact).toBe(true);
  });
  it.each(["invented-id", "cross-item-version", "wrong-file-id", "wrong-version", "unlisted-file", "empty-query"])("rejects %s", kind => {
    const attempts: any[] = chain();
    if (kind === "invented-id") attempts[1].arguments.skill_id = "invented";
    if (kind === "cross-item-version") attempts[1].arguments.version = 2;
    if (kind === "wrong-file-id") attempts[2].arguments.skill_id = "other";
    if (kind === "wrong-version") attempts[2].arguments.version = 4;
    if (kind === "unlisted-file") attempts[1].response.data.manifest = [];
    if (kind === "empty-query") attempts[0].arguments.query = "";
    expect(score(attempts).completeChainSuccess).toBe(false);
  });
  it("retains extra calls after the terminal", () => {
    const attempts = chain();
    const result = score([...attempts, { ...attempts[0], attemptId: "extra" }]);
    expect(result.completeChainSuccess).toBe(true);
    expect(result.strictChainExact).toBe(false);
    expect(result.toolSplContribution).toBe(0.75);
  });
});
describe("Provider usage ledger", () => {
  it.each([429, 500, 503])("excludes HTTP %s from primary totals even if an error body contains usage", status => {
    const events = providerEvents(); events[1].status = status;
    const report = summarizeProviderUsage(events);
    expect(report.requestCount).toBe(0);
    expect(report.failedRequestCount).toBe(1);
    expect(report.fields.providerTotalInputTokens.value).toBeNull();
  });
  it("deduplicates replayed capture records", () => {
    const events = providerEvents();
    const report = summarizeProviderUsage([...events, ...events]);
    expect(report.requestCount).toBe(1);
    expect(report.fields.providerTotalInputTokens.value).toBe(10);
    expect(report.fields.cacheReadInputTokens.value).toBeNull();
  });
  it("merges Anthropic cumulative output and sums disjoint input categories", () => {
    const raw = [
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 1 } } },
      { type: "message_delta", usage: { output_tokens: 4 } }, { type: "message_delta", usage: { output_tokens: 8 } }, { type: "message_stop" },
    ].map(e => "data: " + JSON.stringify(e) + "\n\n").join("");
    const report = summarizeProviderUsage(providerEvents("http://provider/v1/messages", raw));
    expect(report.fields.providerTotalInputTokens.value).toBe(60);
    expect(report.fields.outputTokens.value).toBe(8);
    expect(report.cacheReadRatio).toBeCloseTo(1 / 3);
  });
  it("does not treat an incomplete stream as an exact cost total", () => {
    const raw = 'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":0}}}\n\n';
    expect(summarizeProviderUsage(providerEvents("http://provider/v1/messages", raw)).fields.outputTokens.value).toBeNull();
  });
  it("retains retry requests and missing usage instead of silently dropping them", () => {
    const report = summarizeProviderUsage([...providerEvents(), event("provider.start", "retry", { path: "http://provider/v1/responses" }), event("provider.failed", "retry")]);
    expect(report.requestCount).toBe(1);
    expect(report.observedRequestCount).toBe(2);
    expect(report.failedRequestCount).toBe(1);
    expect(report.fields.providerTotalInputTokens.knownSum).toBe(10);
    expect(report.fields.providerTotalInputTokens.value).toBe(10);
  });
});
describe("Evidence completeness", () => {
  it("keeps model argument errors as observed behavior, not provider failure", () => {
    const events = [event("input.start", "i"), event("input.end", "i"), ...providerEvents(),
      event("tool.start", "t", { path: "/memory-bridge/v3/atomic/search", method: "POST", body: { query: 12 } }),
      event("tool.bound", "t"), event("tool.end", "t", { status: 400, rawBody: '{"code":40001}' })];
    const projected = projectFinal5Evidence(row(["tdai_memory_search"]), "digest", manifest, events);
    const score = scoreCaseChain(projected.scoring);
    expect(score.triggeredAttempt).toBe(true);
    expect(score.completeChainSuccess).toBe(false);
    expect(projected.scoring.observation.rawTraceStatus).toBe("complete");
    expect(projected.providerUsage?.failedRequestCount).toBe(0);
  });
  it("leaves no-call unknown when provider evidence is absent", () => {
    expect(projectFinal5Evidence(row([]), "digest", manifest, []).scoring.observation.rawTraceStatus).toBe("missing");
  });
  it("detects unfinished bridge responses and cross-session contamination", () => {
    const events = [event("input.start", "i"), event("input.end", "i"), ...providerEvents(), event("tool.start", "t", { path: "/skill-bridge/v3/skill/search", method: "POST", body: { query: "x" } }), event("tool.bound", "t")];
    expect(projectFinal5Evidence(row([]), "digest", manifest, events).scoring.observation.rawTraceStatus).toBe("partial");
    expect(() => projectFinal5Evidence(row([]), "digest", manifest, [{ ...events[0], sessionId: "other" }])).toThrow(/Cross-session/);
  });
});

it("recalculates stage artifacts end to end, excludes failed requests from primary usage, and retains retry diagnostics", () => {
  const root = mkdtempSync(join(tmpdir(), "final5-collector-test-"));
  try {
    const teams = join(root, "teams"), data = join(teams, "team/data"); mkdirSync(data, { recursive: true });
    const cases = ["positive", "negative"];
    const jsonl = (name: string, rows: unknown[]) => writeFileSync(join(data, name), rows.map(row => JSON.stringify(row) + "\n").join(""));
    jsonl("cases.jsonl", cases.map(case_id => ({ case_id })));
    jsonl("gold.jsonl", cases.map(case_id => ({ case_id, pair_id: "pair", should_call: case_id === "positive", expected_sequence: case_id === "positive" ? ["tdai_memory_search"] : [] })));
    jsonl("evidence.jsonl", cases.map(case_id => ({ case_id })));
    writeFileSync(join(data, "assets.json"), "{}");
    const dataset = loadFinal5Dataset(teams);
    for (const variant of ["server_team", "V4"] as const) {
      const stage = join(root, "codex", variant); mkdirSync(stage, { recursive: true });
      const results = cases.map(caseId => {
        const withRetry = variant === "server_team" && caseId === "positive";
        const attempts = Array.from({ length: withRetry ? 2 : 1 }, (_, attempt) => {
          const failed = withRetry && attempt === 0;
          const directory = join(stage, "execution.json.evidence", caseId + "-" + attempt); mkdirSync(directory, { recursive: true });
          const sessionId = `${variant}-${caseId}-${attempt}`;
          const capture: AttemptCapture = { ...manifest, sessionId, variant, caseId, lifecycleComplete: !failed };
          const records = [event("input.start", "i"), event("input.end", "i"), ...providerEvents()];
          if (failed) records[3] = event("provider.failed", "p");
          if (!failed && caseId === "positive") records.push(event("tool.start", "t", { path: "/memory-bridge/v3/atomic/search", method: "POST", body: { query: "memory" } }), event("tool.bound", "t"), event("tool.end", "t", { status: 200, rawBody: '{"code":0,"data":{"items":[]}}' }));
          writeFileSync(join(directory, "attempt-capture.json"), JSON.stringify(capture));
          writeFileSync(join(directory, "http-events.jsonl"), records.map(record => JSON.stringify({ ...record, sessionId, id: sessionId + ":" + record.id }) + "\n").join(""));
          return { attempt, status: failed ? "failed" : "completed", retryable: failed, startedAt: "2026-09-08", durationMs: 1, evidenceDirectory: directory };
        });
        return { caseId, variant, repeat: 1, status: "completed", attempts };
      });
      const receipt = { schemaVersion: "task1.final5-execution-receipt.v1", campaignId: variant, datasetDigest: dataset.sourceDigest,
        planSha256: "fixture", slotCount: 2, completed: 2, failed: 0, results,
        executionContext: { comparison: { client: "codex", model: "synthetic-wire-fixture" }, stage: { variant, profile: variant === "V4" ? "v4-compact" : "legacy" } } };
      writeFileSync(join(stage, "execution.json"), JSON.stringify({ ...receipt, receiptSha256: createHash("sha256").update(JSON.stringify(receipt)).digest("hex") }));
    }
    const output = join(root, "report");
    const report = collectFinal5Evidence(teams, join(root, "codex"), "codex", output);
    expect(report.status).toBe("behavior-scored");
    expect(report.comparison.Complete.final.value).toBe(1);
    expect(report.comparison.Strict.final.value).toBe(1);
    expect(report.comparison.FCR_all.final.value).toBe(0);
    expect(report.providerUsage.server_team.requestCount).toBe(2);
    expect(report.providerUsage.server_team.fields.providerTotalInputTokens.value).toBe(20);
    expect(report.costAllAttempts.server_team.observedRequestCount).toBe(3);
    expect(report.costAllAttempts.server_team.failedRequestCount).toBe(1);
    expect(report.costAllAttempts.server_team.fields.providerTotalInputTokens.value).toBeNull();
    expect(report.attemptsMissingCapture).toEqual([]);
    expect(readFileSync(join(output, "case-scores.jsonl"), "utf8").trim().split("\n")).toHaveLength(4);
    expect(collectFinal5Evidence(teams, join(root, "codex"), "codex", output)).toEqual(report);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
