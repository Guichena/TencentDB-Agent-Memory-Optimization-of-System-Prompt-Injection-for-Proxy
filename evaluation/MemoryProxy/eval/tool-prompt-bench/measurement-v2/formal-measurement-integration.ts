import type { FormalExecutionReceipt } from "../formal-execution-runner.js";
import { FORMAL_EPISODE_POLICY } from "../formal-episode-policy.js";
import type { PrivateMeasurementSplitData } from "../formal-runtime/private-loader.js";
import { aggregateCaseChainFacts } from "./aggregate.js";
import { canonicalJsonV2 } from "./canonical-json.js";
import {
  finalizeFormalM2Evidence,
  type FinalFormalM2Evidence,
  type FormalM2PreGoldEvidence,
} from "./formal-m2-evidence-builder.js";
import {
  projectObservedBridgeTrace,
  type ObservedBridgeTraceEvidence,
} from "./observed-bridge-trace-projector.js";
import type {
  CollectedObservedCampaign,
  CollectedObservedRun,
} from "./observed-event-collector.js";
import type {
  CollectedProviderCampaign,
  CollectedProviderRun,
} from "./provider-evidence-collector.js";
import type { ValidatedPairContractV2 } from "./pair-contract.js";
import {
  scorePairV2,
  summarizePairScoresV2,
  type IntegratedCaseOutcomeForPairV2,
  type PairScoreSummaryV2,
  type PairSummaryCampaignV2,
} from "./pair-scorer.js";
import { scoreCaseChain } from "./scorer.js";
import type {
  CaseChainAggregateV2,
  CaseChainScoreV2,
  PrivateChainGoldV2,
  RawTraceObservationV2,
  RuntimeToolContractV2,
} from "./types.js";

export const FORMAL_MEASUREMENT_INTEGRATION_SCHEMA =
  "task1.formal-measurement-integration.v2" as const;

export function applyFormalEpisodeHorizon(
  observation: RawTraceObservationV2,
  expectation: "tool" | "no-tool",
): RawTraceObservationV2 {
  if (expectation === "no-tool") return observation;
  let executorBoundCount = 0;
  const endIndex = observation.attempts.findIndex((attempt) => {
    if (attempt.executorBound) executorBoundCount += 1;
    return executorBoundCount === FORMAL_EPISODE_POLICY.tdaiAttemptHorizon;
  });
  if (endIndex < 0 || endIndex === observation.attempts.length - 1) return observation;
  return Object.freeze({
    ...observation,
    attempts: Object.freeze(observation.attempts.slice(0, endIndex + 1)),
  });
}

export interface FormalPairRunEvidenceBinding {
  readonly runId: string;
  readonly repeatId: string;
  readonly rawEvidenceArtifactRef: string;
  readonly rawEvidenceArtifactSha256: string;
  readonly localStateId: string;
}

/**
 * Pre-registered M1 inputs. Integration supplies only M0 facts and execution
 * identity; it must not synthesize pair slots or scoring policy after a run.
 */
export interface FormalPairScoringInput {
  readonly campaign: PairSummaryCampaignV2;
  readonly validatedPairs: readonly ValidatedPairContractV2[];
  readonly runEvidence: readonly FormalPairRunEvidenceBinding[];
}

export class FormalPairScoringRequiredError extends Error {
  readonly code = "FORMAL_PAIR_SCORING_REQUIRED" as const;

  constructor() {
    super(
      "FORMAL_PAIR_SCORING_REQUIRED: private measurement contains Pair contracts but no frozen M1 pairScoring input was provided",
    );
    this.name = "FormalPairScoringRequiredError";
  }
}

export interface IntegrateFormalMeasurementInput {
  readonly campaignId: string;
  readonly executions: readonly FormalExecutionReceipt[];
  readonly toolCampaign: CollectedObservedCampaign;
  readonly providerCampaign: CollectedProviderCampaign;
  readonly privateMeasurement: PrivateMeasurementSplitData;
  readonly m2PreGoldEvidence: readonly FormalM2PreGoldEvidence[];
  readonly pairScoring?: FormalPairScoringInput;
}

export interface IntegratedFormalRun {
  readonly runId: string;
  readonly caseId: string;
  readonly variantId: string;
  readonly repeat: number;
  readonly sessionId: string;
  readonly formalMetricEligible: boolean;
  readonly exclusionReasons: readonly string[];
  readonly score: CaseChainScoreV2 | null;
  readonly rawToolEvidence: ObservedBridgeTraceEvidence | null;
  readonly m2Evidence: FinalFormalM2Evidence | null;
  readonly injectionTokens: number | null;
  readonly toolDescriptionStaticTokens: number | null;
  readonly providerUsage: CollectedProviderRun["providerUsage"];
}

export interface FormalTokenAggregate {
  readonly runCount: number;
  readonly totalInjectionTokens: {
    readonly sum: number;
    readonly min: number | null;
    readonly max: number | null;
    readonly mean: number | null;
  };
  readonly toolDescriptionStaticTokens: {
    readonly sum: number;
    readonly min: number | null;
    readonly max: number | null;
    readonly mean: number | null;
  };
  readonly components: {
    readonly staticTemplateTokens: number;
    readonly executionContractTokens: number;
    readonly runtimeBindingTokens: number;
    readonly dynamicAssetTokens: number;
  };
  readonly providerUsageToEvaluationHorizon: {
    readonly providerTotalInputTokens: number | null;
    readonly ordinaryInputTokens: number | null;
    readonly cacheReadInputTokens: number | null;
    readonly cacheWriteInputTokens: number | null;
    readonly outputTokens: number | null;
    readonly reasoningOrThinkingTokens: number | null;
  };
}

export interface FormalMeasurementIntegrationResult {
  readonly schemaVersion: typeof FORMAL_MEASUREMENT_INTEGRATION_SCHEMA;
  readonly campaignId: string;
  readonly split: "dev" | "hidden_test";
  readonly variantId: string;
  readonly formalCampaignEligible: boolean;
  readonly eligibleRunCount: number;
  readonly excludedRunCount: number;
  readonly runs: readonly IntegratedFormalRun[];
  readonly aggregate: CaseChainAggregateV2;
  readonly paired: PairScoreSummaryV2 | null;
  readonly tokens: FormalTokenAggregate;
  readonly privateMeasurementHashes: PrivateMeasurementSplitData["hashes"];
}

/**
 * Private, post-seal integration. Eligibility is decided before M0 sees Gold;
 * excluded traces never enter metric numerators or denominators.
 */
export function integrateFormalMeasurement(
  input: IntegrateFormalMeasurementInput,
): FormalMeasurementIntegrationResult {
  const campaignId = nonBlank("campaignId", input.campaignId);
  if (input.toolCampaign.campaignId !== campaignId) {
    throw new Error("tool campaign id does not match integration campaign");
  }
  if (input.providerCampaign.campaignId !== campaignId) {
    throw new Error("provider campaign id does not match integration campaign");
  }
  if (input.executions.length === 0) throw new Error("formal integration requires executions");
  const variantIds = new Set(input.executions.map((run) => run.variantId));
  if (variantIds.size !== 1) throw new Error("one formal integration campaign must contain one variant");
  const variantId = [...variantIds][0];
  const executions = uniqueBy(input.executions, (run) => run.runId, "execution runId");
  const toolRuns = uniqueBy(input.toolCampaign.runs, (run) => run.runId, "tool runId");
  const providerRuns = uniqueBy(input.providerCampaign.runs, (run) => run.runId, "provider runId");
  const m2PreGoldByRun = uniqueBy(
    input.m2PreGoldEvidence,
    (run) => run.runId,
    "M2 pre-Gold runId",
  );
  for (const runId of m2PreGoldByRun.keys()) {
    if (!executions.has(runId)) {
      throw new Error(`M2 pre-Gold evidence contains unknown execution runId: ${runId}`);
    }
  }
  const goldByCaseId = uniqueBy(
    input.privateMeasurement.gold,
    (gold) => gold.caseId,
    "private Gold caseId",
  );

  const integratedRuns = [...executions.values()].map((execution): IntegratedFormalRun => {
    const toolRun = toolRuns.get(execution.runId);
    const providerRun = providerRuns.get(execution.runId);
    const m2PreGold = m2PreGoldByRun.get(execution.runId);
    const gold = goldByCaseId.get(execution.caseId);
    const reasons = eligibilityReasons(
      execution,
      toolRun,
      providerRun,
      m2PreGold,
      gold,
      input.toolCampaign,
      input.providerCampaign,
    );
    if (reasons.length > 0 || !toolRun || !providerRun || !m2PreGold || !gold) {
      return {
        runId: execution.runId,
        caseId: execution.caseId,
        variantId: execution.variantId,
        repeat: execution.repeat,
        sessionId: execution.sessionId,
        formalMetricEligible: false,
        exclusionReasons: reasons,
        score: null,
        rawToolEvidence: null,
        m2Evidence: null,
        injectionTokens: providerRun?.injection?.tokens ?? null,
        toolDescriptionStaticTokens: m2PreGold?.tokenCapture.tokenLedger
          .toolDescriptionStaticTokens ?? null,
        providerUsage: providerRun?.providerUsage ?? null,
      };
    }

    const projected = projectObservedBridgeTrace({
      runId: execution.runId,
      caseId: execution.caseId,
      variantId: execution.variantId,
      activeSessionId: execution.sessionId,
      turnCompletion: { outcome: "completed" },
      entries: toolRun.entries,
      completions: toolRun.completions,
    });
    const scoredObservation = applyFormalEpisodeHorizon(projected.observation, gold.expectation);
    const score = scoreCaseChain({
      observation: scoredObservation,
      gold: gold as unknown as PrivateChainGoldV2,
      runtimeContracts: input.privateMeasurement.runtimeContracts as unknown as readonly RuntimeToolContractV2[],
    });
    const m2Evidence = finalizeFormalM2Evidence({ preGold: m2PreGold, score });
    const m2Reasons = m2Evidence.eligibility.m2EvidenceStatus === "ready_for_integration"
      ? []
      : m2Evidence.eligibility.blockers.map((blocker) => `m2_${blocker.toLowerCase()}`);
    const exclusionReasons = [
      ...m2Reasons,
      ...(hasInfrastructureFailureWithinEvaluationHorizon(projected.observation, score)
        ? ["tool_runtime_infrastructure_failure"]
        : []),
    ];
    return {
      runId: execution.runId,
      caseId: execution.caseId,
      variantId: execution.variantId,
      repeat: execution.repeat,
      sessionId: execution.sessionId,
      formalMetricEligible: exclusionReasons.length === 0,
      exclusionReasons,
      score,
      rawToolEvidence: projected.rawEvidence,
      m2Evidence,
      injectionTokens: m2Evidence.tokenCapture.tokenLedger.totalInjectionTokens,
      toolDescriptionStaticTokens: m2Evidence.tokenCapture.tokenLedger
        .toolDescriptionStaticTokens,
      providerUsage: providerRun.providerUsage,
    };
  });

  const eligibleScores = integratedRuns.flatMap((run) => (
    run.formalMetricEligible && run.score ? [run.score] : []
  ));
  const aggregate = aggregateCaseChainFacts(eligibleScores);
  const paired = integrateFormalPairScores(
    integratedRuns,
    input.privateMeasurement,
    input.pairScoring,
  );
  const tokens = aggregateTokens(integratedRuns);
  const excludedRunCount = integratedRuns.filter((run) => !run.formalMetricEligible).length;
  return deepFreeze({
    schemaVersion: FORMAL_MEASUREMENT_INTEGRATION_SCHEMA,
    campaignId,
    split: input.privateMeasurement.split,
    variantId,
    formalCampaignEligible: excludedRunCount === 0
      && input.toolCampaign.formalCampaignEligible
      && input.providerCampaign.formalCampaignEligible
      && (paired === null || paired.campaignEligibility === "eligible"),
    eligibleRunCount: integratedRuns.length - excludedRunCount,
    excludedRunCount,
    runs: integratedRuns,
    aggregate,
    paired,
    tokens,
    privateMeasurementHashes: input.privateMeasurement.hashes,
  });
}

function eligibilityReasons(
  execution: FormalExecutionReceipt,
  toolRun: CollectedObservedRun | undefined,
  providerRun: CollectedProviderRun | undefined,
  m2PreGold: FormalM2PreGoldEvidence | undefined,
  gold: PrivateMeasurementSplitData["gold"][number] | undefined,
  toolCampaign: CollectedObservedCampaign,
  providerCampaign: CollectedProviderCampaign,
): string[] {
  const reasons: string[] = [];
  if (!toolCampaign.formalCampaignEligible) reasons.push("tool_campaign_ineligible");
  if (!providerCampaign.formalCampaignEligible) reasons.push("provider_campaign_ineligible");
  if (execution.schemaVersion !== "task1.formal-execution-receipt.v1") {
    reasons.push("execution_receipt_schema_mismatch");
  }
  if (execution.process.infrastructureError !== null
    || execution.process.exitCode !== 0
    || execution.process.timedOut) {
    reasons.push("execution_process_ineligible");
  }
  if (execution.proxyInstanceId !== toolCampaign.proxyProcessInstanceId
    || execution.proxyInstanceId !== providerCampaign.proxyProcessInstanceId) {
    reasons.push("proxy_instance_mismatch");
  }
  if (execution.knowledgeInstanceId !== toolCampaign.knowledgeProcessInstanceId) {
    reasons.push("knowledge_instance_mismatch");
  }
  if (!toolRun) reasons.push("tool_run_missing");
  else {
    if (!sameRunIdentity(execution, toolRun)) reasons.push("tool_run_identity_mismatch");
    if (!toolRun.formalTraceEligible) reasons.push("tool_trace_ineligible");
  }
  if (!providerRun) reasons.push("provider_run_missing");
  else {
    if (!sameRunIdentity(execution, providerRun)) reasons.push("provider_run_identity_mismatch");
    if (!providerRun.formalProviderEvidenceEligible) reasons.push("provider_evidence_ineligible");
    if (!providerRun.injection) reasons.push("provider_injection_missing");
    if (!providerRun.providerUsage) reasons.push("provider_usage_missing");
  }
  if (!m2PreGold) reasons.push("m2_pregold_missing");
  else if (m2PreGold.runId !== execution.runId
    || m2PreGold.caseId !== execution.caseId
    || m2PreGold.variantId !== execution.variantId) {
    reasons.push("m2_pregold_identity_mismatch");
  }
  if (!gold) reasons.push("private_gold_missing");
  return [...new Set(reasons)];
}

function hasInfrastructureFailureWithinEvaluationHorizon(
  observation: RawTraceObservationV2,
  score: CaseChainScoreV2,
): boolean {
  const executorBoundPrefix = observation.attempts
    .filter((attempt) => attempt.executorBound)
    .slice(0, score.evaluationPrefixAttemptCount);
  if (executorBoundPrefix.some((attempt) => attempt.infrastructureFailure !== undefined)) {
    return true;
  }
  return score.behaviorValidTerminalAttemptIndex === null
    && (observation.infrastructureFailures?.length ?? 0) > 0;
}

function sameRunIdentity(
  execution: FormalExecutionReceipt,
  observed: Readonly<{
    runId: string;
    caseId: string;
    variantId: string;
    sessionId: string;
  }>,
): boolean {
  return observed.runId === execution.runId
    && observed.caseId === execution.caseId
    && observed.variantId === execution.variantId
    && observed.sessionId === execution.sessionId;
}

/**
 * Formal PairExact integration boundary. Pair semantics remain owned by M1:
 * this function only projects already-scored M0 facts into M1's public input.
 */
export function integrateFormalPairScores(
  runs: readonly IntegratedFormalRun[],
  privateMeasurement: PrivateMeasurementSplitData,
  pairScoring: FormalPairScoringInput | undefined,
): PairScoreSummaryV2 | null {
  if (privateMeasurement.pairs.length === 0) return null;
  if (!pairScoring) throw new FormalPairScoringRequiredError();

  const expectedSplit = privateMeasurement.split === "hidden_test" ? "hidden" : "dev";
  if (pairScoring.campaign.split !== expectedSplit) {
    throw new Error("frozen M1 pair campaign split does not match private measurement split");
  }
  if (pairScoring.campaign.frozenPairSetSha256
    !== privateMeasurement.hashes.pairCanonicalSha256) {
    throw new Error(
      "frozen M1 pair-set hash does not match private measurement Pair hash",
    );
  }
  const privatePairIds = new Set(privateMeasurement.pairs.map((pair) => pair.pairId));
  const frozenPairIds = new Set(pairScoring.campaign.expectedPairIds);
  if (frozenPairIds.size !== privatePairIds.size
    || [...privatePairIds].some((pairId) => !frozenPairIds.has(pairId))) {
    throw new Error(
      "frozen M1 pair membership does not match private measurement Pair set",
    );
  }
  const validatedByPairId = uniqueBy(
    pairScoring.validatedPairs,
    (pair) => pair.contract.pairId,
    "validated Pair contract pairId",
  );
  if (validatedByPairId.size !== privateMeasurement.pairs.length) {
    throw new Error(
      "validated M1 Pair membership does not match private Pair membership",
    );
  }
  for (const privatePair of privateMeasurement.pairs) {
    const validated = validatedByPairId.get(privatePair.pairId);
    if (!validated
      || canonicalJsonV2(validated.contract) !== canonicalJsonV2(privatePair)) {
      throw new Error(
        `validated M1 Pair contract does not match private Pair content: ${privatePair.pairId}`,
      );
    }
  }
  const evidenceByRunId = uniqueBy(
    pairScoring.runEvidence,
    (evidence) => evidence.runId,
    "formal Pair evidence runId",
  );

  const outcomesByCaseId = new Map<string, IntegratedCaseOutcomeForPairV2[]>();
  for (const run of runs) {
    const evidence = evidenceByRunId.get(run.runId);
    if (!evidence) continue;
    const outcome = projectFormalPairOutcome(run, evidence, pairScoring.campaign);
    const outcomes = outcomesByCaseId.get(run.caseId) ?? [];
    outcomes.push(outcome);
    outcomesByCaseId.set(run.caseId, outcomes);
  }

  const scores = pairScoring.campaign.frozenPairSlotManifest.slots.map((slot) => {
    if (!privatePairIds.has(slot.pairId)) {
      throw new Error(`frozen M1 pair ${slot.pairId} is absent from private measurement`);
    }
    const validated = validatedByPairId.get(slot.pairId);
    if (!validated) {
      throw new Error(`frozen M1 pair ${slot.pairId} has no validated Pair contract`);
    }
    return scorePairV2(validated, {
      positive: outcomesByCaseId.get(slot.positiveCaseId) ?? [],
      negative: outcomesByCaseId.get(slot.negativeCaseId) ?? [],
    }, {
      includeStrictPairExact: pairScoring.campaign.strictPairExactEnabled,
    });
  });

  return summarizePairScoresV2(scores, {
    campaign: pairScoring.campaign,
    includeStrictPairExact: pairScoring.campaign.strictPairExactEnabled,
  });
}

function projectFormalPairOutcome(
  run: IntegratedFormalRun,
  evidence: FormalPairRunEvidenceBinding,
  campaign: PairSummaryCampaignV2,
): IntegratedCaseOutcomeForPairV2 {
  const score = run.score;
  return {
    caseId: run.caseId,
    repeatId: evidence.repeatId,
    variantId: run.variantId,
    model: campaign.model,
    reasoningEffort: campaign.reasoningEffort,
    provider: campaign.provider,
    apiProtocol: campaign.apiProtocol,
    adapterVersion: campaign.adapterVersion,
    executionIdentitySha256: campaign.executionIdentitySha256,
    assetSnapshotSha256: campaign.assetSnapshotSha256,
    rawEvidenceArtifactRef: evidence.rawEvidenceArtifactRef,
    rawEvidenceArtifactSha256: evidence.rawEvidenceArtifactSha256,
    runId: run.runId,
    sessionId: run.sessionId,
    localStateId: evidence.localStateId,
    integrationEligible: run.formalMetricEligible,
    traceComplete: score?.traceCompleteness === true,
    completeChainSuccess: score?.completeChainSuccess === true,
    ...(typeof score?.strictChainExact === "boolean"
      ? { strictChainExact: score.strictChainExact }
      : {}),
    executorBoundAttempt: score?.triggeredAttempt === true,
    malformedTdaiDispatchIntent: score?.malformedFalseIntent === true,
    ...(score?.failureLayer ? { failureLayer: score.failureLayer } : {}),
  };
}

function aggregateTokens(runs: readonly IntegratedFormalRun[]): FormalTokenAggregate {
  const eligible = runs.filter((run) => run.formalMetricEligible);
  const m2 = eligible.map((run) => {
    if (!run.m2Evidence) {
      throw new Error(`eligible run ${run.runId} is missing final M2 evidence`);
    }
    return run.m2Evidence;
  });
  const ledgers = m2.map((evidence) => evidence.tokenCapture.tokenLedger);
  const totalInjection = ledgers.map((ledger) => ledger.totalInjectionTokens);
  const staticDescription = ledgers.map((ledger) => ledger.toolDescriptionStaticTokens);
  const horizons = m2.map((evidence) => evidence.usageHorizon.aggregatesToEvaluationHorizon);
  if (horizons.some((horizon) => horizon === null)) {
    throw new Error("eligible M2 run is missing usage aggregates to the evaluation horizon");
  }
  const readyHorizons = horizons as Array<NonNullable<(typeof horizons)[number]>>;
  return {
    runCount: eligible.length,
    totalInjectionTokens: tokenStats(totalInjection),
    toolDescriptionStaticTokens: tokenStats(staticDescription),
    components: {
      staticTemplateTokens: sumLedgerField(ledgers, "staticTemplateTokens"),
      executionContractTokens: sumLedgerField(ledgers, "executionContractTokens"),
      runtimeBindingTokens: sumLedgerField(ledgers, "runtimeBindingTokens"),
      dynamicAssetTokens: sumLedgerField(ledgers, "dynamicAssetTokens"),
    },
    providerUsageToEvaluationHorizon: {
      providerTotalInputTokens: sumNullableUsageField(readyHorizons, "providerTotalInputTokens"),
      ordinaryInputTokens: sumNullableUsageField(readyHorizons, "ordinaryInputTokens"),
      cacheReadInputTokens: sumNullableUsageField(readyHorizons, "cacheReadInputTokens"),
      cacheWriteInputTokens: sumNullableUsageField(readyHorizons, "cacheWriteInputTokens"),
      outputTokens: sumNullableUsageField(readyHorizons, "outputTokens"),
      reasoningOrThinkingTokens: sumNullableUsageField(
        readyHorizons,
        "reasoningOrThinkingTokens",
      ),
    },
  };
}

function tokenStats(values: readonly number[]): FormalTokenAggregate["totalInjectionTokens"] {
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    sum,
    min: values.length === 0 ? null : Math.min(...values),
    max: values.length === 0 ? null : Math.max(...values),
    mean: values.length === 0 ? null : sum / values.length,
  };
}

function sumLedgerField(
  ledgers: readonly FinalFormalM2Evidence["tokenCapture"]["tokenLedger"][],
  field:
    | "staticTemplateTokens"
    | "executionContractTokens"
    | "runtimeBindingTokens"
    | "dynamicAssetTokens",
): number {
  return ledgers.reduce((total, ledger) => total + ledger[field], 0);
}

function sumNullableUsageField(
  usages: readonly NonNullable<FinalFormalM2Evidence["usageHorizon"]["aggregatesToEvaluationHorizon"]>[],
  field: keyof NonNullable<FinalFormalM2Evidence["usageHorizon"]["aggregatesToEvaluationHorizon"]>,
): number | null {
  const values = usages.map((usage) => usage[field]);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return (values as number[]).reduce((total, value) => total + value, 0);
}

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = nonBlank(label, key(value));
    if (result.has(id)) throw new Error(`duplicate ${label}: ${id}`);
    result.set(id, value);
  }
  return result;
}

function nonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-blank`);
  return value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
