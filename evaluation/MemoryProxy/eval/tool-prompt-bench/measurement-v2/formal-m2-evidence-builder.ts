import { countInjectionTokens } from "../codex-runner.js";
import type { FormalExecutionReceipt } from "../formal-execution-runner.js";
import { canonicalJson, canonicalJsonClone, canonicalSha256 } from "./canonical-json.js";
import {
  buildM2EligibilityEvidence,
  type M2EligibilityEvidence,
} from "./eligibility-evidence.js";
import {
  buildRunIsolationEvidence,
  type RunIsolationEvidence,
} from "./isolation-evidence.js";
import type {
  CollectedObservedRun,
  TimedObservedEvent,
} from "./observed-event-collector.js";
import type { ObservedToolEntry } from "./observed-bridge-trace-projector.js";
import {
  FORMAL_PROVIDER_USAGE_CONTRACT,
  type CollectedProviderRequest,
  type CollectedProviderRun,
} from "./provider-evidence-collector.js";
import {
  captureProductionInjectionV2,
  finalizeProductionInjectionCaptureV2,
  type ProductionInjectionCaptureV2,
} from "./production-injection-capture.js";
import {
  accumulateRequestUsageToM0Horizon,
  buildRequestUsageLedger,
  type BuildRequestUsageLedgerResult,
  type M0AttemptBoundaryFact,
  type M0EvaluationBoundaryFacts,
  type M2EvaluationHorizonUsageEvidence,
  type M2PhaseType,
} from "./request-usage-ledger.js";
import type { TokenizerSeam } from "./token-ledger.js";
import type { CaseChainScoreV2 } from "./types.js";

export const FORMAL_M2_ATTRIBUTION_CONTRACT_ID =
  "codex-single-thread-request-to-next-request-v1" as const;

const DEFAULT_TOKENIZER: TokenizerSeam = Object.freeze({
  id: "o200k_base",
  version: "tiktoken-1.0.22",
  count: countInjectionTokens,
});

export interface FormalM2FrozenControl {
  /** Frozen before execution; never inferred from a surviving observed run. */
  caseInputControlSha256: string;
  /** Frozen comparison membership/control root. */
  comparisonGroupSha256: string;
  /** Frozen expected visible-asset root, independently checked against preflight. */
  visibleAssetSetSha256: string;
}

export interface BuildFormalM2PreGoldEvidenceInput {
  execution: FormalExecutionReceipt;
  toolRun: CollectedObservedRun;
  providerRun: CollectedProviderRun;
  frozenControl: FormalM2FrozenControl;
  tokenizer?: TokenizerSeam;
}

export interface FormalM2AttributedAttempt {
  attemptId: string;
  source: TimedObservedEvent<ObservedToolEntry>["source"];
  observerSequence: number;
  entryWallTimeUnixMicros: string;
  requestId: string;
  requestOrdinal: number;
  phaseId: string;
}

export interface FormalM2AttributionWindow {
  requestId: string;
  requestOrdinal: number;
  requestSequence: number;
  requestWallTimeUnixMicros: string;
  completionSequence: number;
  completionWallTimeUnixMicros: string;
  nextRequestWallTimeUnixMicros: string;
  observedAttemptIds: readonly string[];
  phaseId: string;
  phaseType: M2PhaseType;
}

export interface FormalM2PreGoldEvidence {
  schemaVersion: "task1.formal-m2-pregold-evidence.v1";
  measurementModuleId: "M2";
  runId: string;
  caseId: string;
  variantId: string;
  traceId: string;
  attributionContractId: typeof FORMAL_M2_ATTRIBUTION_CONTRACT_ID;
  frozenControl: FormalM2FrozenControl;
  executionStartedWallTimeUnixMicros: string;
  executionFinishedWallTimeUnixMicros: string;
  attributionWindows: readonly FormalM2AttributionWindow[];
  attributedAttempts: readonly FormalM2AttributedAttempt[];
  tokenCapture: ProductionInjectionCaptureV2;
  requestUsageLedger: BuildRequestUsageLedgerResult;
  runIsolation: RunIsolationEvidence;
  canonicalSha256: string;
}

export interface FinalizeFormalM2EvidenceInput {
  preGold: FormalM2PreGoldEvidence;
  score: CaseChainScoreV2;
}

export interface FinalFormalM2Evidence {
  schemaVersion: "task1.formal-m2-evidence.v1";
  measurementModuleId: "M2";
  runId: string;
  caseId: string;
  variantId: string;
  traceId: string;
  attributionContractId: typeof FORMAL_M2_ATTRIBUTION_CONTRACT_ID;
  preGoldCanonicalSha256: string;
  scoreCanonicalSha256: string;
  tokenCapture: ProductionInjectionCaptureV2;
  requestUsageLedger: BuildRequestUsageLedgerResult;
  runIsolation: RunIsolationEvidence;
  m0EvaluationBoundary: M0EvaluationBoundaryFacts;
  usageHorizon: M2EvaluationHorizonUsageEvidence;
  eligibility: M2EligibilityEvidence;
  canonicalSha256: string;
}

export class FormalM2EvidenceError extends Error {
  constructor(
    readonly code:
      | "IDENTITY_MISMATCH"
      | "FROZEN_CONTROL_INVALID"
      | "OBSERVER_EVIDENCE_BLOCKED"
      | "PROVIDER_REQUEST_INVALID"
      | "PROVIDER_COMPLETION_MISSING"
      | "PROVIDER_USAGE_MISSING"
      | "CLOCK_OR_WINDOW_INVALID"
      | "ATTRIBUTION_AMBIGUOUS"
      | "REQUEST_USAGE_LEDGER_BLOCKED"
      | "RUN_ISOLATION_BLOCKED"
      | "PREGOLD_CANONICAL_MISMATCH"
      | "SCORE_IDENTITY_MISMATCH"
      | "SCORE_BOUNDARY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "FormalM2EvidenceError";
  }
}

interface ValidatedProviderRequest {
  request: CollectedProviderRequest;
  requestTime: bigint;
  completionTime: bigint;
  completionSequence: number;
  completionWallTimeUnixMicros: string;
  usage: NonNullable<CollectedProviderRequest["providerUsageNormalization"]>;
}

function requireIdentity(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FormalM2EvidenceError("IDENTITY_MISMATCH", `${label} must be non-empty`);
  }
  return value;
}

function requireSha256(label: string, value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new FormalM2EvidenceError(
      "FROZEN_CONTROL_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function requireMicros(label: string, value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new FormalM2EvidenceError(
      "CLOCK_OR_WINDOW_INVALID",
      `${label} must be unsigned integer microseconds`,
    );
  }
  return BigInt(value);
}

function requireSafeOrdinal(label: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FormalM2EvidenceError(
      "PROVIDER_REQUEST_INVALID",
      `${label} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function assertRunIdentity(input: BuildFormalM2PreGoldEvidenceInput): void {
  const { execution, providerRun, toolRun, frozenControl } = input;
  requireIdentity("execution.runId", execution.runId);
  requireIdentity("execution.caseId", execution.caseId);
  requireIdentity("execution.variantId", execution.variantId);
  requireIdentity("execution.sessionId", execution.sessionId);
  const identities = [providerRun, toolRun];
  for (const observed of identities) {
    if (
      observed.runId !== execution.runId
      || observed.caseId !== execution.caseId
      || observed.variantId !== execution.variantId
      || observed.sessionId !== execution.sessionId
    ) {
      throw new FormalM2EvidenceError(
        "IDENTITY_MISMATCH",
        "execution, provider, and tool run identity/session must match exactly",
      );
    }
  }
  requireSha256("frozenControl.caseInputControlSha256", frozenControl.caseInputControlSha256);
  requireSha256("frozenControl.comparisonGroupSha256", frozenControl.comparisonGroupSha256);
  requireSha256("frozenControl.visibleAssetSetSha256", frozenControl.visibleAssetSetSha256);
  if (frozenControl.visibleAssetSetSha256 !== execution.visibleAssetSetSha256) {
    throw new FormalM2EvidenceError(
      "FROZEN_CONTROL_INVALID",
      "frozen visible asset set does not match the execution preflight receipt",
    );
  }
  if (
    execution.formalMetricEligible !== false
    || execution.preparationBinding.freshLocalState !== true
    || execution.preparationBinding.inheritedHistory !== false
  ) {
    throw new FormalM2EvidenceError(
      "IDENTITY_MISMATCH",
      "execution receipt does not retain the required fresh pre-scoring state",
    );
  }
  if (!providerRun.formalProviderEvidenceEligible || providerRun.issues.length > 0) {
    throw new FormalM2EvidenceError(
      "OBSERVER_EVIDENCE_BLOCKED",
      "provider run is not sealed formal evidence",
    );
  }
  if (!toolRun.formalTraceEligible || toolRun.issues.length > 0) {
    throw new FormalM2EvidenceError(
      "OBSERVER_EVIDENCE_BLOCKED",
      "tool observer run is not sealed formal evidence",
    );
  }
}

function assertFormalUsageContract(
  requestId: string,
  usage: NonNullable<CollectedProviderRequest["providerUsageNormalization"]>,
): void {
  const identityMatches = usage.provider === FORMAL_PROVIDER_USAGE_CONTRACT.provider
    && usage.schema === FORMAL_PROVIDER_USAGE_CONTRACT.schema
    && usage.apiVersion === FORMAL_PROVIDER_USAGE_CONTRACT.apiVersion
    && usage.adapterVersion === FORMAL_PROVIDER_USAGE_CONTRACT.adapterVersion
    && sameStringSet(usage.requiredFields, FORMAL_PROVIDER_USAGE_CONTRACT.requiredFields)
    && sameStringSet(usage.unsupportedFields, FORMAL_PROVIDER_USAGE_CONTRACT.unsupportedFields);
  if (!identityMatches || !usage.ok || usage.usage?.usageCompleteForRequiredFields !== true) {
    throw new FormalM2EvidenceError(
      "PROVIDER_USAGE_MISSING",
      `provider usage is missing, blocked, or outside the frozen contract for ${requestId}`,
    );
  }
}

function validateProviderWindows(
  execution: FormalExecutionReceipt,
  providerRun: CollectedProviderRun,
): ValidatedProviderRequest[] {
  if (providerRun.requests.length === 0) {
    throw new FormalM2EvidenceError(
      "PROVIDER_REQUEST_INVALID",
      "formal M2 requires at least one provider request",
    );
  }
  const executionStart = requireMicros(
    "execution.startedWallTimeUnixMicros",
    execution.startedWallTimeUnixMicros,
  );
  const executionFinish = requireMicros(
    "execution.finishedWallTimeUnixMicros",
    execution.finishedWallTimeUnixMicros,
  );
  if (executionFinish <= executionStart) {
    throw new FormalM2EvidenceError(
      "CLOCK_OR_WINDOW_INVALID",
      "execution wall-time window must be strictly increasing",
    );
  }

  const requestIds = new Set<string>();
  const validated: ValidatedProviderRequest[] = [];
  for (const [ordinal, request] of providerRun.requests.entries()) {
    const requestId = requireIdentity("provider request correlationId", request.correlationId);
    if (requestIds.has(requestId)) {
      throw new FormalM2EvidenceError(
        "PROVIDER_REQUEST_INVALID",
        `duplicate provider request identity: ${requestId}`,
      );
    }
    requestIds.add(requestId);
    const requestSequence = requireSafeOrdinal("requestSequence", request.requestSequence);
    const requestTime = requireMicros(
      `${requestId}.requestWallTimeUnixMicros`,
      request.requestWallTimeUnixMicros,
    );
    if (
      request.completionSequence === null
      || request.completionWallTimeUnixMicros === null
      || request.latencyMs === null
    ) {
      throw new FormalM2EvidenceError(
        "PROVIDER_COMPLETION_MISSING",
        `provider completion evidence is missing for ${requestId}`,
      );
    }
    const completionSequence = requireSafeOrdinal(
      "completionSequence",
      request.completionSequence,
    );
    const completionTime = requireMicros(
      `${requestId}.completionWallTimeUnixMicros`,
      request.completionWallTimeUnixMicros,
    );
    if (
      requestTime < executionStart
      || completionTime < requestTime
      || completionTime > executionFinish
      || completionSequence <= requestSequence
    ) {
      throw new FormalM2EvidenceError(
        "CLOCK_OR_WINDOW_INVALID",
        `request/completion clocks are not strictly ordered for ${requestId}`,
      );
    }
    const exactLatencyMs = Math.ceil(Number(completionTime - requestTime) / 1_000);
    if (!Number.isSafeInteger(request.latencyMs) || request.latencyMs !== exactLatencyMs) {
      throw new FormalM2EvidenceError(
        "CLOCK_OR_WINDOW_INVALID",
        `provider latency is not the exact observed completion delta for ${requestId}`,
      );
    }
    if (request.status === null || request.status < 200 || request.status >= 300) {
      throw new FormalM2EvidenceError(
        "PROVIDER_COMPLETION_MISSING",
        `provider completion is not successful for ${requestId}`,
      );
    }
    if (request.providerUsageNormalization === null) {
      throw new FormalM2EvidenceError(
        "PROVIDER_USAGE_MISSING",
        `provider usage is missing for ${requestId}`,
      );
    }
    assertFormalUsageContract(requestId, request.providerUsageNormalization);
    requireSha256(`${requestId}.rawBodySha256`, request.rawBodySha256);
    requireSafeOrdinal(
      `${requestId}.providerToolDefinitionCount`,
      request.providerToolDefinitionCount,
    );
    const previous = validated.at(-1);
    if (
      previous !== undefined
      && (
        previous.requestTime > requestTime
        || previous.request.requestSequence >= requestSequence
      )
    ) {
      throw new FormalM2EvidenceError(
        "CLOCK_OR_WINDOW_INVALID",
        `provider response windows overlap or regress before request ordinal ${ordinal}`,
      );
    }
    validated.push({
      request,
      requestTime,
      completionTime,
      completionSequence,
      completionWallTimeUnixMicros: request.completionWallTimeUnixMicros,
      usage: request.providerUsageNormalization,
    });
  }
  return validated;
}

function validateCaptureAcrossRequests(
  requests: readonly ValidatedProviderRequest[],
  capture: ProductionInjectionCaptureV2,
): void {
  const first = requests[0].request;
  for (const { request } of requests) {
    if (
      request.providerVisibleInjection === null
      || request.injectionAudit === null
      || request.providerVisibleInjection !== first.providerVisibleInjection
      || request.productionSourceEvidence === null
      || request.productionSourceEvidence.sourceManifestSha256
        !== capture.manifest.productionSourceManifestSha256
      || request.injectionAudit.injectionSha256 !== capture.manifest.providerInjectionSha256
      || request.injectionAudit.injectionTokenCount !== capture.manifest.providerInjectionTokens
    ) {
      throw new FormalM2EvidenceError(
        "PROVIDER_REQUEST_INVALID",
        "provider-visible injection or audit changed across one formal run",
      );
    }
  }
}

function attributeAttempts(
  execution: FormalExecutionReceipt,
  toolRun: CollectedObservedRun,
  requests: readonly ValidatedProviderRequest[],
): Readonly<{
  windows: FormalM2AttributionWindow[];
  attempts: FormalM2AttributedAttempt[];
}> {
  const executionFinish = requireMicros(
    "execution.finishedWallTimeUnixMicros",
    execution.finishedWallTimeUnixMicros,
  );
  const observedIds = toolRun.entries.map((entry) => entry.correlationId);
  const evidenceIds = toolRun.entryEvidence.map((entry) => entry.event.correlationId);
  if (
    observedIds.length !== evidenceIds.length
    || canonicalJson(observedIds) !== canonicalJson(evidenceIds)
    || new Set(evidenceIds).size !== evidenceIds.length
  ) {
    throw new FormalM2EvidenceError(
      "OBSERVER_EVIDENCE_BLOCKED",
      "tool entries and timed entry evidence must be one-to-one and ordered",
    );
  }

  const previousSourceTime = new Map<string, bigint>();
  const previousSourceSequence = new Map<string, number>();
  const byRequest = new Map<number, FormalM2AttributedAttempt[]>();
  for (const entry of toolRun.entryEvidence) {
    const attemptId = requireIdentity("tool entry correlationId", entry.event.correlationId);
    const entryTime = requireMicros(
      `${attemptId}.entryWallTimeUnixMicros`,
      entry.wallTimeUnixMicros,
    );
    const priorSourceTime = previousSourceTime.get(entry.source);
    if (priorSourceTime !== undefined && entryTime < priorSourceTime) {
      throw new FormalM2EvidenceError(
        "CLOCK_OR_WINDOW_INVALID",
        `tool observer timestamp regressed for ${entry.source}`,
      );
    }
    const previousSequence = previousSourceSequence.get(entry.source);
    if (previousSequence !== undefined && entry.sequence <= previousSequence) {
      throw new FormalM2EvidenceError(
        "CLOCK_OR_WINDOW_INVALID",
        `tool observer sequence regressed for ${entry.source}`,
      );
    }
    previousSourceSequence.set(entry.source, entry.sequence);
    previousSourceTime.set(entry.source, entryTime);
    const causalCandidates = requests.flatMap((request, requestOrdinal) => {
      const nextRequestTime = requests[requestOrdinal + 1]?.requestTime ?? executionFinish;
      return request.requestTime <= entryTime && entryTime <= nextRequestTime
        ? [{ request, requestOrdinal }]
        : [];
    });
    const strictCandidates = causalCandidates.filter(({ request, requestOrdinal }) => {
      const nextRequestTime = requests[requestOrdinal + 1]?.requestTime ?? executionFinish;
      return request.requestTime < entryTime && entryTime < nextRequestTime;
    });
    if (strictCandidates.length > 1 || causalCandidates.length === 0) {
      throw new FormalM2EvidenceError(
        "ATTRIBUTION_AMBIGUOUS",
        `tool entry ${attemptId} has no unique causal provider response window`,
      );
    }
    // With millisecond production clocks, tool/next-request may share one
    // timestamp. That boundary is causally owned by the preceding request
    // window (the lowest ordinal), not treated as fabricated precision. The
    // completion observer is intentionally not a lower bound: response teeing
    // can record completion after the client has already invoked a tool.
    const owner = strictCandidates[0] ?? causalCandidates[0];
    const phaseId = `task-model:${owner.requestOrdinal}`;
    const attempt: FormalM2AttributedAttempt = {
      attemptId,
      source: entry.source,
      observerSequence: entry.sequence,
      entryWallTimeUnixMicros: entry.wallTimeUnixMicros,
      requestId: owner.request.request.correlationId,
      requestOrdinal: owner.requestOrdinal,
      phaseId,
    };
    const current = byRequest.get(owner.requestOrdinal) ?? [];
    current.push(attempt);
    byRequest.set(owner.requestOrdinal, current);
  }

  const windows = requests.map(({ request, completionSequence, completionWallTimeUnixMicros }, ordinal) => {
    const observedAttemptIds = (byRequest.get(ordinal) ?? []).map((attempt) => attempt.attemptId);
    const phaseType: M2PhaseType = ordinal === 0
      ? "initial"
      : observedAttemptIds.length > 0
        ? "executor"
        : "followup";
    return {
      requestId: request.correlationId,
      requestOrdinal: ordinal,
      requestSequence: request.requestSequence,
      requestWallTimeUnixMicros: request.requestWallTimeUnixMicros,
      completionSequence,
      completionWallTimeUnixMicros,
      nextRequestWallTimeUnixMicros: requests[ordinal + 1]?.request.requestWallTimeUnixMicros
        ?? execution.finishedWallTimeUnixMicros,
      observedAttemptIds,
      phaseId: `task-model:${ordinal}`,
      phaseType,
    };
  });
  return {
    windows,
    attempts: windows.flatMap((window) => byRequest.get(window.requestOrdinal) ?? []),
  };
}

function traceIdFor(execution: FormalExecutionReceipt): string {
  return `provider-trace:${canonicalSha256({
    runId: execution.runId,
    sessionId: execution.sessionId,
    runNamespace: execution.preparationBinding.runNamespace,
  })}`;
}

function assertPreGoldCanonical(preGold: FormalM2PreGoldEvidence): void {
  const { canonicalSha256: recorded, ...withoutSha } = preGold;
  if (canonicalSha256(withoutSha) !== recorded) {
    throw new FormalM2EvidenceError(
      "PREGOLD_CANONICAL_MISMATCH",
      "pre-Gold evidence canonical root does not match its contents",
    );
  }
}

export function buildFormalM2PreGoldEvidence(
  input: BuildFormalM2PreGoldEvidenceInput,
): FormalM2PreGoldEvidence {
  assertRunIdentity(input);
  const requests = validateProviderWindows(input.execution, input.providerRun);
  const firstRequest = requests[0].request;
  if (
    firstRequest.providerVisibleInjection === null
    || firstRequest.injectionAudit === null
    || firstRequest.productionSourceEvidence === null
  ) {
    throw new FormalM2EvidenceError(
      "PROVIDER_REQUEST_INVALID",
      "the first provider request lacks captured injection/audit evidence",
    );
  }
  const observedTokenCapture = captureProductionInjectionV2({
    runId: input.execution.runId,
    variantId: input.execution.variantId,
    providerVisibleInjection: firstRequest.providerVisibleInjection,
    providerAudit: firstRequest.injectionAudit,
    productionSourceManifest: firstRequest.productionSourceEvidence.sourceManifest,
    tokenizer: input.tokenizer ?? DEFAULT_TOKENIZER,
  });
  const tokenCapture = finalizeProductionInjectionCaptureV2({
    capture: observedTokenCapture,
    providerSourceEvidence: firstRequest.productionSourceEvidence,
    tokenizer: input.tokenizer ?? DEFAULT_TOKENIZER,
  });
  validateCaptureAcrossRequests(requests, tokenCapture);
  const attribution = attributeAttempts(input.execution, input.toolRun, requests);
  const traceId = traceIdFor(input.execution);
  const requestUsageLedger = buildRequestUsageLedger({
    runId: input.execution.runId,
    traceId,
    requests: requests.map(({ request, usage }, requestOrdinal) => ({
      runId: input.execution.runId,
      traceId,
      requestId: request.correlationId,
      observedAttemptIds: attribution.windows[requestOrdinal].observedAttemptIds,
      requestOrdinal,
      phaseId: attribution.windows[requestOrdinal].phaseId,
      component: "task_model",
      phaseType: attribution.windows[requestOrdinal].phaseType,
      promptSha256: request.rawBodySha256,
      providerToolDefinitionCount: request.providerToolDefinitionCount,
      injectionTokensO200k: tokenCapture.tokenLedger.totalInjectionTokens,
      discoveryResultTokens: null,
      toolResultContextTokens: null,
      latencyMs: request.latencyMs!,
      usage,
    })),
  });
  if (requestUsageLedger.status !== "ready") {
    throw new FormalM2EvidenceError(
      "REQUEST_USAGE_LEDGER_BLOCKED",
      `formal request usage ledger is blocked: ${requestUsageLedger.blockers.join(",")}`,
    );
  }
  const firstUsage = requests[0].usage;
  const providerRequestSha256 = canonicalSha256(requests.map(({ request }, ordinal) => ({
    ordinal,
    rawBodySha256: request.rawBodySha256,
  })));
  const runIsolation = buildRunIsolationEvidence({
    runId: input.execution.runId,
    runNamespace: input.execution.preparationBinding.runNamespace,
    caseId: input.execution.caseId,
    variantId: input.execution.variantId,
    repeatIndex: input.execution.repeat,
    caseInputControlSha256: input.frozenControl.caseInputControlSha256,
    comparisonGroupSha256: input.frozenControl.comparisonGroupSha256,
    providerRequestSha256,
    staticPromptSha256: tokenCapture.tokenLedger.toolDescriptionStaticSha256,
    execution: input.execution.executionIdentity,
    counterfactualRole: null,
    session: { id: input.execution.sessionId, fresh: true },
    memoryProxyContext: {
      id: input.execution.preparationBinding.memoryProxyContextId,
      fresh: true,
    },
    snapshot: {
      id: input.execution.snapshotBinding.snapshotId,
      expectedSha256: input.execution.snapshotBinding.snapshotCanonicalSha256,
      restoredSha256: input.execution.snapshotBinding.snapshotCanonicalSha256,
      restoreSucceeded: true,
    },
    visibleAssetsSha256: input.frozenControl.visibleAssetSetSha256,
    localState: {
      pathId: input.execution.preparationBinding.localStateId,
      fresh: input.execution.preparationBinding.freshLocalState,
      inheritedHistory: input.execution.preparationBinding.inheritedHistory,
    },
    usage: firstUsage,
  });
  if (runIsolation.isolationStatus !== "ready") {
    throw new FormalM2EvidenceError(
      "RUN_ISOLATION_BLOCKED",
      `formal run isolation is blocked: ${runIsolation.blockers.join(",")}`,
    );
  }

  const withoutSha = {
    schemaVersion: "task1.formal-m2-pregold-evidence.v1" as const,
    measurementModuleId: "M2" as const,
    runId: input.execution.runId,
    caseId: input.execution.caseId,
    variantId: input.execution.variantId,
    traceId,
    attributionContractId: FORMAL_M2_ATTRIBUTION_CONTRACT_ID,
    frozenControl: { ...input.frozenControl },
    executionStartedWallTimeUnixMicros: input.execution.startedWallTimeUnixMicros,
    executionFinishedWallTimeUnixMicros: input.execution.finishedWallTimeUnixMicros,
    attributionWindows: attribution.windows,
    attributedAttempts: attribution.attempts,
    tokenCapture,
    requestUsageLedger,
    runIsolation,
  };
  return canonicalJsonClone({
    ...withoutSha,
    canonicalSha256: canonicalSha256(withoutSha),
  }) as unknown as FormalM2PreGoldEvidence;
}

function validateScoreBoundary(
  preGold: FormalM2PreGoldEvidence,
  score: CaseChainScoreV2,
): void {
  if (
    score.evaluationSchemaVersion !== 2
    || score.runId !== preGold.runId
    || score.caseId !== preGold.caseId
    || score.variantId !== preGold.variantId
  ) {
    throw new FormalM2EvidenceError(
      "SCORE_IDENTITY_MISMATCH",
      "score identity must match the sealed pre-Gold run exactly",
    );
  }
  if (
    !Number.isSafeInteger(score.observedAttemptCount)
    || score.observedAttemptCount !== preGold.attributedAttempts.length
    || !Number.isSafeInteger(score.evaluationPrefixAttemptCount)
    || score.evaluationPrefixAttemptCount < 0
    || score.evaluationPrefixAttemptCount > score.observedAttemptCount
  ) {
    throw new FormalM2EvidenceError(
      "SCORE_BOUNDARY_INVALID",
      "score attempt counts do not bind the complete attributed executor trace",
    );
  }
  if (
    score.behaviorValidTerminalAttemptIndex !== null
    && (
      !Number.isSafeInteger(score.behaviorValidTerminalAttemptIndex)
      || score.behaviorValidTerminalAttemptIndex < 0
      || score.behaviorValidTerminalAttemptIndex >= score.observedAttemptCount
      || score.behaviorValidTerminalAttemptIndex !== score.evaluationPrefixAttemptCount - 1
    )
  ) {
    throw new FormalM2EvidenceError(
      "SCORE_BOUNDARY_INVALID",
      "behavior-valid terminal must be the final attempt in the evaluation prefix",
    );
  }
  if (
    score.completeChainSuccess === true
    && (
      score.evaluationPrefixAttemptCount === 0
      || score.behaviorValidTerminalAttemptIndex === null
      || score.terminalAttemptIndex !== score.evaluationPrefixAttemptCount - 1
    )
  ) {
    throw new FormalM2EvidenceError(
      "SCORE_BOUNDARY_INVALID",
      "successful score must end its evaluation prefix at the terminal attempt",
    );
  }
}

function buildM0Boundary(
  preGold: FormalM2PreGoldEvidence,
  score: CaseChainScoreV2,
): M0EvaluationBoundaryFacts {
  const evaluationAttempts = preGold.attributedAttempts.slice(
    0,
    score.evaluationPrefixAttemptCount,
  );
  const evaluationAttemptPrefix: M0AttemptBoundaryFact[] = evaluationAttempts.map((attempt) => ({
    traceId: preGold.traceId,
    requestId: attempt.requestId,
    attemptId: attempt.attemptId,
    phaseId: attempt.phaseId,
  }));
  const terminalReached = score.completeChainSuccess === true;
  const behaviorValidTerminalAttempt = score.behaviorValidTerminalAttemptIndex === null
    ? undefined
    : evaluationAttempts[score.behaviorValidTerminalAttemptIndex];
  const successfulTerminalAttempt = terminalReached
    ? behaviorValidTerminalAttempt
    : undefined;
  const horizonWindow = behaviorValidTerminalAttempt === undefined
    ? preGold.attributionWindows.at(-1)
    : preGold.attributionWindows[behaviorValidTerminalAttempt.requestOrdinal];
  if (horizonWindow === undefined) {
    throw new FormalM2EvidenceError(
      "SCORE_BOUNDARY_INVALID",
      "M0 horizon cannot be resolved from the sealed request windows",
    );
  }
  let timeToTerminalMs: number | null = null;
  if (successfulTerminalAttempt !== undefined) {
    const startedAt = requireMicros(
      "preGold.executionStartedWallTimeUnixMicros",
      preGold.executionStartedWallTimeUnixMicros,
    );
    const completedAt = requireMicros(
      "terminal tool entry wall time",
      successfulTerminalAttempt.entryWallTimeUnixMicros,
    );
    if (completedAt < startedAt) {
      throw new FormalM2EvidenceError(
        "CLOCK_OR_WINDOW_INVALID",
        "terminal tool entry must not precede execution start",
      );
    }
    timeToTerminalMs = Math.ceil(Number(completedAt - startedAt) / 1_000);
  }
  return {
    status: "observed",
    runId: preGold.runId,
    traceId: preGold.traceId,
    evaluationPrefixSha256: canonicalSha256(evaluationAttemptPrefix),
    evaluationAttemptPrefix,
    evaluationHorizonRequestId: horizonWindow.requestId,
    evaluationHorizonPhaseId: horizonWindow.phaseId,
    terminalBoundaryGivenSuccess: successfulTerminalAttempt === undefined
      ? null
      : {
        traceId: preGold.traceId,
        requestId: successfulTerminalAttempt.requestId,
        phaseId: successfulTerminalAttempt.phaseId,
        terminalAttemptId: successfulTerminalAttempt.attemptId,
      },
    modelRoundsToTerminal: successfulTerminalAttempt === undefined
      ? null
      : successfulTerminalAttempt.requestOrdinal + 1,
    tdaiCallCount: evaluationAttemptPrefix.length,
    timeToTerminalMs,
    terminalReached,
  };
}

export function finalizeFormalM2Evidence(
  input: FinalizeFormalM2EvidenceInput,
): FinalFormalM2Evidence {
  assertPreGoldCanonical(input.preGold);
  validateScoreBoundary(input.preGold, input.score);
  if (input.preGold.requestUsageLedger.status !== "ready") {
    throw new FormalM2EvidenceError(
      "REQUEST_USAGE_LEDGER_BLOCKED",
      "sealed pre-Gold request usage ledger is blocked",
    );
  }
  const m0EvaluationBoundary = buildM0Boundary(input.preGold, input.score);
  const usageHorizon = accumulateRequestUsageToM0Horizon(
    input.preGold.requestUsageLedger.ledger,
    m0EvaluationBoundary,
  );
  const eligibility = buildM2EligibilityEvidence({
    formalDataState: "frozen",
    evaluationLayer: "real-chain",
    requestUsageLedger: input.preGold.requestUsageLedger,
    usageHorizon,
    tokenLedger: input.preGold.tokenCapture.tokenLedger,
    runIsolation: input.preGold.runIsolation,
    comparison: { purpose: "none" },
    prepareOnly: {
      enabled: false,
      servicesStarted: false,
      codexProcessesStarted: 0,
      providerRequestsIssued: 0,
      authFilesRead: false,
      authFilesCopied: false,
    },
    m0EvaluationBoundary,
  });
  const withoutSha = {
    schemaVersion: "task1.formal-m2-evidence.v1" as const,
    measurementModuleId: "M2" as const,
    runId: input.preGold.runId,
    caseId: input.preGold.caseId,
    variantId: input.preGold.variantId,
    traceId: input.preGold.traceId,
    attributionContractId: FORMAL_M2_ATTRIBUTION_CONTRACT_ID,
    preGoldCanonicalSha256: input.preGold.canonicalSha256,
    scoreCanonicalSha256: canonicalSha256(input.score),
    tokenCapture: input.preGold.tokenCapture,
    requestUsageLedger: input.preGold.requestUsageLedger,
    runIsolation: input.preGold.runIsolation,
    m0EvaluationBoundary,
    usageHorizon,
    eligibility,
  };
  return canonicalJsonClone({
    ...withoutSha,
    canonicalSha256: canonicalSha256(withoutSha),
  }) as unknown as FinalFormalM2Evidence;
}
