import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Final5Record } from "./final5-formal-datasource.js";
import { sessionCapturePath, isFinal5TitleRequest, type CaptureEvent } from "./final5-http-capture.js";
import { compileFinal5Gold, final5RuntimeContracts, FINAL5_GOLD_COMPILER_VERSION } from "./final5-gold-compiler.js";
import { summarizeProviderUsage } from "./final5-provider-usage.js";
import type { Final5MetricEvidence } from "./final5-metrics-report.js";
import type { JsonObjectV2, JsonValueV2 } from "./measurement-v2/types.js";
import { parseCodexJsonlEvents } from "./codex-runner.js";
import { normalizeClaudeCommand } from "./claude-curl-normalizer.js";
import { extractClaudeCommandObservations } from "./claude-code-event-parser.js";

export interface AttemptCapture {
  schemaVersion: "final5-attempt-capture-v1";
  client: "codex" | "claude-code"; caseId: string; variant: "server_team" | "V4"; repeat: number;
  sessionId: string; lifecycleComplete: boolean; captureAvailable: boolean;
}
export interface Final5IntentEvidence {
  schemaVersion: "final5-intent-evidence-v1";
  complete: boolean;
  attempts: readonly {
    intentId: string;
    disposition: "dispatchable" | "malformed";
    source: "model" | "harness" | "unknown";
    family?: "memory" | "skill" | "knowledge";
    tool?: string;
    reason?: string;
  }[];
}
export function sealAttemptCapture(directory: string, input: Omit<AttemptCapture, "schemaVersion" | "captureAvailable">) {
  const source = process.env.FINAL5_HTTP_EVENTS_DIR ? sessionCapturePath(process.env.FINAL5_HTTP_EVENTS_DIR, input.sessionId) : undefined;
  const captureAvailable = !!source && existsSync(source);
  if (captureAvailable) writeFileSync(join(directory, "http-events.jsonl"), readFileSync(source!), { flag: "wx" });
  writeIntentEvidence(directory, input.client);
  writeFileSync(join(directory, "attempt-capture.json"), JSON.stringify({ schemaVersion: "final5-attempt-capture-v1", ...input, captureAvailable }, null, 2) + "\n", { flag: "wx" });

}

function writeIntentEvidence(directory: string, client: AttemptCapture["client"]): void {
  const file = join(directory, client === "claude-code" ? "claude-code-events.jsonl" : "codex-events.jsonl");
  const attempts: Final5IntentEvidence["attempts"] = [];
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    if (client === "claude-code") {
      for (const [index, observation] of extractClaudeCommandObservations(text).entries()) {
        if (!/memory-bridge|skill-bridge|\/tools\//iu.test(observation.command)) continue;
        const parsed = normalizeClaudeCommand(observation.command);
        attempts.push({ intentId: `claude:${observation.lineNumber}:${index}`, source: "model",
          disposition: parsed.malformedReason ? "malformed" : "dispatchable", family: parsed.family, tool: parsed.tool, arguments: parsed.body as JsonObjectV2,
          ...(parsed.malformedReason ? { reason: parsed.malformedReason } : {}) });
      }
    } else {
      for (const [index, record] of parseCodexJsonlEvents(text).entries()) {
        const event = record.event;
        const value = JSON.stringify(event ?? record.raw);
        if (!/memory-bridge|skill-bridge|\/tools\//iu.test(value)) continue;
        attempts.push({ intentId: `codex:${record.lineNumber}:${index}`, source: "model",
          disposition: "dispatchable" });
      }
    }
  }
  writeFileSync(join(directory, "intent-evidence.json"), JSON.stringify({ schemaVersion: "final5-intent-evidence-v1", complete: existsSync(file), attempts }, null, 2) + "\n", { flag: "wx" });

}
export function readAttemptCapture(directory: string) {
  const manifest = JSON.parse(readFileSync(join(directory, "attempt-capture.json"), "utf8")) as AttemptCapture;
  if (manifest.schemaVersion !== "final5-attempt-capture-v1" || !manifest.sessionId) throw new Error("Invalid attempt capture");
  const events: CaptureEvent[] = manifest.captureAvailable ? readFileSync(join(directory, "http-events.jsonl"), "utf8").split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)) : [];

  const intentPath = join(directory, "intent-evidence.json");
  const intentEvidence = existsSync(intentPath)
    ? JSON.parse(readFileSync(intentPath, "utf8")) as Final5IntentEvidence
    : null;
  return { manifest, events, intentEvidence };
}

export function projectFinal5Evidence(row: Final5Record, datasetDigest: string, manifest: AttemptCapture, source: readonly CaptureEvent[], intentEvidence: Final5IntentEvidence | null = null): Final5MetricEvidence {
  if (manifest.caseId !== row.case_id || manifest.repeat !== 1) throw new Error("Attempt Case/repeat mismatch");
  const unique = new Map<string, CaptureEvent>();
  for (const event of source) {
    if (event.sessionId !== manifest.sessionId) throw new Error("Cross-session evidence contamination");
    const key = event.type + ":" + event.id;
    if (unique.has(key) && JSON.stringify(unique.get(key)) !== JSON.stringify(event)) throw new Error("Conflicting HTTP event");
    unique.set(key, event);
  }
  const events = [...unique.values()];
  const starts = events.filter(event => event.type === "tool.start");
  const providers = events.filter(event => event.type === "provider.start");
  const inputs = events.filter(event => event.type === "input.start");
  const auxiliaryIds = new Set(inputs.filter(event => isFinal5TitleRequest(event.body)).map(event => event.id));
  const taskInputs = inputs.filter(event => !auxiliaryIds.has(event.id));
  const taskProviders = providers.filter(event => !event.parentId || !auxiliaryIds.has(event.parentId));
  const endFor = (event: CaptureEvent, type: string) => unique.get(type + ":" + event.id);
  const modelIntents = intentEvidence?.attempts.filter(attempt => attempt.source === "model") ?? [];
  const usedStarts = new Set<string>();
  const intentBindings = modelIntents.map((intent, index) => {
    const exact = starts.find(start => !usedStarts.has(start.id) && intent.tool && final5RuntimeContracts.find(contract => contract.endpoint === start.path && contract.method === start.method)?.tool === intent.tool && JSON.stringify(start.body) === JSON.stringify(intent.arguments));
    const ordinal = starts[index] && !usedStarts.has(starts[index].id) ? starts[index] : undefined;
    const selected = exact ?? ordinal;
    if (selected) usedStarts.add(selected.id);
    return { intentId: intent.intentId, correlationId: selected?.id ?? null, alignment: exact ? "exact" : selected ? "ordinal" : "unmatched", disposition: intent.disposition, source: intent.source };
  });
  const attempts = starts.map((start) => {
    const end = endFor(start, "tool.end");
    const contract = final5RuntimeContracts.find(contract => contract.endpoint === start.path && contract.method === start.method);
    let response: JsonValueV2 | undefined;
    try { response = JSON.parse(end?.rawBody ?? ""); } catch { response = end?.rawBody; }
    const bound = unique.has("tool.bound:" + start.id);
    return { attemptId: start.id, executorBound: bound,
      family: contract?.family ?? (start.path?.startsWith("/memory-bridge/") ? "memory" as const : "skill" as const),
      tool: contract?.tool, endpoint: start.path, method: start.method, arguments: typeof start.body === "object" && start.body !== null && !Array.isArray(start.body) ? start.body as JsonObjectV2 : undefined,
      response, status: end?.status, recognizableTdaiIntent: true,
      ...(intentBindings.find(binding => binding.correlationId === start.id)?.intentId ? { intentId: intentBindings.find(binding => binding.correlationId === start.id)!.intentId } : {}),
      ...(!bound ? { malformedReason: "bridge-rejected-before-executor-binding" } : {}) };
  });
  const noOrphans = events.every(event => !["tool.bound", "tool.end"].includes(event.type) || unique.has("tool.start:" + event.id));
  const transportClosed = taskProviders.every(event => !!endFor(event, "provider.end") || !!endFor(event, "provider.failed"));
  const inputComplete = manifest.captureAvailable && taskInputs.length > 0 && taskProviders.length > 0
    && taskInputs.every(event => {
      const end = endFor(event, "input.end");
      if (!end || end.streamOutcome === "error") return false;
      if (end.streamOutcome !== "cancelled") return true;
      return /"type"\s*:\s*"(?:response.completed|message_stop)"/.test(end.rawBody ?? "");
    });
  // Title-generation turns are auxiliary CLI traffic. They must not enter the
  // task token/cost denominator, even though their raw events remain archived.
  const taskProviderIds = new Set(taskProviders.map(event => event.id));
  const taskProviderEvents = events.filter(event => event.type !== "provider.start" && event.type !== "provider.end" && event.type !== "provider.failed"
    || taskProviderIds.has(event.id));
  const providerUsage = summarizeProviderUsage(taskProviderEvents);
  const auxiliaryProviderUsage = summarizeProviderUsage(events.filter(event =>
    ["provider.start", "provider.end", "provider.failed"].includes(event.type) && !taskProviderIds.has(event.id)));
  const complete = inputComplete && providerUsage.requests.some(request => request.succeeded) && manifest.lifecycleComplete && noOrphans && transportClosed && starts.every(event => !!endFor(event, "tool.end"));
  return { datasetDigest, client: manifest.client, variant: manifest.variant, caseId: row.case_id, repeat: 1,
    inputComplete, intentComplete: intentEvidence?.complete === true, intentEvidence: { complete: intentEvidence?.complete === true, observedModelIntentCount: modelIntents.length, boundHttpAttemptCount: starts.length, intentBindings }, compilerVersion: FINAL5_GOLD_COMPILER_VERSION,
    providerUsage, auxiliaryProviderUsage, providerUsageScope: "task-only-excluding-cli-title",
    scoring: { observationWindow: "full-episode", observation: { evaluationSchemaVersion: 2, caseId: row.case_id,
      runId: manifest.sessionId, variantId: manifest.variant, rawTraceStatus: complete ? "complete" : events.length ? "partial" : "missing", attempts },
      gold: compileFinal5Gold(row), runtimeContracts: final5RuntimeContracts } };
}
