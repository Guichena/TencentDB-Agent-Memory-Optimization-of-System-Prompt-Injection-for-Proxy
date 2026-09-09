import type {
  ObservedToolCompletion,
  ObservedToolEntry,
  PersistedObservedToolCompletion,
} from "./observed-bridge-trace-projector.js";

const EVENT_SCHEMA = "task1.tool-observer-event.v1";
const COMPLETION_SCHEMA = "task1.tool-execution-completion.v1";
const SOURCES = ["memory-proxy", "memory-knowledge"] as const;

type ObserverSource = typeof SOURCES[number];
type ObserverKind = "ready" | "begin" | "completion" | "seal";

export interface ObservedRunWindow {
  readonly runId: string;
  readonly caseId: string;
  readonly variantId: string;
  readonly sessionId: string;
  readonly startedAtUnixMicros: string;
  readonly finishedAtUnixMicros: string;
}

export interface CollectObservedToolEventsInput {
  readonly campaignId: string;
  readonly expectedProxyInstanceId: string;
  readonly expectedKnowledgeInstanceId: string;
  readonly runs: readonly ObservedRunWindow[];
  readonly memoryProxyJsonl: string;
  readonly memoryKnowledgeJsonl: string;
}

export interface ObservedEventCollectorIssue {
  readonly code: string;
  readonly message: string;
  readonly runIds?: readonly string[];
  readonly source?: ObserverSource;
  readonly sequence?: number;
}

export interface UnassignedObservedEvent {
  readonly source: ObserverSource;
  readonly sequence: number;
  readonly kind: "begin" | "completion";
  readonly correlationId: string;
  readonly wallTimeUnixMicros: string;
}

export interface CollectedObservedRun {
  readonly runId: string;
  readonly caseId: string;
  readonly variantId: string;
  readonly sessionId: string;
  readonly entries: readonly ObservedToolEntry[];
  readonly completions: readonly ObservedToolCompletion[];
  readonly entryEvidence: readonly TimedObservedEvent<ObservedToolEntry>[];
  readonly completionEvidence: readonly TimedObservedEvent<ObservedToolCompletion>[];
  readonly formalTraceEligible: boolean;
  readonly issues: readonly ObservedEventCollectorIssue[];
}

export interface TimedObservedEvent<T> {
  readonly source: ObserverSource;
  readonly sequence: number;
  readonly wallTimeUnixMicros: string;
  readonly event: T;
}

export interface CollectedObservedCampaign {
  readonly schemaVersion: "task1.observed-event-collection.v1";
  readonly campaignId: string;
  readonly proxyProcessInstanceId: string;
  readonly knowledgeProcessInstanceId: string;
  readonly formalCampaignEligible: boolean;
  readonly runs: readonly CollectedObservedRun[];
  readonly issues: readonly ObservedEventCollectorIssue[];
  readonly unassignedEvents: readonly UnassignedObservedEvent[];
}

interface ParsedEnvelope {
  readonly source: ObserverSource;
  readonly processInstanceId: string;
  readonly sequence: number;
  readonly kind: ObserverKind;
  readonly wallTimeUnixMicros: string;
  readonly wallTime: bigint;
  readonly sealLastDataSequence?: number;
  readonly event?: ObservedToolEntry | PersistedObservedToolCompletion;
}

interface ParsedRun {
  readonly source: ObservedRunWindow;
  readonly startedAt: bigint;
  readonly finishedAt: bigint;
  readonly entries: ObservedToolEntry[];
  readonly completions: ObservedToolCompletion[];
  readonly entryEvidence: TimedObservedEvent<ObservedToolEntry>[];
  readonly completionEvidence: TimedObservedEvent<ObservedToolCompletion>[];
  readonly issues: ObservedEventCollectorIssue[];
}

/**
 * Gold-blind join from the two production observer files to formal run
 * windows. Session headers improve correlation but never erase an attempt that
 * occurred inside one unique active run.
 */
export function collectObservedToolEvents(
  input: CollectObservedToolEventsInput,
): CollectedObservedCampaign {
  const campaignId = requireNonBlank(input.campaignId, "campaignId");
  const expectedProxyInstanceId = requireNonBlank(
    input.expectedProxyInstanceId,
    "expectedProxyInstanceId",
  );
  const expectedKnowledgeInstanceId = requireNonBlank(
    input.expectedKnowledgeInstanceId,
    "expectedKnowledgeInstanceId",
  );
  const proxyEvents = parseSourceJsonl(
    input.memoryProxyJsonl,
    "memory-proxy",
    campaignId,
  );
  const knowledgeEvents = parseSourceJsonl(
    input.memoryKnowledgeJsonl,
    "memory-knowledge",
    campaignId,
  );
  const proxyProcessInstanceId = proxyEvents[0].processInstanceId;
  const knowledgeProcessInstanceId = knowledgeEvents[0].processInstanceId;
  if (proxyProcessInstanceId !== expectedProxyInstanceId) {
    throw new Error(
      `MemoryProxy ready instance mismatch: expected ${expectedProxyInstanceId}, got ${proxyProcessInstanceId}`,
    );
  }
  if (knowledgeProcessInstanceId !== expectedKnowledgeInstanceId) {
    throw new Error(
      `MemoryKnowledge ready instance mismatch: expected ${expectedKnowledgeInstanceId}, got ${knowledgeProcessInstanceId}`,
    );
  }

  const runs = input.runs.map(parseRunWindow);
  ensureUniqueRunIdentity(runs);
  const issues: ObservedEventCollectorIssue[] = overlappingWindowIssues(runs);
  recordLifecycleCoverageIssues(runs, proxyEvents, "memory-proxy", issues);
  recordLifecycleCoverageIssues(runs, knowledgeEvents, "memory-knowledge", issues);
  recordSourceClockIssues(runs, proxyEvents, "memory-proxy", issues);
  recordSourceClockIssues(runs, knowledgeEvents, "memory-knowledge", issues);
  const unassignedEvents: UnassignedObservedEvent[] = [];
  const eventRunByCorrelationId = new Map<string, Set<ParsedRun>>();
  const assignedRunByEnvelope = new Map<ParsedEnvelope, ParsedRun>();
  const events = mergeSourceEvents(proxyEvents.slice(1), knowledgeEvents.slice(1));

  for (const envelope of events) {
    if (envelope.kind === "ready" || envelope.kind === "seal" || envelope.event === undefined) {
      continue;
    }
    const correlationId = envelope.event.correlationId;
    let candidates: ParsedRun[];
    if (envelope.kind === "completion") {
      const beginRuns = [...(eventRunByCorrelationId.get(correlationId) ?? [])]
        .filter((run) => run.startedAt <= envelope.wallTime && envelope.wallTime <= run.finishedAt);
      candidates = beginRuns.length > 0
        ? beginRuns
        : eventRunByCorrelationId.has(correlationId)
          ? []
          : activeRunsAt(runs, envelope.wallTime);
    } else {
      const active = activeRunsAt(runs, envelope.wallTime);
      const exactSession = closedRunsAt(runs, envelope.wallTime).filter((run) => entryMatchesSession(
        envelope.event as ObservedToolEntry,
        run.source.sessionId,
      ));
      candidates = exactSession.length === 1 ? exactSession : active;
    }

    if (candidates.length !== 1) {
      const code = candidates.length === 0 ? "unassigned_event_run" : "ambiguous_event_run";
      issues.push({
        code,
        message: candidates.length === 0
          ? "Observer event is outside every formal run window"
          : "Observer event falls inside multiple formal run windows",
        ...(candidates.length > 0
          ? { runIds: candidates.map((run) => run.source.runId) }
          : {}),
        source: envelope.source,
        sequence: envelope.sequence,
      });
      const eventIssue = issues[issues.length - 1];
      for (const candidate of candidates) candidate.issues.push(eventIssue);
      unassignedEvents.push({
        source: envelope.source,
        sequence: envelope.sequence,
        kind: envelope.kind,
        correlationId,
        wallTimeUnixMicros: envelope.wallTimeUnixMicros,
      });
      continue;
    }

    const run = candidates[0];
    assignedRunByEnvelope.set(envelope, run);
    if (envelope.kind === "begin") {
      const entry = envelope.event as ObservedToolEntry;
      run.entries.push(entry);
      run.entryEvidence.push({
        source: envelope.source,
        sequence: envelope.sequence,
        wallTimeUnixMicros: envelope.wallTimeUnixMicros,
        event: entry,
      });
      const associated = eventRunByCorrelationId.get(correlationId) ?? new Set<ParsedRun>();
      associated.add(run);
      eventRunByCorrelationId.set(correlationId, associated);
    } else {
      const completion = envelope.event as PersistedObservedToolCompletion;
      run.completions.push(completion);
      run.completionEvidence.push({
        source: envelope.source,
        sequence: envelope.sequence,
        wallTimeUnixMicros: envelope.wallTimeUnixMicros,
        event: completion,
      });
    }
  }
  recordCrossSourceTimestampTies(events, assignedRunByEnvelope, issues);

  return deepFreeze({
    schemaVersion: "task1.observed-event-collection.v1" as const,
    campaignId,
    proxyProcessInstanceId,
    knowledgeProcessInstanceId,
    formalCampaignEligible: issues.length === 0 && unassignedEvents.length === 0,
    runs: runs.map((run) => ({
      runId: run.source.runId,
      caseId: run.source.caseId,
      variantId: run.source.variantId,
      sessionId: run.source.sessionId,
      entries: run.entries,
      completions: run.completions,
      entryEvidence: run.entryEvidence,
      completionEvidence: run.completionEvidence,
      formalTraceEligible: run.issues.length === 0,
      issues: run.issues,
    })),
    issues,
    unassignedEvents,
  });
}

function parseSourceJsonl(
  jsonl: string,
  expectedSource: ObserverSource,
  expectedCampaignId: string,
): ParsedEnvelope[] {
  const lines = jsonl.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length === 0) throw new Error(`${expectedSource} observer file is empty`);
  const parsed = lines.map((line, index) => parseEnvelope(
    parseJsonObject(line, `${expectedSource} line ${index + 1}`),
    expectedSource,
    expectedCampaignId,
    index,
  ));
  if (parsed[0].kind !== "ready") {
    throw new Error(`${expectedSource} observer file must begin with ready`);
  }
  if (parsed.at(-1)?.kind !== "seal") {
    throw new Error(`${expectedSource} observer file must end with seal`);
  }
  const processInstanceId = parsed[0].processInstanceId;
  for (const [index, envelope] of parsed.entries()) {
    if (envelope.sequence !== index) {
      throw new Error(`${expectedSource} observer sequence must be contiguous from zero`);
    }
    if (envelope.processInstanceId !== processInstanceId) {
      throw new Error(`${expectedSource} observer process instance changed inside one file`);
    }
    if (index > 0 && envelope.kind === "ready") {
      throw new Error(`${expectedSource} observer file contains duplicate ready`);
    }
    if (envelope.kind === "seal") {
      if (index !== parsed.length - 1) {
        throw new Error(`${expectedSource} observer seal must be the final line`);
      }
      if (envelope.sealLastDataSequence !== index - 1) {
        throw new Error(`${expectedSource} observer seal does not close the final data sequence`);
      }
    }
  }
  return parsed;
}

function parseEnvelope(
  value: Record<string, unknown>,
  expectedSource: ObserverSource,
  expectedCampaignId: string,
  expectedSequence: number,
): ParsedEnvelope {
  if (value.schemaVersion !== EVENT_SCHEMA) throw new Error("observer schemaVersion mismatch");
  if (value.campaignId !== expectedCampaignId) throw new Error("observer campaignId mismatch");
  if (value.source !== expectedSource) throw new Error("observer source/file mismatch");
  const processInstanceId = requireNonBlank(value.processInstanceId, "processInstanceId");
  const sequence = requireNonNegativeInteger(value.sequence, "sequence");
  if (sequence !== expectedSequence) throw new Error("observer sequence/order mismatch");
  const kind = parseKind(value.kind);
  const observedAt = requireNonBlank(value.observedAt, "observedAt");
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("observedAt must be ISO date-time");
  const wallTimeUnixMicros = requireDigits(value.wallTimeUnixMicros, "wallTimeUnixMicros");
  const envelope: ParsedEnvelope = {
    source: expectedSource,
    processInstanceId,
    sequence,
    kind,
    wallTimeUnixMicros,
    wallTime: BigInt(wallTimeUnixMicros),
    ...(kind === "ready"
      ? {}
      : kind === "seal"
        ? { sealLastDataSequence: parseSeal(value.event) }
      : {
        event: kind === "begin"
          ? parseEntry(value.event, expectedSource)
          : parseCompletion(value.event, expectedSource),
      }),
  };
  return envelope;
}

function parseEntry(value: unknown, source: ObserverSource): ObservedToolEntry {
  const record = asRecord(value, "begin.event");
  const family = parseFamily(record.family);
  requireSourceFamily(source, family);
  const requestBodyCapture = parseRequestBodyCapture(record.requestBodyCapture);
  return {
    correlationId: requireNonBlank(record.correlationId, "entry.correlationId"),
    family,
    endpoint: requireNonBlank(record.endpoint, "entry.endpoint"),
    method: requireNonBlank(record.method, "entry.method"),
    ...(record.requestBody === undefined ? {} : { requestBody: record.requestBody }),
    requestBodyCapture,
    correlationHeaders: parseStringRecord(record.correlationHeaders, "correlationHeaders"),
  } as ObservedToolEntry;
}

function parseCompletion(
  value: unknown,
  source: ObserverSource,
): PersistedObservedToolCompletion {
  const record = asRecord(value, "completion.event");
  if (record.schemaVersion !== COMPLETION_SCHEMA) {
    throw new Error("completion schemaVersion mismatch");
  }
  const outcome = record.outcome;
  if (outcome !== "response" && outcome !== "failure") {
    throw new Error("completion.outcome is invalid");
  }
  const status = record.status;
  if (
    status !== null
    && (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599)
  ) {
    throw new Error("completion.status is invalid");
  }
  const responseBodySha256 = record.responseBodySha256 === undefined
    ? undefined
    : requireSha256(record.responseBodySha256, "completion.responseBodySha256");
  const failure = record.failure === undefined
    ? undefined
    : parsePersistedFailure(record.failure);
  if (outcome === "response") {
    if (status === null) throw new Error("response completion status must be an HTTP status");
    if (failure !== undefined) throw new Error("response completion cannot contain failure");
    if (responseBodySha256 === undefined) {
      throw new Error("response completion must contain responseBodySha256");
    }
    if ((status as number) < 500 && !Object.hasOwn(record, "responseBody")) {
      throw new Error("non-5xx response completion must contain responseBody");
    }
  } else {
    if (failure === undefined) throw new Error("failure completion must contain failure");
    if (Object.hasOwn(record, "responseBody") || responseBodySha256 !== undefined) {
      throw new Error("failure completion cannot contain response body evidence");
    }
  }
  const family = parseFamily(record.family);
  requireSourceFamily(source, family);
  return {
    schemaVersion: COMPLETION_SCHEMA,
    correlationId: requireNonBlank(record.correlationId, "completion.correlationId"),
    family,
    endpoint: requireNonBlank(record.endpoint, "completion.endpoint"),
    method: requireNonBlank(record.method, "completion.method"),
    outcome,
    status: status as number | null,
    ...(record.responseBody === undefined ? {} : { responseBody: record.responseBody }),
    ...(responseBodySha256 === undefined ? {} : { responseBodySha256 }),
    durationMs: requireNonNegativeNumber(record.durationMs, "completion.durationMs"),
    ...(failure === undefined ? {} : { failure }),
  } as PersistedObservedToolCompletion;
}

function parseSeal(value: unknown): number {
  const record = asRecord(value, "seal.event");
  return requireNonNegativeInteger(record.lastDataSequence, "seal.lastDataSequence");
}

function parsePersistedFailure(value: unknown): Readonly<{
  name: string;
  messageSha256: string;
}> {
  const record = asRecord(value, "completion.failure");
  return {
    name: requireNonBlank(record.name, "completion.failure.name"),
    messageSha256: requireSha256(
      record.messageSha256,
      "completion.failure.messageSha256",
    ),
  };
}

function parseRequestBodyCapture(value: unknown): ObservedToolEntry["requestBodyCapture"] {
  const record = asRecord(value, "requestBodyCapture");
  if (record.outcome === "empty") return { outcome: "empty" };
  if (record.outcome === "captured") {
    return {
      outcome: "captured",
      rawBodySha256: requireSha256(record.rawBodySha256, "requestBodyCapture.rawBodySha256"),
    };
  }
  if (record.outcome === "failed") {
    const failure = asRecord(record.failure, "requestBodyCapture.failure");
    if (failure.stage !== "request_body_clone") throw new Error("request body failure stage mismatch");
    return {
      outcome: "failed",
      failure: {
        stage: "request_body_clone",
        name: requireNonBlank(failure.name, "requestBodyCapture.failure.name"),
      },
    };
  }
  throw new Error("requestBodyCapture.outcome is invalid");
}

function parseRunWindow(source: ObservedRunWindow): ParsedRun {
  const startedAtUnixMicros = requireDigits(
    source.startedAtUnixMicros,
    `${source.runId}.startedAtUnixMicros`,
  );
  const finishedAtUnixMicros = requireDigits(
    source.finishedAtUnixMicros,
    `${source.runId}.finishedAtUnixMicros`,
  );
  const startedAt = BigInt(startedAtUnixMicros);
  const finishedAt = BigInt(finishedAtUnixMicros);
  requireNonBlank(source.runId, "runId");
  requireNonBlank(source.caseId, "caseId");
  requireNonBlank(source.variantId, "variantId");
  requireNonBlank(source.sessionId, "sessionId");
  if (finishedAt <= startedAt) throw new Error(`${source.runId} must have a non-empty window`);
  return {
    source,
    startedAt,
    finishedAt,
    entries: [],
    completions: [],
    entryEvidence: [],
    completionEvidence: [],
    issues: [],
  };
}

function ensureUniqueRunIdentity(runs: readonly ParsedRun[]): void {
  const runIds = new Set<string>();
  for (const run of runs) {
    if (runIds.has(run.source.runId)) throw new Error(`duplicate runId: ${run.source.runId}`);
    runIds.add(run.source.runId);
  }
}

function overlappingWindowIssues(runs: readonly ParsedRun[]): ObservedEventCollectorIssue[] {
  const issues: ObservedEventCollectorIssue[] = [];
  for (let left = 0; left < runs.length; left += 1) {
    for (let right = left + 1; right < runs.length; right += 1) {
      const a = runs[left];
      const b = runs[right];
      if (a.startedAt < b.finishedAt && b.startedAt < a.finishedAt) {
        const issue = {
          code: "overlapping_run_windows",
          message: "Formal run windows overlap; time-window attribution may be ambiguous",
          runIds: [a.source.runId, b.source.runId],
        } as const;
        issues.push(issue);
        a.issues.push(issue);
        b.issues.push(issue);
      }
    }
  }
  return issues;
}

function activeRunsAt(runs: readonly ParsedRun[], time: bigint): ParsedRun[] {
  return runs.filter((run) => run.startedAt <= time && time < run.finishedAt);
}

function closedRunsAt(runs: readonly ParsedRun[], time: bigint): ParsedRun[] {
  return runs.filter((run) => run.startedAt <= time && time <= run.finishedAt);
}

function recordLifecycleCoverageIssues(
  runs: readonly ParsedRun[],
  events: readonly ParsedEnvelope[],
  source: ObserverSource,
  issues: ObservedEventCollectorIssue[],
): void {
  const readyAt = events[0].wallTime;
  const sealedAt = events[events.length - 1].wallTime;
  for (const run of runs) {
    if (readyAt <= run.startedAt && sealedAt >= run.finishedAt) continue;
    const issue: ObservedEventCollectorIssue = {
      code: "observer_lifecycle_does_not_cover_run",
      message: `${source} ready/seal interval does not cover the complete formal run window`,
      runIds: [run.source.runId],
      source,
    };
    issues.push(issue);
    run.issues.push(issue);
  }
}

function recordSourceClockIssues(
  runs: readonly ParsedRun[],
  events: readonly ParsedEnvelope[],
  source: ObserverSource,
  issues: ObservedEventCollectorIssue[],
): void {
  const regressed = events.some((event, index) => (
    index > 0 && event.wallTime < events[index - 1].wallTime
  ));
  if (!regressed) return;
  for (const run of runs) {
    const issue: ObservedEventCollectorIssue = {
      code: "source_wall_time_regression",
      message: `${source} wall clock regressed; cross-service ordering is not trustworthy`,
      runIds: [run.source.runId],
      source,
    };
    issues.push(issue);
    run.issues.push(issue);
  }
}

function entryMatchesSession(entry: ObservedToolEntry, sessionId: string): boolean {
  const observed = readHeader(entry.correlationHeaders, "x-conversation-id");
  if (observed === sessionId) return true;
  return entry.family === "knowledge"
    && readHeader(entry.correlationHeaders, "x-tdai-agent-source") === "codex"
    && observed === `codex:${sessionId}`;
}

function readHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name)?.[1];
}

function mergeSourceEvents(
  proxyEvents: readonly ParsedEnvelope[],
  knowledgeEvents: readonly ParsedEnvelope[],
): ParsedEnvelope[] {
  const merged: ParsedEnvelope[] = [];
  let proxyIndex = 0;
  let knowledgeIndex = 0;
  while (proxyIndex < proxyEvents.length || knowledgeIndex < knowledgeEvents.length) {
    const proxy = proxyEvents[proxyIndex];
    const knowledge = knowledgeEvents[knowledgeIndex];
    if (!proxy) {
      merged.push(knowledge);
      knowledgeIndex += 1;
    } else if (!knowledge) {
      merged.push(proxy);
      proxyIndex += 1;
    } else if (proxy.wallTime < knowledge.wallTime) {
      merged.push(proxy);
      proxyIndex += 1;
    } else if (knowledge.wallTime < proxy.wallTime) {
      merged.push(knowledge);
      knowledgeIndex += 1;
    } else if (proxy.source.localeCompare(knowledge.source) <= 0) {
      merged.push(proxy);
      proxyIndex += 1;
    } else {
      merged.push(knowledge);
      knowledgeIndex += 1;
    }
  }
  return merged;
}

function recordCrossSourceTimestampTies(
  events: readonly ParsedEnvelope[],
  assignedRunByEnvelope: ReadonlyMap<ParsedEnvelope, ParsedRun>,
  issues: ObservedEventCollectorIssue[],
): void {
  let start = 0;
  while (start < events.length) {
    let end = start + 1;
    while (end < events.length && events[end].wallTime === events[start].wallTime) end += 1;
    const runSources = new Map<ParsedRun, Set<ObserverSource>>();
    for (const event of events.slice(start, end)) {
      if (event.kind !== "begin") continue;
      const run = assignedRunByEnvelope.get(event);
      if (!run) continue;
      const sources = runSources.get(run) ?? new Set<ObserverSource>();
      sources.add(event.source);
      runSources.set(run, sources);
    }
    for (const [run, sources] of runSources) {
      if (sources.size < 2) continue;
      const issue: ObservedEventCollectorIssue = {
        code: "cross_source_timestamp_tie",
        message: "Cross-service begin order is ambiguous at one wall timestamp",
        runIds: [run.source.runId],
      };
      issues.push(issue);
      run.issues.push(issue);
    }
    start = end;
  }
}

function parseJsonObject(line: string, label: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(line) as unknown, label);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  const record = asRecord(value, label);
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(record)) {
    if (typeof child !== "string") throw new Error(`${label}.${key} must be a string`);
    result[key.toLowerCase()] = child;
  }
  return result;
}

function parseKind(value: unknown): ObserverKind {
  if (value === "ready" || value === "begin" || value === "completion" || value === "seal") {
    return value;
  }
  throw new Error("observer kind is invalid");
}

function requireSourceFamily(
  source: ObserverSource,
  family: "memory" | "skill" | "knowledge",
): void {
  const allowed = source === "memory-proxy"
    ? family === "memory" || family === "skill"
    : family === "knowledge";
  if (!allowed) throw new Error(`observer source ${source} cannot emit family ${family}`);
}

function parseFamily(value: unknown): "memory" | "skill" | "knowledge" {
  if (value === "memory" || value === "skill" || value === "knowledge") return value;
  throw new Error("observer family is invalid");
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-blank`);
  return value;
}

function requireDigits(value: unknown, label: string): string {
  const result = requireNonBlank(value, label);
  if (!/^\d+$/u.test(result)) throw new Error(`${label} must contain decimal digits`);
  return result;
}

function requireSha256(value: unknown, label: string): string {
  const result = requireNonBlank(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${label} must be lowercase SHA-256`);
  return result;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
