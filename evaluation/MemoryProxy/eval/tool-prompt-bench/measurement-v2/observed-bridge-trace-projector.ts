import { createHash } from "node:crypto";

import {
  BRIDGE_CORRELATION_HEADER_NAMES,
  type ObservedBridgeCompletion,
  type ObservedBridgeEntry,
} from "../../../../../implementations/final/MemoryProxy/src/bridge-entry-observer.js";
import type {
  ObservedKnowledgeToolsCompletion,
  ObservedKnowledgeToolsEntry,
} from "../../../../../implementations/final/MemoryKnowledge/src/tools-entry-observer.js";
import { RUNTIME_TOOL_CONTRACTS } from "../../../contracts/runtime-tool-contracts.js";

import type {
  JsonObjectV2,
  JsonValueV2,
  RawInfrastructureFailureV2,
  RawTdaiTraceAttemptV2,
  RawTraceObservationV2,
} from "./types.js";

export type ObservedToolEntry = ObservedBridgeEntry | ObservedKnowledgeToolsEntry;
type LiveObservedToolCompletion = ObservedBridgeCompletion | ObservedKnowledgeToolsCompletion;
type CompletionWithoutFailure<T> = T extends unknown ? Omit<T, "failure"> : never;

/** Completion shape read back from the secret-safe production JSONL sink. */
export type PersistedObservedToolCompletion = CompletionWithoutFailure<LiveObservedToolCompletion>
  & Readonly<{
    failure?: Readonly<{
      name: string;
      messageSha256: string;
    }>;
  }>;

export type ObservedToolCompletion = LiveObservedToolCompletion | PersistedObservedToolCompletion;

export type TurnCompletionFact =
  | Readonly<{ outcome: "completed" }>
  | Readonly<{ outcome: "provider_5xx"; status: number; errorName?: string }>
  | Readonly<{ outcome: "timeout"; stage: string; budgetMs: number }>
  | Readonly<{ outcome: "missing" }>;

export interface ProjectObservedBridgeTraceInput {
  readonly runId: string;
  readonly caseId: string;
  readonly variantId: string;
  readonly activeSessionId: string;
  readonly turnCompletion: TurnCompletionFact;
  readonly entries: readonly ObservedToolEntry[];
  readonly completions: readonly ObservedToolCompletion[];
}

export interface SafeObservedEntryEvidence {
  readonly correlationId: string;
  readonly family: "memory" | "skill" | "knowledge";
  readonly endpoint: string;
  readonly method: string;
  readonly requestBody?: JsonValueV2;
  readonly requestBodyCapture: ObservedToolEntry["requestBodyCapture"];
  readonly correlationHeaders: Readonly<Record<string, string>>;
}

export interface SafeObservedCompletionEvidence {
  readonly correlationId: string;
  readonly family: "memory" | "skill" | "knowledge";
  readonly endpoint: string;
  readonly method: string;
  readonly outcome: "response" | "failure";
  readonly status: number | null;
  readonly responseBody?: JsonValueV2;
  readonly responseBodySha256?: string;
  readonly durationMs: number;
  readonly failure?: Readonly<{
    readonly name: string;
    readonly category: "observer_failure";
    readonly messageSha256: string;
  }>;
}

export interface ObservedBridgeTraceEvidence {
  readonly schemaVersion: "task1.observed-bridge-trace-evidence.v1";
  readonly runId: string;
  readonly caseId: string;
  readonly variantId: string;
  readonly activeSessionId: string;
  readonly turnCompletion: TurnCompletionFact;
  readonly entries: readonly SafeObservedEntryEvidence[];
  readonly completions: readonly SafeObservedCompletionEvidence[];
  readonly issues: readonly RawInfrastructureFailureV2[];
}

export interface ProjectObservedBridgeTraceResult {
  readonly observation: RawTraceObservationV2;
  readonly rawEvidence: ObservedBridgeTraceEvidence;
}

/**
 * Gold-blind projection from production observer facts to the frozen M0 trace
 * interface. Private Gold and Pair contracts deliberately cannot enter here.
 */
export function projectObservedBridgeTrace(
  input: ProjectObservedBridgeTraceInput,
): ProjectObservedBridgeTraceResult {
  requireNonBlank(input.runId, "runId");
  requireNonBlank(input.caseId, "caseId");
  requireNonBlank(input.variantId, "variantId");
  requireNonBlank(input.activeSessionId, "activeSessionId");

  const issues: RawInfrastructureFailureV2[] = [];
  const observationFailures: RawInfrastructureFailureV2[] = [];
  const turnFailure = turnCompletionInfrastructureFailure(input.turnCompletion);
  if (turnFailure) {
    issues.push(turnFailure);
    observationFailures.push(turnFailure);
  }
  const entriesByCorrelationId = groupByCorrelationId(input.entries);
  const completionsByCorrelationId = groupByCorrelationId(input.completions);
  for (const [correlationId, entries] of entriesByCorrelationId) {
    if (entries.length <= 1) continue;
    const issue = traceIssue("duplicate_begin", `Duplicate begin facts for ${correlationId}`);
    issues.push(issue);
    observationFailures.push(issue);
  }
  for (const [correlationId] of completionsByCorrelationId) {
    if (entriesByCorrelationId.has(correlationId)) continue;
    const issue = traceIssue("orphan_completion", `Orphan completion fact for ${correlationId}`);
    issues.push(issue);
    observationFailures.push(issue);
  }

  const attempts: RawTdaiTraceAttemptV2[] = [];
  const visitedCorrelationIds = new Set<string>();
  for (const entry of input.entries) {
    if (visitedCorrelationIds.has(entry.correlationId)) continue;
    visitedCorrelationIds.add(entry.correlationId);
    if ((entriesByCorrelationId.get(entry.correlationId)?.length ?? 0) !== 1) continue;
    const sessionCorrelationMatched = belongsToActiveSession(entry, input.activeSessionId);

    const matchingCompletions = completionsByCorrelationId.get(entry.correlationId) ?? [];
    let completion: ObservedToolCompletion | undefined;
    let pairingFailure: RawInfrastructureFailureV2 | undefined;
    if (matchingCompletions.length === 0) {
      pairingFailure = traceIssue("missing_completion", `Missing completion for ${entry.correlationId}`);
    } else if (matchingCompletions.length > 1) {
      pairingFailure = traceIssue(
        "duplicate_completion",
        `Duplicate completion facts for ${entry.correlationId}`,
      );
    } else if (!completionMatchesEntry(entry, matchingCompletions[0])) {
      pairingFailure = {
        kind: "other",
        message: "Completion identity does not match its begin fact",
        code: "completion_identity_mismatch",
      };
    } else {
      completion = matchingCompletions[0];
    }

    const contract = resolveObservedContract(entry);
    const requestBody = entry.requestBodyCapture.outcome === "captured"
      ? asJsonObject(entry.requestBody)
      : undefined;
    const responseBody = completion ? asJsonValue(completion.responseBody) : undefined;
    const entryFailure = entryInfrastructureFailure(entry);
    const completionFailure = completion ? completionInfrastructureFailure(completion) : undefined;
    if (pairingFailure) issues.push(pairingFailure);
    if (entryFailure) issues.push(entryFailure);
    if (completionFailure) issues.push(completionFailure);
    const infrastructureFailure = pairingFailure ?? entryFailure ?? completionFailure;
    attempts.push({
      attemptId: entry.correlationId,
      executorBound: true,
      family: entry.family,
      ...(contract ? { tool: contract.id } : {}),
      endpoint: contract?.canonicalEndpoint ?? entry.endpoint,
      method: entry.method,
      ...(requestBody ? { arguments: requestBody } : {}),
      ...(!sessionCorrelationMatched
        ? { malformedReason: "session_correlation_header_mismatch" }
        : {}),
      ...(infrastructureFailure
        ? { infrastructureFailure }
        : sessionCorrelationMatched
          ? {
              ...(completion?.status !== null && completion?.status !== undefined
                ? { status: completion.status }
                : {}),
              ...(responseBody !== undefined ? { response: responseBody } : {}),
            }
          : {}),
    });
  }
  const observation: RawTraceObservationV2 = {
    evaluationSchemaVersion: 2,
    runId: input.runId,
    caseId: input.caseId,
    variantId: input.variantId,
    rawTraceStatus: input.turnCompletion.outcome === "missing"
      && input.entries.length === 0
      && input.completions.length === 0
      ? "missing"
      : issues.length > 0
        ? "partial"
        : "complete",
    attempts,
    ...(observationFailures.length > 0
      ? { infrastructureFailures: observationFailures }
      : {}),
  };
  const rawEvidence: ObservedBridgeTraceEvidence = {
    schemaVersion: "task1.observed-bridge-trace-evidence.v1",
    runId: input.runId,
    caseId: input.caseId,
    variantId: input.variantId,
    activeSessionId: input.activeSessionId,
    turnCompletion: safeTurnCompletionFact(input.turnCompletion),
    entries: input.entries.map((value) => ({
      correlationId: value.correlationId,
      family: value.family,
      endpoint: value.endpoint,
      method: value.method,
      ...(value.requestBodyCapture.outcome === "captured"
        && asJsonValue(value.requestBody) !== undefined
        ? { requestBody: asJsonValue(value.requestBody) }
        : {}),
      requestBodyCapture: value.requestBodyCapture,
      correlationHeaders: safeCorrelationHeaders(value.correlationHeaders),
    })),
    completions: input.completions.map(safeCompletionEvidence),
    issues,
  };
  return deepFreeze(structuredClone({ observation, rawEvidence }));
}

function turnCompletionInfrastructureFailure(
  fact: TurnCompletionFact,
): RawInfrastructureFailureV2 | undefined {
  switch (fact.outcome) {
    case "completed":
      return undefined;
    case "missing":
      return {
        kind: "trace_missing",
        message: "Provider turn completion fact is missing",
        code: "turn_completion_missing",
      };
    case "provider_5xx":
      return {
        kind: "provider_5xx",
        message: "Provider turn ended with an infrastructure status",
        code: `provider_http_${fact.status}:${safeErrorName(fact.errorName)}`,
      };
    case "timeout":
      return {
        kind: "timeout",
        message: "Provider turn exceeded its execution budget",
        code: `turn_timeout:${safeTurnTimeoutStage(fact.stage)}`,
      };
  }
}

function safeTurnCompletionFact(fact: TurnCompletionFact): TurnCompletionFact {
  switch (fact.outcome) {
    case "completed":
    case "missing":
      return { outcome: fact.outcome };
    case "provider_5xx":
      return {
        outcome: "provider_5xx",
        status: fact.status,
        ...(fact.errorName !== undefined ? { errorName: safeErrorName(fact.errorName) } : {}),
      };
    case "timeout":
      return {
        outcome: "timeout",
        stage: safeTurnTimeoutStage(fact.stage),
        budgetMs: fact.budgetMs,
      };
  }
}

const SAFE_TURN_TIMEOUT_STAGES = new Set([
  "provider_turn",
  "codex_exec",
  "turn_completion",
  "bridge_observer",
]);

function safeTurnTimeoutStage(value: string): string {
  const normalized = value.trim();
  return SAFE_TURN_TIMEOUT_STAGES.has(normalized) ? normalized : "unknown";
}

function groupByCorrelationId<T extends { readonly correlationId: string }>(
  values: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const group = grouped.get(value.correlationId) ?? [];
    group.push(value);
    grouped.set(value.correlationId, group);
  }
  return grouped;
}

function traceIssue(code: string, message: string): RawInfrastructureFailureV2 {
  return { kind: "trace_missing", message, code };
}

function readCorrelationHeader(
  headers: Readonly<Record<string, string>>,
  expectedName: string,
): string | undefined {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === expectedName);
  return entry?.[1];
}

function belongsToActiveSession(entry: ObservedToolEntry, activeSessionId: string): boolean {
  const observedSessionId = readCorrelationHeader(
    entry.correlationHeaders,
    "x-conversation-id",
  );
  if (observedSessionId === activeSessionId) return true;
  if (entry.family !== "knowledge") return false;
  return readCorrelationHeader(entry.correlationHeaders, "x-tdai-agent-source") === "codex"
    && observedSessionId === `codex:${activeSessionId}`;
}

const SAFE_CORRELATION_HEADERS = new Set<string>(BRIDGE_CORRELATION_HEADER_NAMES);

function safeCorrelationHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (SAFE_CORRELATION_HEADERS.has(normalizedName)) safe[normalizedName] = value;
  }
  return safe;
}

function completionMatchesEntry(
  entry: ObservedToolEntry,
  completion: ObservedToolCompletion,
): boolean {
  return completion.family === entry.family
    && completion.endpoint === entry.endpoint
    && completion.method.toUpperCase() === entry.method.toUpperCase();
}

function entryInfrastructureFailure(
  entry: ObservedToolEntry,
): RawInfrastructureFailureV2 | undefined {
  if (entry.requestBodyCapture.outcome !== "failed") return undefined;
  return {
    kind: "trace_missing",
    message: "Bridge request body observation failed",
    code: `request_body_capture_failed:${safeErrorName(entry.requestBodyCapture.failure.name)}`,
  };
}

function completionInfrastructureFailure(
  completion: ObservedToolCompletion,
): RawInfrastructureFailureV2 | undefined {
  if (completion.outcome === "failure") {
    return {
      kind: "bridge_5xx",
      message: "Bridge execution observer reported a failure",
      code: `observer_failure:${safeErrorName(completion.failure?.name)}`,
    };
  }
  if (completion.status !== null && completion.status >= 500) {
    return {
      kind: "bridge_5xx",
      message: "Bridge returned an infrastructure HTTP status",
      code: `http_${completion.status}`,
    };
  }
  return undefined;
}

function safeCompletionEvidence(
  completion: ObservedToolCompletion,
): SafeObservedCompletionEvidence {
  const responseBody = asJsonValue(completion.responseBody);
  const failureName = safeErrorName(completion.failure?.name);
  const failureMessageSha256 = persistedFailureMessageSha256(completion.failure);
  return {
    correlationId: completion.correlationId,
    family: completion.family,
    endpoint: completion.endpoint,
    method: completion.method,
    outcome: completion.outcome,
    status: completion.status,
    ...(responseBody !== undefined ? { responseBody } : {}),
    ...(completion.responseBodySha256
      ? { responseBodySha256: completion.responseBodySha256 }
      : {}),
    durationMs: completion.durationMs,
    ...(completion.outcome === "failure"
      ? {
          failure: {
            name: failureName,
            category: "observer_failure" as const,
            messageSha256: failureMessageSha256,
          },
        }
      : {}),
  };
}

function persistedFailureMessageSha256(
  failure: ObservedToolCompletion["failure"],
): string {
  if (failure && "messageSha256" in failure && /^[a-f0-9]{64}$/.test(failure.messageSha256)) {
    return failure.messageSha256;
  }
  const message = failure && "message" in failure ? failure.message : "";
  return createHash("sha256").update(message, "utf8").digest("hex");
}

const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "DataCloneError",
]);

function safeErrorName(value: string | undefined): string {
  return value !== undefined && SAFE_ERROR_NAMES.has(value) ? value : "Error";
}

function resolveObservedContract(entry: ObservedToolEntry): Readonly<{
  id: string;
  canonicalEndpoint: string;
}> | undefined {
  const observedPath = normalizePath(entry.endpoint);
  const matches = RUNTIME_TOOL_CONTRACTS.filter((candidate) => (
    candidate.family === entry.family
    && candidate.method === entry.method.toUpperCase()
    && (candidate.path === observedPath
      || (entry.family === "knowledge" && observedPath === `/v3${candidate.path}`))
  ));
  if (matches.length !== 1) return undefined;
  return {
    id: matches[0].id,
    canonicalEndpoint: entry.family === "knowledge" ? matches[0].path : entry.endpoint,
  };
}

function normalizePath(endpoint: string): string {
  try {
    return new URL(endpoint).pathname;
  } catch {
    return endpoint.split(/[?#]/, 1)[0];
  }
}

function requireNonBlank(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be non-blank`);
}

function asJsonObject(value: unknown): JsonObjectV2 | undefined {
  return isJsonObject(value) ? value : undefined;
}

function asJsonValue(value: unknown): JsonValueV2 | undefined {
  return isJsonValue(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObjectV2 {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((item) => item === undefined || isJsonValue(item));
}

function isJsonValue(value: unknown): value is JsonValueV2 {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
