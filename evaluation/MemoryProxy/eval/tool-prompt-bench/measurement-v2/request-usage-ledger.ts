import {
  canonicalJson,
  canonicalJsonClone,
  canonicalSha256,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import {
  PROVIDER_USAGE_FIELDS,
  type NormalizedProviderUsage,
  type ProviderUsageField,
  type ProviderUsageFieldState,
  type ProviderUsageNormalizationResult,
  type ProviderUsageSchema,
} from "./provider-usage.js";

export const M2_PHASE_COMPONENTS = ["task_model", "router", "verifier"] as const;
export const M2_PHASE_TYPES = ["initial", "discovery", "executor", "followup"] as const;

export type M2PhaseComponent = (typeof M2_PHASE_COMPONENTS)[number];
export type M2PhaseType = (typeof M2_PHASE_TYPES)[number];
export type ProviderUsageTotals = Record<ProviderUsageField, number | null>;

export interface LocalTokenEstimate {
  tokens: number;
  accounting: "local_component_estimate";
  tokenizerId: string;
  tokenizerVersion: string;
}

export interface RequestUsageRecordInput {
  runId: string;
  traceId: string;
  requestId: string;
  /** Ordered TDAI attempts observed in this provider response. Empty is valid. */
  observedAttemptIds: readonly string[];
  requestOrdinal: number;
  phaseId: string;
  component: M2PhaseComponent;
  phaseType: M2PhaseType;
  promptSha256: string;
  /** Number of provider-visible tool definitions in this request body. */
  providerToolDefinitionCount: number;
  injectionTokensO200k: number;
  discoveryResultTokens: LocalTokenEstimate | null;
  toolResultContextTokens: LocalTokenEstimate | null;
  latencyMs: number;
  usage: ProviderUsageNormalizationResult;
}

export interface BuildRequestUsageLedgerInput {
  runId: string;
  traceId: string;
  requests: readonly RequestUsageRecordInput[];
}

export type RequestUsageLedgerBlockerCode =
  | "LEDGER_RUN_ID_INVALID"
  | "LEDGER_TRACE_ID_INVALID"
  | "REQUESTS_MISSING"
  | "REQUEST_RUN_MISMATCH"
  | "REQUEST_TRACE_MISMATCH"
  | "REQUEST_ID_INVALID"
  | "ATTEMPT_ID_INVALID"
  | "PHASE_ID_INVALID"
  | "REQUEST_ORDINAL_INVALID"
  | "REQUEST_ORDINAL_MISSING"
  | "REQUEST_ID_DUPLICATE"
  | "ATTEMPT_ID_DUPLICATE"
  | "PHASE_COMPONENT_INVALID"
  | "PHASE_TYPE_INVALID"
  | "PROMPT_SHA256_INVALID"
  | "REQUEST_NUMERIC_EVIDENCE_INVALID"
  | "REQUEST_USAGE_BLOCKED"
  | "REQUEST_USAGE_CONTRACT_MISMATCH"
  | "USAGE_TOTAL_OVERFLOW";

export interface RecordedProviderUsageEvidence {
  provider: ProviderUsageNormalizationResult["provider"];
  schema: ProviderUsageSchema;
  apiVersion: string;
  adapterVersion: string;
  requiredFields: readonly ProviderUsageField[];
  unsupportedFields: readonly ProviderUsageField[];
  rawUsageCanonicalizationStatus: "ready";
  rawUsageCanonicalClone: CanonicalJsonValue;
  rawUsageSha256: string;
  fieldStates: Record<ProviderUsageField, ProviderUsageFieldState>;
  normalized: NormalizedProviderUsage;
  normalizationCanonicalSha256: string;
}

export interface RequestUsageLedgerRecord extends Omit<RequestUsageRecordInput, "usage"> {
  providerUsage: RecordedProviderUsageEvidence;
  cumulativeProviderUsage: ProviderUsageTotals;
}

export interface RequestUsageLedger {
  schemaVersion: 2;
  measurementModuleId: "M2";
  runId: string;
  traceId: string;
  providerUsageContractSha256: string;
  requests: readonly RequestUsageLedgerRecord[];
  aggregateProviderUsage: ProviderUsageTotals;
  canonicalSha256: string;
}

export type BuildRequestUsageLedgerResult =
  | { status: "ready"; blockers: []; ledger: RequestUsageLedger }
  | { status: "blocked"; blockers: RequestUsageLedgerBlockerCode[]; ledger: null };

export interface M0AttemptBoundaryFact {
  traceId: string;
  requestId: string;
  attemptId: string;
  phaseId: string;
}

export interface M0TerminalBoundaryFact {
  traceId: string;
  requestId: string;
  phaseId: string;
  terminalAttemptId: string;
}

export type M0EvaluationBoundaryFacts =
  | { status: "pending" }
  | {
      status: "observed";
      runId: string;
      traceId: string;
      evaluationPrefixSha256: string;
      evaluationAttemptPrefix: readonly M0AttemptBoundaryFact[];
      evaluationHorizonRequestId: string;
      evaluationHorizonPhaseId: string;
      terminalBoundaryGivenSuccess: M0TerminalBoundaryFact | null;
      modelRoundsToTerminal: number | null;
      tdaiCallCount: number;
      timeToTerminalMs: number | null;
      terminalReached: boolean;
    };

export type M0EvaluationBoundaryBlockerCode =
  | "M0_RUN_ID_INVALID"
  | "M0_TRACE_ID_INVALID"
  | "M0_EVALUATION_PREFIX_SHA256_INVALID"
  | "M0_BOUNDARY_ID_INVALID"
  | "M0_BOUNDARY_TRACE_MISMATCH"
  | "M0_BOUNDARY_DUPLICATE"
  | "M0_HORIZON_REQUEST_ID_INVALID"
  | "M0_HORIZON_PHASE_ID_INVALID"
  | "M0_TERMINAL_BOUNDARY_IDENTITY_INVALID"
  | "M0_MODEL_ROUNDS_INVALID"
  | "M0_TDAI_CALL_COUNT_INVALID"
  | "M0_TIME_TO_TERMINAL_INVALID";

export interface M0EvaluationBoundaryGate {
  status: "pending" | "ready" | "blocked";
  blockers: M0EvaluationBoundaryBlockerCode[];
}

export type UsageHorizonBlockerCode =
  | "REQUEST_USAGE_LEDGER_INVALID"
  | "LEDGER_CANONICAL_SHA256_MISMATCH"
  | "LEDGER_CUMULATIVE_USAGE_MISMATCH"
  | "LEDGER_AGGREGATE_USAGE_MISMATCH"
  | "M0_BOUNDARY_PENDING"
  | "M0_BOUNDARY_INVALID"
  | "HORIZON_RUN_MISMATCH"
  | "HORIZON_TRACE_MISMATCH"
  | "HORIZON_REQUEST_MISSING"
  | "HORIZON_ATTEMPT_MISMATCH"
  | "HORIZON_ATTEMPT_PREFIX_MISMATCH"
  | "HORIZON_ATTEMPT_ORDER_INVALID"
  | "HORIZON_ATTEMPT_AFTER_REQUEST"
  | "HORIZON_PHASE_MISMATCH";

export interface M2EvaluationHorizonUsageEvidence {
  schemaVersion: 2;
  measurementModuleId: "M2";
  runId: string;
  traceId: string;
  status: "ready" | "blocked";
  blockers: UsageHorizonBlockerCode[];
  requestUsageLedgerCanonicalSha256: string;
  m0BoundaryFactsSha256: string;
  evaluationAttemptCount: number;
  evaluationHorizonRequestOrdinal: number | null;
  accumulatedRequestCount: number;
  terminalReached: boolean;
  aggregatesToEvaluationHorizon: ProviderUsageTotals | null;
  providerInputToEvaluationHorizon: number | null;
  providerInputToTerminalGivenSuccess: number | null;
  canonicalSha256: string;
}

export type M2EvaluationHorizonEvidenceBlockerCode =
  | UsageHorizonBlockerCode
  | "HORIZON_USAGE_VALUE_INVALID"
  | "HORIZON_AGGREGATE_IDENTITY_MISMATCH"
  | "TERMINAL_COST_IDENTITY_INVALID"
  | "HORIZON_EVIDENCE_CANONICAL_SHA256_MISMATCH";

export interface M2EvaluationHorizonEvidenceGate {
  status: "ready" | "blocked";
  blockers: M2EvaluationHorizonEvidenceBlockerCode[];
}

function isIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isLocalEstimate(value: LocalTokenEstimate | null): boolean {
  return value === null || (
    isNonNegativeInteger(value.tokens)
    && value.accounting === "local_component_estimate"
    && isIdentity(value.tokenizerId)
    && isIdentity(value.tokenizerVersion)
  );
}

function emptyTotals(): ProviderUsageTotals {
  return Object.fromEntries(PROVIDER_USAGE_FIELDS.map((field) => [field, null])) as ProviderUsageTotals;
}

function usageContractIdentity(usage: ProviderUsageNormalizationResult): object {
  return {
    provider: usage.provider,
    schema: usage.schema,
    apiVersion: usage.apiVersion,
    adapterVersion: usage.adapterVersion,
    requiredFields: [...usage.requiredFields].sort(),
    unsupportedFields: [...usage.unsupportedFields].sort(),
  };
}

function sumUsage(
  usages: readonly NormalizedProviderUsage[],
): { totals: ProviderUsageTotals; overflow: boolean } {
  const totals = emptyTotals();
  let overflow = false;
  for (const field of PROVIDER_USAGE_FIELDS) {
    const values = usages.map((usage) => usage[field]);
    if (values.some((value) => value === null)) continue;
    let sum = 0;
    let fieldOverflow = false;
    for (const value of values) {
      sum += value as number;
      if (!Number.isSafeInteger(sum)) {
        overflow = true;
        fieldOverflow = true;
      }
    }
    totals[field] = fieldOverflow ? null : sum;
  }
  return { totals, overflow };
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function recordedUsage(
  usage: ProviderUsageNormalizationResult,
): RecordedProviderUsageEvidence {
  if (
    !usage.ok
    || usage.usage === null
    || usage.rawUsageCanonicalizationStatus !== "ready"
    || usage.rawUsageSha256 === null
  ) {
    throw new Error("cannot record blocked provider usage");
  }
  return canonicalJsonClone({
    provider: usage.provider,
    schema: usage.schema,
    apiVersion: usage.apiVersion,
    adapterVersion: usage.adapterVersion,
    requiredFields: usage.requiredFields,
    unsupportedFields: usage.unsupportedFields,
    rawUsageCanonicalizationStatus: usage.rawUsageCanonicalizationStatus,
    rawUsageCanonicalClone: usage.rawUsageCanonicalClone,
    rawUsageSha256: usage.rawUsageSha256,
    fieldStates: usage.fieldStates,
    normalized: usage.usage,
    normalizationCanonicalSha256: usage.canonicalSha256,
  }) as unknown as RecordedProviderUsageEvidence;
}

function withoutLedgerSha(ledger: RequestUsageLedger): Omit<RequestUsageLedger, "canonicalSha256"> {
  const { canonicalSha256: _canonicalSha256, ...withoutSha } = ledger;
  return withoutSha;
}

function withoutHorizonSha(
  evidence: M2EvaluationHorizonUsageEvidence,
): Omit<M2EvaluationHorizonUsageEvidence, "canonicalSha256"> {
  const { canonicalSha256: _canonicalSha256, ...withoutSha } = evidence;
  return withoutSha;
}

export function buildRequestUsageLedger(
  input: BuildRequestUsageLedgerInput,
): BuildRequestUsageLedgerResult {
  const blockers: RequestUsageLedgerBlockerCode[] = [];
  if (!isIdentity(input.runId)) blockers.push("LEDGER_RUN_ID_INVALID");
  if (!isIdentity(input.traceId)) blockers.push("LEDGER_TRACE_ID_INVALID");
  if (input.requests.length === 0) blockers.push("REQUESTS_MISSING");

  const requestIds = new Set<string>();
  const attemptIds = new Set<string>();
  let contractSha256: string | null = null;
  for (const [index, request] of input.requests.entries()) {
    if (request.runId !== input.runId) blockers.push("REQUEST_RUN_MISMATCH");
    if (request.traceId !== input.traceId) blockers.push("REQUEST_TRACE_MISMATCH");
    if (!isIdentity(request.requestId)) blockers.push("REQUEST_ID_INVALID");
    if (!Array.isArray(request.observedAttemptIds)) {
      blockers.push("ATTEMPT_ID_INVALID");
    } else {
      for (const attemptId of request.observedAttemptIds) {
        if (!isIdentity(attemptId)) blockers.push("ATTEMPT_ID_INVALID");
        if (attemptIds.has(attemptId)) blockers.push("ATTEMPT_ID_DUPLICATE");
        attemptIds.add(attemptId);
      }
    }
    if (!isIdentity(request.phaseId)) blockers.push("PHASE_ID_INVALID");
    if (!isNonNegativeInteger(request.requestOrdinal)) blockers.push("REQUEST_ORDINAL_INVALID");
    if (request.requestOrdinal !== index) blockers.push("REQUEST_ORDINAL_MISSING");
    if (requestIds.has(request.requestId)) blockers.push("REQUEST_ID_DUPLICATE");
    requestIds.add(request.requestId);
    if (!M2_PHASE_COMPONENTS.includes(request.component)) blockers.push("PHASE_COMPONENT_INVALID");
    if (!M2_PHASE_TYPES.includes(request.phaseType)) blockers.push("PHASE_TYPE_INVALID");
    if (!isSha256(request.promptSha256)) blockers.push("PROMPT_SHA256_INVALID");
    if (
      !isNonNegativeInteger(request.providerToolDefinitionCount)
      || !isNonNegativeInteger(request.injectionTokensO200k)
      || !isNonNegativeInteger(request.latencyMs)
      || !isLocalEstimate(request.discoveryResultTokens)
      || !isLocalEstimate(request.toolResultContextTokens)
    ) {
      blockers.push("REQUEST_NUMERIC_EVIDENCE_INVALID");
    }
    if (!request.usage.ok || request.usage.usage?.usageCompleteForRequiredFields !== true) {
      blockers.push("REQUEST_USAGE_BLOCKED");
    }
    const currentContractSha256 = canonicalSha256(usageContractIdentity(request.usage));
    contractSha256 ??= currentContractSha256;
    if (currentContractSha256 !== contractSha256) blockers.push("REQUEST_USAGE_CONTRACT_MISMATCH");
  }

  if (blockers.length > 0 || contractSha256 === null) {
    return { status: "blocked", blockers: [...new Set(blockers)], ledger: null };
  }

  const normalizedUsages = input.requests.map((request) => request.usage.usage!);
  const aggregate = sumUsage(normalizedUsages);
  if (aggregate.overflow) {
    return { status: "blocked", blockers: ["USAGE_TOTAL_OVERFLOW"], ledger: null };
  }
  const requests: RequestUsageLedgerRecord[] = input.requests.map((request, index) => {
    const { usage, ...identity } = request;
    const cumulative = sumUsage(normalizedUsages.slice(0, index + 1));
    return canonicalJsonClone({
      ...identity,
      providerUsage: recordedUsage(usage),
      cumulativeProviderUsage: cumulative.totals,
    }) as unknown as RequestUsageLedgerRecord;
  });
  const withoutSha = {
    schemaVersion: 2 as const,
    measurementModuleId: "M2" as const,
    runId: input.runId,
    traceId: input.traceId,
    providerUsageContractSha256: contractSha256,
    requests,
    aggregateProviderUsage: aggregate.totals,
  };
  return {
    status: "ready",
    blockers: [],
    ledger: {
      ...withoutSha,
      canonicalSha256: canonicalSha256(withoutSha),
    },
  };
}

export function assessM0EvaluationBoundaryFacts(
  facts: M0EvaluationBoundaryFacts,
): M0EvaluationBoundaryGate {
  if (facts.status === "pending") return { status: "pending", blockers: [] };
  const blockers: M0EvaluationBoundaryBlockerCode[] = [];
  if (!isIdentity(facts.runId)) blockers.push("M0_RUN_ID_INVALID");
  if (!isIdentity(facts.traceId)) blockers.push("M0_TRACE_ID_INVALID");
  if (!isSha256(facts.evaluationPrefixSha256)) {
    blockers.push("M0_EVALUATION_PREFIX_SHA256_INVALID");
  } else if (canonicalSha256(facts.evaluationAttemptPrefix) !== facts.evaluationPrefixSha256) {
    blockers.push("M0_EVALUATION_PREFIX_SHA256_INVALID");
  }
  if (!isIdentity(facts.evaluationHorizonRequestId)) {
    blockers.push("M0_HORIZON_REQUEST_ID_INVALID");
  }
  if (!isIdentity(facts.evaluationHorizonPhaseId)) {
    blockers.push("M0_HORIZON_PHASE_ID_INVALID");
  }
  const attemptIds = new Set<string>();
  for (const boundary of facts.evaluationAttemptPrefix) {
    if (
      !isIdentity(boundary.traceId)
      || !isIdentity(boundary.requestId)
      || !isIdentity(boundary.attemptId)
      || !isIdentity(boundary.phaseId)
    ) {
      blockers.push("M0_BOUNDARY_ID_INVALID");
    }
    if (boundary.traceId !== facts.traceId) blockers.push("M0_BOUNDARY_TRACE_MISMATCH");
    if (attemptIds.has(boundary.attemptId)) blockers.push("M0_BOUNDARY_DUPLICATE");
    attemptIds.add(boundary.attemptId);
  }
  if (
    !isNonNegativeInteger(facts.tdaiCallCount)
    || facts.tdaiCallCount !== facts.evaluationAttemptPrefix.length
  ) {
    blockers.push("M0_TDAI_CALL_COUNT_INVALID");
  }
  if (facts.terminalReached) {
    const terminal = facts.terminalBoundaryGivenSuccess;
    const lastAttempt = facts.evaluationAttemptPrefix.at(-1);
    if (
      terminal === null
      || lastAttempt === undefined
      || !isIdentity(terminal.traceId)
      || !isIdentity(terminal.requestId)
      || !isIdentity(terminal.phaseId)
      || !isIdentity(terminal.terminalAttemptId)
      || terminal.traceId !== facts.traceId
      || terminal.requestId !== facts.evaluationHorizonRequestId
      || terminal.phaseId !== facts.evaluationHorizonPhaseId
      || lastAttempt.traceId !== terminal.traceId
      || lastAttempt.requestId !== terminal.requestId
      || lastAttempt.phaseId !== terminal.phaseId
      || lastAttempt.attemptId !== terminal.terminalAttemptId
    ) {
      blockers.push("M0_TERMINAL_BOUNDARY_IDENTITY_INVALID");
    }
    if (facts.modelRoundsToTerminal === null
      || !Number.isSafeInteger(facts.modelRoundsToTerminal)
      || facts.modelRoundsToTerminal <= 0) {
      blockers.push("M0_MODEL_ROUNDS_INVALID");
    }
    if (facts.timeToTerminalMs === null || !isNonNegativeInteger(facts.timeToTerminalMs)) {
      blockers.push("M0_TIME_TO_TERMINAL_INVALID");
    }
  } else {
    if (facts.terminalBoundaryGivenSuccess !== null) {
      blockers.push("M0_TERMINAL_BOUNDARY_IDENTITY_INVALID");
    }
    if (facts.modelRoundsToTerminal !== null) blockers.push("M0_MODEL_ROUNDS_INVALID");
    if (facts.timeToTerminalMs !== null) blockers.push("M0_TIME_TO_TERMINAL_INVALID");
  }
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers: [...new Set(blockers)],
  };
}

function assessLedgerIntegrity(ledger: RequestUsageLedger): UsageHorizonBlockerCode[] {
  const blockers: UsageHorizonBlockerCode[] = [];
  if (canonicalSha256(withoutLedgerSha(ledger)) !== ledger.canonicalSha256) {
    blockers.push("LEDGER_CANONICAL_SHA256_MISMATCH");
  }
  const normalized = ledger.requests.map((request) => request.providerUsage.normalized);
  const attemptIds = new Set<string>();
  for (const [index, request] of ledger.requests.entries()) {
    const cumulative = sumUsage(normalized.slice(0, index + 1));
    if (cumulative.overflow || !sameCanonical(cumulative.totals, request.cumulativeProviderUsage)) {
      blockers.push("LEDGER_CUMULATIVE_USAGE_MISMATCH");
      break;
    }
    if (
      request.runId !== ledger.runId
      || request.traceId !== ledger.traceId
      || request.requestOrdinal !== index
    ) {
      blockers.push("REQUEST_USAGE_LEDGER_INVALID");
      break;
    }
    if (!Array.isArray(request.observedAttemptIds)) {
      blockers.push("REQUEST_USAGE_LEDGER_INVALID");
      break;
    }
    for (const attemptId of request.observedAttemptIds) {
      if (!isIdentity(attemptId) || attemptIds.has(attemptId)) {
        blockers.push("REQUEST_USAGE_LEDGER_INVALID");
        break;
      }
      attemptIds.add(attemptId);
    }
  }
  const aggregate = sumUsage(normalized);
  if (aggregate.overflow || !sameCanonical(aggregate.totals, ledger.aggregateProviderUsage)) {
    blockers.push("LEDGER_AGGREGATE_USAGE_MISMATCH");
  }
  return blockers;
}

export function accumulateRequestUsageToM0Horizon(
  ledger: RequestUsageLedger,
  facts: M0EvaluationBoundaryFacts,
): M2EvaluationHorizonUsageEvidence {
  const blockers = assessLedgerIntegrity(ledger);
  const boundaryGate = assessM0EvaluationBoundaryFacts(facts);
  if (facts.status === "pending") blockers.push("M0_BOUNDARY_PENDING");
  if (boundaryGate.status === "blocked") blockers.push("M0_BOUNDARY_INVALID");
  let evaluationAttemptCount = 0;
  let evaluationHorizonRequestOrdinal: number | null = null;
  let accumulatedRequestCount = 0;
  let aggregatesToEvaluationHorizon: ProviderUsageTotals | null = null;
  let providerInputToEvaluationHorizon: number | null = null;
  let providerInputToTerminalGivenSuccess: number | null = null;

  if (facts.status === "observed") {
    evaluationAttemptCount = facts.evaluationAttemptPrefix.length;
    if (ledger.runId !== facts.runId) blockers.push("HORIZON_RUN_MISMATCH");
    if (ledger.traceId !== facts.traceId) blockers.push("HORIZON_TRACE_MISMATCH");
    const horizonIndex = ledger.requests.findIndex(
      (request) => request.requestId === facts.evaluationHorizonRequestId,
    );
    if (horizonIndex < 0) {
      blockers.push("HORIZON_REQUEST_MISSING");
    } else {
      evaluationHorizonRequestOrdinal = horizonIndex;
      accumulatedRequestCount = horizonIndex + 1;
      if (ledger.requests[horizonIndex].phaseId !== facts.evaluationHorizonPhaseId) {
        blockers.push("HORIZON_PHASE_MISMATCH");
      }
    }

    const attemptPositions = new Map<string, { request: RequestUsageLedgerRecord; attemptIndex: number }>();
    for (const request of ledger.requests) {
      request.observedAttemptIds.forEach((attemptId, attemptIndex) => {
        attemptPositions.set(attemptId, { request, attemptIndex });
      });
    }
    let previousPosition: { requestOrdinal: number; attemptIndex: number } | null = null;
    for (const boundary of facts.evaluationAttemptPrefix) {
      const position = attemptPositions.get(boundary.attemptId);
      if (position === undefined) {
        blockers.push("HORIZON_ATTEMPT_MISMATCH");
        continue;
      }
      const request = position.request;
      if (request.requestId !== boundary.requestId) blockers.push("HORIZON_ATTEMPT_MISMATCH");
      if (request.traceId !== boundary.traceId) blockers.push("HORIZON_TRACE_MISMATCH");
      if (request.phaseId !== boundary.phaseId) blockers.push("HORIZON_PHASE_MISMATCH");
      const currentPosition = {
        requestOrdinal: request.requestOrdinal,
        attemptIndex: position.attemptIndex,
      };
      if (
        previousPosition !== null
        && (
          currentPosition.requestOrdinal < previousPosition.requestOrdinal
          || (
            currentPosition.requestOrdinal === previousPosition.requestOrdinal
            && currentPosition.attemptIndex <= previousPosition.attemptIndex
          )
        )
      ) {
        blockers.push("HORIZON_ATTEMPT_ORDER_INVALID");
      }
      if (horizonIndex >= 0 && currentPosition.requestOrdinal > horizonIndex) {
        blockers.push("HORIZON_ATTEMPT_AFTER_REQUEST");
      }
      previousPosition = currentPosition;
    }

    const flattenedAttempts = ledger.requests.flatMap((request) => (
      request.observedAttemptIds.map((attemptId) => ({
        traceId: request.traceId,
        requestId: request.requestId,
        attemptId,
        phaseId: request.phaseId,
      }))
    ));
    if (facts.terminalReached && facts.terminalBoundaryGivenSuccess !== null) {
      const terminal = facts.terminalBoundaryGivenSuccess;
      const terminalIndex = flattenedAttempts.findIndex((attempt) => (
        attempt.traceId === terminal.traceId
        && attempt.requestId === terminal.requestId
        && attempt.phaseId === terminal.phaseId
        && attempt.attemptId === terminal.terminalAttemptId
      ));
      const expectedPrefix = terminalIndex < 0
        ? null
        : flattenedAttempts.slice(0, terminalIndex + 1);
      if (
        expectedPrefix === null
        || !sameCanonical(expectedPrefix, facts.evaluationAttemptPrefix)
      ) {
        blockers.push("HORIZON_ATTEMPT_PREFIX_MISMATCH");
      }
    } else if (horizonIndex >= 0) {
      const expectedPrefix = ledger.requests
        .slice(0, horizonIndex + 1)
        .flatMap((request) => request.observedAttemptIds.map((attemptId) => ({
          traceId: request.traceId,
          requestId: request.requestId,
          attemptId,
          phaseId: request.phaseId,
        })));
      if (!sameCanonical(expectedPrefix, facts.evaluationAttemptPrefix)) {
        blockers.push("HORIZON_ATTEMPT_PREFIX_MISMATCH");
      }
    }

    if (blockers.length === 0 && horizonIndex >= 0) {
      const aggregate = sumUsage(
        ledger.requests
          .slice(0, horizonIndex + 1)
          .map((request) => request.providerUsage.normalized),
      );
      if (aggregate.overflow) {
        blockers.push("REQUEST_USAGE_LEDGER_INVALID");
      } else {
        aggregatesToEvaluationHorizon = aggregate.totals;
        providerInputToEvaluationHorizon = aggregate.totals.providerTotalInputTokens;
        providerInputToTerminalGivenSuccess = facts.terminalReached
          ? providerInputToEvaluationHorizon
          : null;
      }
    }
  }

  const withoutSha = {
    schemaVersion: 2 as const,
    measurementModuleId: "M2" as const,
    runId: ledger.runId,
    traceId: ledger.traceId,
    status: blockers.length === 0 ? "ready" as const : "blocked" as const,
    blockers: [...new Set(blockers)],
    requestUsageLedgerCanonicalSha256: ledger.canonicalSha256,
    m0BoundaryFactsSha256: canonicalSha256(facts),
    evaluationAttemptCount,
    evaluationHorizonRequestOrdinal,
    accumulatedRequestCount,
    terminalReached: facts.status === "observed" && facts.terminalReached,
    aggregatesToEvaluationHorizon,
    providerInputToEvaluationHorizon,
    providerInputToTerminalGivenSuccess,
  };
  return {
    ...withoutSha,
    canonicalSha256: canonicalSha256(withoutSha),
  };
}

export function assessM2EvaluationHorizonUsageEvidence(
  evidence: M2EvaluationHorizonUsageEvidence,
): M2EvaluationHorizonEvidenceGate {
  const blockers: M2EvaluationHorizonEvidenceBlockerCode[] = [...evidence.blockers];
  if (canonicalSha256(withoutHorizonSha(evidence)) !== evidence.canonicalSha256) {
    blockers.push("HORIZON_EVIDENCE_CANONICAL_SHA256_MISMATCH");
  }
  if (evidence.status === "ready") {
    const horizon = evidence.providerInputToEvaluationHorizon;
    if (horizon === null || !isNonNegativeInteger(horizon)) {
      blockers.push("HORIZON_USAGE_VALUE_INVALID");
    }
    if (
      evidence.aggregatesToEvaluationHorizon === null
      || evidence.aggregatesToEvaluationHorizon.providerTotalInputTokens !== horizon
    ) {
      blockers.push("HORIZON_AGGREGATE_IDENTITY_MISMATCH");
    }
    if (evidence.terminalReached) {
      if (
        evidence.providerInputToTerminalGivenSuccess === null
        || evidence.providerInputToTerminalGivenSuccess !== horizon
      ) {
        blockers.push("TERMINAL_COST_IDENTITY_INVALID");
      }
    } else if (evidence.providerInputToTerminalGivenSuccess !== null) {
      blockers.push("TERMINAL_COST_IDENTITY_INVALID");
    }
  }
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers: [...new Set(blockers)],
  };
}
