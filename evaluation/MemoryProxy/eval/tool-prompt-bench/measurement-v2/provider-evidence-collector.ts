import { createHash } from "node:crypto";

import {
  auditCapturedRealChainRequest,
  extractCapturedRealChainInjection,
  type CapturedRealChainAudit,
} from "../real-chain-adapter.js";
import type { ObservedRunWindow } from "./observed-event-collector.js";
import {
  validateProviderPromptSourceEvidence,
  type ProviderPromptSourceEvidence,
} from "../../../../../implementations/final/MemoryProxy/src/injection/production-source.js";
import {
  normalizeProviderUsage,
  type ProviderUsageNormalizationResult,
} from "./provider-usage.js";

const EVENT_SCHEMA = "task1.provider-request-event.v1";
const SOURCE = "memory-proxy-provider";

/** Frozen provider/usage identity shared by collection and campaign sealing. */
export const FORMAL_PROVIDER_USAGE_CONTRACT = Object.freeze({
  provider: "openai" as const,
  schema: "openai.responses" as const,
  apiVersion: "v1",
  adapterVersion: "memory-proxy-provider-observer-v1",
  requiredFields: Object.freeze([
    "providerTotalInputTokens",
    "ordinaryInputTokens",
    "cacheReadInputTokens",
    "outputTokens",
    "reasoningOrThinkingTokens",
  ] as const),
  unsupportedFields: Object.freeze(["cacheWriteInputTokens"] as const),
});

type ProviderEventKind = "ready" | "request" | "completion" | "seal";

export interface ProviderEvidenceIssue {
  readonly code: string;
  readonly message: string;
  readonly runIds?: readonly string[];
  readonly sequence?: number;
}

export interface NormalizedProviderUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export interface CollectedProviderRequest {
  readonly correlationId: string;
  readonly requestSequence: number;
  readonly requestWallTimeUnixMicros: string;
  readonly completionSequence: number | null;
  readonly completionWallTimeUnixMicros: string | null;
  readonly latencyMs: number | null;
  readonly path: string;
  readonly method: string;
  readonly rawBodySha256: string;
  readonly providerToolDefinitionCount: number;
  readonly status: number | null;
  readonly upstreamRequestId: string | null;
  readonly responseBodySha256: string | null;
  readonly usage: NormalizedProviderUsage | null;
  readonly providerUsageNormalization: ProviderUsageNormalizationResult | null;
  readonly injectionAudit: CapturedRealChainAudit | null;
  readonly providerVisibleInjection: string | null;
  readonly productionSourceEvidence: ProviderPromptSourceEvidence | null;
}

export interface CollectedProviderRun {
  readonly runId: string;
  readonly caseId: string;
  readonly variantId: string;
  readonly sessionId: string;
  readonly requests: readonly CollectedProviderRequest[];
  readonly injection: Readonly<{
    encoding: "o200k_base";
    tokens: number;
    characters: number;
    utf8Bytes: number;
    sha256: string;
    toolFamilies: readonly ("memory" | "skill" | "knowledge")[];
  }> | null;
  readonly providerUsage: Readonly<NormalizedProviderUsage & {
    requestCount: number;
  }> | null;
  readonly formalProviderEvidenceEligible: boolean;
  readonly issues: readonly ProviderEvidenceIssue[];
}

export interface CollectedProviderCampaign {
  readonly schemaVersion: "task1.provider-evidence-collection.v1";
  readonly campaignId: string;
  readonly proxyProcessInstanceId: string;
  readonly formalCampaignEligible: boolean;
  readonly runs: readonly CollectedProviderRun[];
  readonly issues: readonly ProviderEvidenceIssue[];
  readonly unassignedSequences: readonly number[];
}

export interface CollectProviderEvidenceInput {
  readonly campaignId: string;
  readonly expectedProxyInstanceId: string;
  readonly runs: readonly ObservedRunWindow[];
  readonly expectedPromptsByRunId: ReadonlyMap<string, Readonly<{
    readonly userPrompt: string;
    readonly userPromptSha256: string;
  }>>;
  readonly providerJsonl: string;
}

interface ProviderRequestEvent {
  readonly correlationId: string;
  readonly method: string;
  readonly path: string;
  readonly rawBodySha256: string;
  readonly body: Record<string, unknown>;
  readonly correlationHeaders: Record<string, string>;
  readonly productionSourceEvidence?: ProviderPromptSourceEvidence;
}

interface ProviderCompletionEvent {
  readonly correlationId: string;
  readonly status: number | null;
  readonly responseHeaders: Record<string, string>;
  readonly responseBodySha256?: string;
  readonly failureMessageSha256?: string;
  readonly usage?: Record<string, unknown>;
}

interface ProviderEnvelope {
  readonly processInstanceId: string;
  readonly sequence: number;
  readonly kind: ProviderEventKind;
  readonly wallTimeUnixMicros: string;
  readonly wallTime: bigint;
  readonly event?: ProviderRequestEvent | ProviderCompletionEvent;
  readonly sealLastDataSequence?: number;
}

interface PendingRequest {
  readonly envelope: ProviderEnvelope;
  readonly event: ProviderRequestEvent;
  readonly audit: CapturedRealChainAudit | null;
  readonly providerVisibleInjection: string | null;
  readonly productionSourceEvidence: ProviderPromptSourceEvidence | null;
  completion?: ProviderEnvelope;
}

interface ParsedRun {
  readonly source: ObservedRunWindow;
  readonly startedAt: bigint;
  readonly finishedAt: bigint;
  readonly requests: PendingRequest[];
  readonly issues: ProviderEvidenceIssue[];
}

/** Join the sealed provider-bound prompt/usage stream to public run windows. */
export function collectProviderEvidence(
  input: CollectProviderEvidenceInput,
): CollectedProviderCampaign {
  const campaignId = nonBlank("campaignId", input.campaignId);
  const expectedInstanceId = nonBlank(
    "expectedProxyInstanceId",
    input.expectedProxyInstanceId,
  );
  const envelopes = parseJsonl(input.providerJsonl, campaignId);
  const processInstanceId = envelopes[0].processInstanceId;
  if (processInstanceId !== expectedInstanceId) {
    throw new Error(
      `MemoryProxy provider instance mismatch: expected ${expectedInstanceId}, got ${processInstanceId}`,
    );
  }
  const runs = input.runs.map(parseRun);
  ensureUniqueRuns(runs);
  const expectedPrompts = validateExpectedPrompts(runs, input.expectedPromptsByRunId);
  const issues: ProviderEvidenceIssue[] = [];
  const unassignedSequences: number[] = [];
  recordLifecycleIssues(runs, envelopes, issues);
  recordClockIssues(runs, envelopes, issues);
  recordOverlapIssues(runs, issues);

  const runByCorrelationId = new Map<string, ParsedRun>();
  const requestByCorrelationId = new Map<string, PendingRequest>();
  for (const envelope of envelopes) {
    if (envelope.kind !== "request" && envelope.kind !== "completion") continue;
    if (envelope.kind === "request") {
      const event = envelope.event as ProviderRequestEvent;
      const active = runs.filter((run) => (
        run.startedAt <= envelope.wallTime && envelope.wallTime < run.finishedAt
      ));
      const exactSession = runs.filter((run) => (
        run.startedAt <= envelope.wallTime
        && envelope.wallTime <= run.finishedAt
        && event.correlationHeaders["session-id"] === run.source.sessionId
      ));
      const candidates = exactSession.length === 1 ? exactSession : active;
      if (candidates.length !== 1) {
        addGlobalIssue(issues, {
          code: candidates.length === 0
            ? "unassigned_provider_request"
            : "ambiguous_provider_request",
          message: candidates.length === 0
            ? "Provider request is outside every formal run window"
            : "Provider request belongs to multiple active formal runs",
          ...(candidates.length > 0
            ? { runIds: candidates.map((run) => run.source.runId) }
            : {}),
          sequence: envelope.sequence,
        }, candidates);
        unassignedSequences.push(envelope.sequence);
        continue;
      }
      const run = candidates[0];
      if (event.correlationHeaders["session-id"] !== run.source.sessionId) {
        addRunIssue(issues, run, {
          code: "provider_session_mismatch",
          message: "Provider request session-id does not match its formal run",
          runIds: [run.source.runId],
          sequence: envelope.sequence,
        });
      }
      if (requestByCorrelationId.has(event.correlationId)) {
        addRunIssue(issues, run, {
          code: "duplicate_provider_correlation_id",
          message: "Provider correlationId is not unique inside the campaign",
          runIds: [run.source.runId],
          sequence: envelope.sequence,
        });
        continue;
      }
      let audit: CapturedRealChainAudit | null = null;
      let providerVisibleInjection: string | null = null;
      let productionSourceEvidence: ProviderPromptSourceEvidence | null = null;
      if (isMainResponsesPath(event.path)) {
        try {
          const expectedPrompt = expectedPrompts.get(run.source.runId)!;
          audit = auditCapturedRealChainRequest(event.body, expectedPrompt.userPrompt);
          if (audit.userPromptSha256 !== expectedPrompt.userPromptSha256) {
            throw new Error("captured real-chain user-plane prompt hash does not match frozen input");
          }
          providerVisibleInjection = extractCapturedRealChainInjection(event.body);
          if (!event.productionSourceEvidence) {
            throw new Error("provider request is missing production PromptUnit/source evidence");
          }
          productionSourceEvidence = validateProviderPromptSourceEvidence(
            event.productionSourceEvidence,
            {
              correlationId: event.correlationId,
              rawBodySha256: event.rawBodySha256,
              providerVisibleText: providerVisibleInjection,
            },
          );
        } catch (error) {
          addRunIssue(issues, run, {
            code: "provider_prompt_audit_failed",
            message: error instanceof Error ? error.message : String(error),
            runIds: [run.source.runId],
            sequence: envelope.sequence,
          });
        }
      }
      const pending: PendingRequest = {
        envelope,
        event,
        audit,
        providerVisibleInjection,
        productionSourceEvidence,
      };
      run.requests.push(pending);
      requestByCorrelationId.set(event.correlationId, pending);
      runByCorrelationId.set(event.correlationId, run);
      continue;
    }

    const event = envelope.event as ProviderCompletionEvent;
    const request = requestByCorrelationId.get(event.correlationId);
    const run = runByCorrelationId.get(event.correlationId);
    if (!request || !run) {
      issues.push({
        code: "provider_completion_without_request",
        message: "Provider completion has no assigned request",
        sequence: envelope.sequence,
      });
      unassignedSequences.push(envelope.sequence);
      continue;
    }
    if (!(run.startedAt <= envelope.wallTime && envelope.wallTime <= run.finishedAt)) {
      addRunIssue(issues, run, {
        code: "provider_completion_outside_run",
        message: "Provider completion is outside its correlation-bound closed run window",
        runIds: [run.source.runId],
        sequence: envelope.sequence,
      });
      unassignedSequences.push(envelope.sequence);
      continue;
    }
    if (request.completion) {
      addRunIssue(issues, run, {
        code: "duplicate_provider_completion",
        message: "Provider request has multiple completion events",
        runIds: [run.source.runId],
        sequence: envelope.sequence,
      });
      continue;
    }
    request.completion = envelope;
  }

  const collectedRuns = runs.map((run) => finalizeRun(run, issues));
  return deepFreeze({
    schemaVersion: "task1.provider-evidence-collection.v1" as const,
    campaignId,
    proxyProcessInstanceId: processInstanceId,
    formalCampaignEligible: issues.length === 0 && unassignedSequences.length === 0,
    runs: collectedRuns,
    issues,
    unassignedSequences,
  });
}

function validateExpectedPrompts(
  runs: readonly ParsedRun[],
  expected: CollectProviderEvidenceInput["expectedPromptsByRunId"],
): ReadonlyMap<string, Readonly<{ userPrompt: string; userPromptSha256: string }>> {
  if (!(expected instanceof Map) || expected.size !== runs.length) {
    throw new Error("provider expected prompt set must contain exactly one entry per formal run");
  }
  const runIds = new Set(runs.map((run) => run.source.runId));
  for (const runId of expected.keys()) {
    if (!runIds.has(runId)) throw new Error(`provider expected prompt contains unknown run: ${runId}`);
  }
  for (const run of runs) {
    const item = expected.get(run.source.runId);
    if (!item) throw new Error(`provider expected prompt is missing run: ${run.source.runId}`);
    const userPrompt = nonBlank("expected provider user prompt", item.userPrompt);
    const userPromptSha256 = sha256(
      "expected provider user prompt SHA-256",
      item.userPromptSha256,
    );
    if (createHash("sha256").update(userPrompt, "utf8").digest("hex") !== userPromptSha256) {
      throw new Error(`provider expected prompt hash mismatch for run: ${run.source.runId}`);
    }
  }
  return expected;
}

function finalizeRun(
  run: ParsedRun,
  campaignIssues: ProviderEvidenceIssue[],
): CollectedProviderRun {
  const mainRequests = run.requests.filter((request) => isMainResponsesPath(request.event.path));
  if (mainRequests.length === 0) {
    addRunIssue(campaignIssues, run, {
      code: "provider_request_missing",
      message: "Formal run contains no main Responses provider request",
      runIds: [run.source.runId],
    });
  }
  for (const request of mainRequests) {
    if (!request.completion) {
      addRunIssue(campaignIssues, run, {
        code: "provider_request_missing_completion",
        message: "Provider request has no in-window completion",
        runIds: [run.source.runId],
        sequence: request.envelope.sequence,
      });
      continue;
    }
    const completion = request.completion.event as ProviderCompletionEvent;
    if (completion.status === null || completion.status < 200 || completion.status >= 300) {
      addRunIssue(campaignIssues, run, {
        code: "provider_request_not_successful",
        message: "Provider request did not complete with a 2xx status",
        runIds: [run.source.runId],
        sequence: request.completion.sequence,
      });
    }
    if (!normalizeUsage(completion.usage)
      || normalizeFormalProviderUsage(completion.usage)?.ok !== true) {
      addRunIssue(campaignIssues, run, {
        code: "provider_usage_missing_or_invalid",
        message: "Provider completion does not contain complete usage evidence",
        runIds: [run.source.runId],
        sequence: request.completion.sequence,
      });
    }
  }

  const audits = mainRequests.flatMap((request) => request.audit ? [request.audit] : []);
  const injection = audits.length === 0 ? null : {
    encoding: audits[0].injectionTokenEncoding,
    tokens: audits[0].injectionTokenCount,
    characters: audits[0].injectionCharacterCount,
    utf8Bytes: audits[0].injectionUtf8ByteCount,
    sha256: audits[0].injectionSha256,
    toolFamilies: audits[0].toolFamilies,
  } as const;
  if (audits.some((audit) => audit.injectionSha256 !== audits[0].injectionSha256)) {
    addRunIssue(campaignIssues, run, {
      code: "injection_changed_within_run",
      message: "Production injection changed between provider requests in one run",
      runIds: [run.source.runId],
    });
  }

  const requestFacts = mainRequests.map((request): CollectedProviderRequest => {
    const completion = request.completion?.event as ProviderCompletionEvent | undefined;
    const completionEnvelope = request.completion;
    return {
      correlationId: request.event.correlationId,
      requestSequence: request.envelope.sequence,
      requestWallTimeUnixMicros: request.envelope.wallTimeUnixMicros,
      completionSequence: completionEnvelope?.sequence ?? null,
      completionWallTimeUnixMicros: completionEnvelope?.wallTimeUnixMicros ?? null,
      latencyMs: completionEnvelope
        ? Math.ceil(Number(completionEnvelope.wallTime - request.envelope.wallTime) / 1_000)
        : null,
      path: request.event.path,
      method: request.event.method,
      rawBodySha256: request.event.rawBodySha256,
      providerToolDefinitionCount: Array.isArray(request.event.body.tools)
        ? request.event.body.tools.length
        : 0,
      status: completion?.status ?? null,
      upstreamRequestId: completion?.responseHeaders["x-request-id"] ?? null,
      responseBodySha256: completion?.responseBodySha256 ?? null,
      usage: normalizeUsage(completion?.usage),
      providerUsageNormalization: normalizeFormalProviderUsage(completion?.usage),
      injectionAudit: request.audit,
      providerVisibleInjection: request.providerVisibleInjection,
      productionSourceEvidence: request.productionSourceEvidence,
    };
  });
  const usages = requestFacts.flatMap((request) => request.usage ? [request.usage] : []);
  const providerUsage = usages.length !== requestFacts.length || requestFacts.length === 0
    ? null
    : {
      requestCount: requestFacts.length,
      inputTokens: sum(usages, "inputTokens"),
      cachedInputTokens: sum(usages, "cachedInputTokens"),
      outputTokens: sum(usages, "outputTokens"),
      reasoningOutputTokens: sum(usages, "reasoningOutputTokens"),
      totalTokens: sum(usages, "totalTokens"),
    };

  return {
    runId: run.source.runId,
    caseId: run.source.caseId,
    variantId: run.source.variantId,
    sessionId: run.source.sessionId,
    requests: requestFacts,
    injection,
    providerUsage,
    formalProviderEvidenceEligible: run.issues.length === 0,
    issues: run.issues,
  };
}

function normalizeFormalProviderUsage(
  value: unknown,
): ProviderUsageNormalizationResult | null {
  if (value === undefined) return null;
  return normalizeProviderUsage({
    ...FORMAL_PROVIDER_USAGE_CONTRACT,
    rawUsage: value,
  });
}

function normalizeUsage(value: unknown): NormalizedProviderUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const inputDetails = optionalRecord(usage.input_tokens_details);
  const outputDetails = optionalRecord(usage.output_tokens_details);
  const inputTokens = nonNegativeNumber(usage.input_tokens);
  const cachedInputTokens = nonNegativeNumber(inputDetails?.cached_tokens);
  const outputTokens = nonNegativeNumber(usage.output_tokens);
  const reasoningOutputTokens = nonNegativeNumber(outputDetails?.reasoning_tokens);
  const totalTokens = nonNegativeNumber(usage.total_tokens);
  if (
    inputTokens === null
    || cachedInputTokens === null
    || outputTokens === null
    || reasoningOutputTokens === null
    || totalTokens === null
  ) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function parseJsonl(jsonl: string, campaignId: string): ProviderEnvelope[] {
  const lines = jsonl.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length === 0) throw new Error("provider observer file is empty");
  const parsed = lines.map((line, index) => parseEnvelope(
    jsonObject(line, `provider line ${index + 1}`),
    campaignId,
    index,
  ));
  if (parsed[0].kind !== "ready") throw new Error("provider observer file must begin with ready");
  if (parsed.at(-1)?.kind !== "seal") throw new Error("provider observer file must end with seal");
  const instance = parsed[0].processInstanceId;
  for (const [index, envelope] of parsed.entries()) {
    if (envelope.sequence !== index) throw new Error("provider observer sequence must be contiguous");
    if (envelope.processInstanceId !== instance) throw new Error("provider observer instance changed");
    if (index > 0 && envelope.kind === "ready") throw new Error("provider observer contains duplicate ready");
    if (envelope.kind === "seal") {
      if (index !== parsed.length - 1) throw new Error("provider observer seal must be final");
      if (envelope.sealLastDataSequence !== index - 1) {
        throw new Error("provider observer seal does not close final data sequence");
      }
    }
  }
  return parsed;
}

function parseEnvelope(
  value: Record<string, unknown>,
  campaignId: string,
  expectedSequence: number,
): ProviderEnvelope {
  if (value.schemaVersion !== EVENT_SCHEMA) throw new Error("provider schemaVersion mismatch");
  if (value.campaignId !== campaignId) throw new Error("provider campaignId mismatch");
  if (value.source !== SOURCE) throw new Error("provider source mismatch");
  const sequence = integer("provider sequence", value.sequence);
  if (sequence !== expectedSequence) throw new Error("provider sequence/order mismatch");
  const kind = providerKind(value.kind);
  const wallTimeUnixMicros = digits("provider wallTimeUnixMicros", value.wallTimeUnixMicros);
  const common = {
    processInstanceId: nonBlank("provider processInstanceId", value.processInstanceId),
    sequence,
    kind,
    wallTimeUnixMicros,
    wallTime: BigInt(wallTimeUnixMicros),
  };
  if (kind === "ready") return common;
  if (kind === "seal") {
    const event = record("provider seal event", value.event);
    return { ...common, sealLastDataSequence: integer("lastDataSequence", event.lastDataSequence) };
  }
  return {
    ...common,
    event: kind === "request"
      ? parseRequest(value.event)
      : parseCompletion(value.event),
  };
}

function parseRequest(value: unknown): ProviderRequestEvent {
  const event = record("provider request event", value);
  let productionSourceEvidence: ProviderPromptSourceEvidence | undefined;
  if (event.productionSourceEvidence !== undefined) {
    productionSourceEvidence = record(
      "provider production source evidence",
      event.productionSourceEvidence,
    ) as unknown as ProviderPromptSourceEvidence;
  }
  return {
    correlationId: nonBlank("provider correlationId", event.correlationId),
    method: nonBlank("provider method", event.method),
    path: nonBlank("provider path", event.path),
    rawBodySha256: sha256("provider rawBodySha256", event.rawBodySha256),
    body: record("provider body", event.body),
    correlationHeaders: stringRecord("provider correlationHeaders", event.correlationHeaders),
    ...(productionSourceEvidence ? { productionSourceEvidence } : {}),
  };
}

function parseCompletion(value: unknown): ProviderCompletionEvent {
  const event = record("provider completion event", value);
  const status = event.status;
  if (status !== null && (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599)) {
    throw new Error("provider completion status is invalid");
  }
  const responseBodySha256 = event.responseBodySha256 === undefined
    ? undefined
    : sha256("provider responseBodySha256", event.responseBodySha256);
  const failureMessageSha256 = event.failureMessageSha256 === undefined
    ? undefined
    : sha256("provider failureMessageSha256", event.failureMessageSha256);
  if (status === null && !failureMessageSha256) {
    throw new Error("provider null-status completion must contain failure hash");
  }
  return {
    correlationId: nonBlank("provider correlationId", event.correlationId),
    status: status as number | null,
    responseHeaders: stringRecord("provider responseHeaders", event.responseHeaders),
    ...(responseBodySha256 ? { responseBodySha256 } : {}),
    ...(failureMessageSha256 ? { failureMessageSha256 } : {}),
    ...(event.usage === undefined ? {} : { usage: record("provider usage", event.usage) }),
  };
}

function parseRun(source: ObservedRunWindow): ParsedRun {
  const started = BigInt(digits("run startedAtUnixMicros", source.startedAtUnixMicros));
  const finished = BigInt(digits("run finishedAtUnixMicros", source.finishedAtUnixMicros));
  nonBlank("runId", source.runId);
  nonBlank("caseId", source.caseId);
  nonBlank("variantId", source.variantId);
  nonBlank("sessionId", source.sessionId);
  if (finished <= started) throw new Error(`${source.runId} must have a non-empty window`);
  return { source, startedAt: started, finishedAt: finished, requests: [], issues: [] };
}

function ensureUniqueRuns(runs: readonly ParsedRun[]): void {
  const ids = new Set<string>();
  for (const run of runs) {
    if (ids.has(run.source.runId)) throw new Error(`duplicate runId: ${run.source.runId}`);
    ids.add(run.source.runId);
  }
}

function recordLifecycleIssues(
  runs: readonly ParsedRun[],
  envelopes: readonly ProviderEnvelope[],
  issues: ProviderEvidenceIssue[],
): void {
  const readyAt = envelopes[0].wallTime;
  const sealAt = envelopes.at(-1)!.wallTime;
  for (const run of runs) {
    if (readyAt <= run.startedAt && sealAt >= run.finishedAt) continue;
    addRunIssue(issues, run, {
      code: "provider_lifecycle_does_not_cover_run",
      message: "Provider observer ready/seal interval does not cover the run",
      runIds: [run.source.runId],
    });
  }
}

function recordClockIssues(
  runs: readonly ParsedRun[],
  envelopes: readonly ProviderEnvelope[],
  issues: ProviderEvidenceIssue[],
): void {
  if (!envelopes.some((event, index) => index > 0 && event.wallTime < envelopes[index - 1].wallTime)) return;
  for (const run of runs) addRunIssue(issues, run, {
    code: "provider_wall_time_regression",
    message: "Provider observer wall clock regressed",
    runIds: [run.source.runId],
  });
}

function recordOverlapIssues(
  runs: readonly ParsedRun[],
  issues: ProviderEvidenceIssue[],
): void {
  for (let left = 0; left < runs.length; left += 1) {
    for (let right = left + 1; right < runs.length; right += 1) {
      const a = runs[left];
      const b = runs[right];
      if (!(a.startedAt < b.finishedAt && b.startedAt < a.finishedAt)) continue;
      const issue = {
        code: "overlapping_run_windows",
        message: "Formal run windows overlap inside one provider observer stream",
        runIds: [a.source.runId, b.source.runId],
      };
      addGlobalIssue(issues, issue, [a, b]);
    }
  }
}

function addRunIssue(
  campaignIssues: ProviderEvidenceIssue[],
  run: ParsedRun,
  issue: ProviderEvidenceIssue,
): void {
  campaignIssues.push(issue);
  run.issues.push(issue);
}

function addGlobalIssue(
  campaignIssues: ProviderEvidenceIssue[],
  issue: ProviderEvidenceIssue,
  runs: readonly ParsedRun[],
): void {
  campaignIssues.push(issue);
  for (const run of runs) run.issues.push(issue);
}

function isMainResponsesPath(path: string): boolean {
  return /\/responses$/u.test(path);
}

function sum(
  usages: readonly NormalizedProviderUsage[],
  field: keyof NormalizedProviderUsage,
): number {
  return usages.reduce((total, usage) => total + usage[field], 0);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function providerKind(value: unknown): ProviderEventKind {
  if (value === "ready" || value === "request" || value === "completion" || value === "seal") return value;
  throw new Error("provider kind is invalid");
}

function jsonObject(value: string, label: string): Record<string, unknown> {
  try {
    return record(label, JSON.parse(value) as unknown);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function record(label: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringRecord(label: string, value: unknown): Record<string, string> {
  const source = record(label, value);
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(source)) {
    if (typeof child !== "string") throw new Error(`${label}.${key} must be a string`);
    result[key.toLowerCase()] = child;
  }
  return result;
}

function nonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-blank`);
  return value;
}

function digits(label: string, value: unknown): string {
  const text = nonBlank(label, value);
  if (!/^\d+$/u.test(text)) throw new Error(`${label} must contain decimal digits`);
  return text;
}

function sha256(label: string, value: unknown): string {
  const text = nonBlank(label, value);
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new Error(`${label} must be lowercase SHA-256`);
  return text;
}

function integer(label: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
