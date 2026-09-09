import { describe, expect, it } from "vitest";

import { countInjectionTokens } from "../../codex-runner.js";
import {
  freezeProviderPromptSourceEvidence,
  sealProductionPromptSourceManifest,
} from "../../../../../../implementations/final/MemoryProxy/src/injection/production-source.js";
import {
  FORMAL_PROMPT_FREEZE_COMMIT,
  FORMAL_PROMPT_FREEZE_TAG_OBJECT,
  type FormalExecutionReceipt,
} from "../../formal-execution-runner.js";
import type { PrivateMeasurementSplitData } from "../../formal-runtime/private-loader.js";
import type { CollectedObservedCampaign } from "../observed-event-collector.js";
import {
  FORMAL_PROVIDER_USAGE_CONTRACT,
  type CollectedProviderCampaign,
} from "../provider-evidence-collector.js";
import { normalizeProviderUsage } from "../provider-usage.js";
import {
  buildFrozenPairSlotManifestV2,
  buildFormalM2PreGoldEvidence,
  computeExpectedPairMembershipSha256V2,
  computePairScoringPolicySha256V2,
  FormalPairScoringRequiredError,
  applyFormalEpisodeHorizon,
  integrateFormalMeasurement,
  integrateFormalPairScores,
  type FormalPairScoringInput,
  type FormalM2PreGoldEvidence,
  type ValidatedPairContractV2,
  canonicalSha256,
  utf8Sha256,
} from "../index.js";
import {
  MEMORY_SEARCH_GOLD,
  NO_TOOL_GOLD,
  SYNTHETIC_RUNTIME_CONTRACTS,
} from "../synthetic-fixtures.js";

describe("formal Task 1 episode horizon", () => {
  it("allows four positive TDAI attempts while preserving the full no-tool episode", () => {
    const observation = {
      evaluationSchemaVersion: 2 as const,
      caseId: "episode-case",
      runId: "episode-run",
      variantId: "V0",
      rawTraceStatus: "complete" as const,
      attempts: Array.from({ length: 5 }, (_, index) => ({
        attemptId: `attempt-${index + 1}`,
        executorBound: true,
      })),
    };

    expect(applyFormalEpisodeHorizon(observation, "tool").attempts).toHaveLength(4);
    expect(applyFormalEpisodeHorizon(observation, "no-tool").attempts).toHaveLength(5);
  });
});

const INJECTION = [
  "<tdai_injections>",
  "<tdai_memory_tools>search memory when prior context is required</tdai_memory_tools>",
  "</tdai_injections>",
].join("\n");

function sourceEvidence(correlationId: string, rawBodySha256: string) {
  const open = "<tdai_injections>\n";
  const close = "\n</tdai_injections>";
  const inner = INJECTION.slice(open.length, -close.length);
  return freezeProviderPromptSourceEvidence({
    correlationId,
    rawBodySha256,
    sourceManifest: sealProductionPromptSourceManifest(INJECTION, [
      {
        sourceId: "test-wrapper:open",
        sourceKind: "static-tool",
        injectionBlockId: "tdai-injections-wrapper",
        text: open,
      },
      {
        sourceId: "test-memory-tools",
        sourceKind: "static-tool",
        injectionBlockId: "tdai-memory-tools",
        text: inner,
      },
      {
        sourceId: "test-wrapper:close",
        sourceKind: "static-tool",
        injectionBlockId: "tdai-injections-wrapper",
        text: close,
      },
    ]),
  });
}

function execution(
  runId: string,
  caseId: string,
  sessionId: string,
): FormalExecutionReceipt {
  const effectiveInvocationCanonical = {
    executable: "codex",
    args: ["exec", "--json", "-"],
    cwd: "D:\\formal-test-workspace",
    runtimeIdentity: {
      resolvedAuthUserId: "user-a",
      spaceId: "space-a",
      teamId: "team-a",
      agentId: "agent-a",
      taskId: `task:${caseId}`,
    },
  };
  return {
    schemaVersion: "task1.formal-execution-receipt.v1",
    formalMetricEligible: false,
    runId,
    caseId,
    variantId: "V0",
    repeat: 1,
    sessionId,
    proxyInstanceId: "proxy-a",
    knowledgeInstanceId: "knowledge-a",
    providerPromptSha256: "a".repeat(64),
    visibleAssetSetSha256: "9".repeat(64),
    preflightReceiptSha256: "b".repeat(64),
    artifactBindings: {
      runManifestFileSha256: "1".repeat(64),
      prepareCommandFileSha256: "2".repeat(64),
      providerPromptFileSha256: "3".repeat(64),
      preflightReceiptFileSha256: "4".repeat(64),
    },
    executionIdentity: {
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
      verbosity: "medium",
      codexCliVersion: "codex-cli-test",
    },
    effectiveInvocation: {
      canonical: effectiveInvocationCanonical,
      canonicalSha256: canonicalSha256(effectiveInvocationCanonical),
    },
    preparationBinding: {
      runManifestCanonicalSha256: "3".repeat(64),
      prepareCommandCanonicalSha256: "4".repeat(64),
      workspacePolicySha256: "5".repeat(64),
      runNamespace: `run:${runId}`,
      memoryProxyContextId: `proxy-context:${runId}`,
      localStateId: `local-state:${runId}`,
      freshLocalState: true,
      inheritedHistory: false,
    },
    snapshotBinding: {
      restorePlanSha256: "6".repeat(64),
      snapshotId: "snapshot-test",
      snapshotCanonicalSha256: "7".repeat(64),
      inspectEnvelopeCanonicalSha256: "8".repeat(64),
    },
    codeFreeze: {
      executionCodeCommit: "1".repeat(40),
      promptFreezeTagObject: FORMAL_PROMPT_FREEZE_TAG_OBJECT,
      promptFreezeCommit: FORMAL_PROMPT_FREEZE_COMMIT,
      promptFreezeIsAncestor: true,
      workingTreeClean: true,
    },
    startedAt: "2026-08-30T05:00:00.000Z",
    finishedAt: "2026-08-30T05:00:01.000Z",
    startedWallTimeUnixMicros: "1000000",
    finishedWallTimeUnixMicros: "2000000",
    process: {
      exitCode: 0,
      timedOut: false,
      infrastructureError: null,
      stdoutSha256: "c".repeat(64),
      stderrSha256: "d".repeat(64),
    },
    clientUsage: null,
    promptEvidenceState: "captured-by-provider-observer-pending-seal",
    providerUsageState: "captured-by-provider-observer-pending-seal",
    traceCollectionState: "pending-campaign-seal",
    episodePolicy: { additionalUserTurns: 0, tdaiAttemptHorizon: 4, wallTimeMs: 180_000 },
  };
}

const positiveExecution = execution(
  "run-positive",
  MEMORY_SEARCH_GOLD.caseId,
  "session-positive",
);
const negativeExecution = execution(
  "run-negative",
  NO_TOOL_GOLD.caseId,
  "session-negative",
);

const toolCampaign: CollectedObservedCampaign = {
  schemaVersion: "task1.observed-event-collection.v1",
  campaignId: "campaign-integration",
  proxyProcessInstanceId: "proxy-a",
  knowledgeProcessInstanceId: "knowledge-a",
  formalCampaignEligible: true,
  issues: [],
  unassignedEvents: [],
  runs: [{
    runId: positiveExecution.runId,
    caseId: positiveExecution.caseId,
    variantId: "V0",
    sessionId: positiveExecution.sessionId,
    entries: [{
      correlationId: "memory-search-a",
      family: "memory",
      endpoint: "/memory-bridge/v3/atomic/search",
      method: "POST",
      requestBody: { query: "Which database did we choose?" },
      requestBodyCapture: { outcome: "captured", rawBodySha256: "e".repeat(64) },
      correlationHeaders: { "x-conversation-id": positiveExecution.sessionId },
    }],
    completions: [{
      schemaVersion: "task1.tool-execution-completion.v1",
      correlationId: "memory-search-a",
      family: "memory",
      endpoint: "/memory-bridge/v3/atomic/search",
      method: "POST",
      outcome: "response",
      status: 200,
      responseBody: { answer: "TencentDB" },
      responseBodySha256: "f".repeat(64),
      durationMs: 2,
    }],
    entryEvidence: [{
      source: "memory-proxy",
      sequence: 1,
      wallTimeUnixMicros: "1300000",
      event: {
        correlationId: "memory-search-a",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: { query: "Which database did we choose?" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "e".repeat(64) },
        correlationHeaders: { "x-conversation-id": positiveExecution.sessionId },
      },
    }],
    completionEvidence: [{
      source: "memory-proxy",
      sequence: 2,
      wallTimeUnixMicros: "1400000",
      event: {
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "memory-search-a",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { answer: "TencentDB" },
        responseBodySha256: "f".repeat(64),
        durationMs: 2,
      },
    }],
    formalTraceEligible: true,
    issues: [],
  }, {
    runId: negativeExecution.runId,
    caseId: negativeExecution.caseId,
    variantId: "V0",
    sessionId: negativeExecution.sessionId,
    entries: [],
    completions: [],
    entryEvidence: [],
    completionEvidence: [],
    formalTraceEligible: true,
    issues: [],
  }],
};

function campaignWithPostTerminalOrphanCompletion(
  behaviorValidTerminal: boolean,
): CollectedObservedCampaign {
  const positiveRun = toolCampaign.runs[0];
  const positiveEntry = positiveRun.entries[0];
  const positiveEntryEvidence = positiveRun.entryEvidence[0];
  const orphanCompletion = {
    ...positiveRun.completions[0],
    correlationId: "orphan-after-terminal",
  };
  return {
    ...toolCampaign,
    runs: [{
      ...positiveRun,
      entries: behaviorValidTerminal
        ? positiveRun.entries
        : [{ ...positiveEntry, requestBody: {} }],
      entryEvidence: behaviorValidTerminal
        ? positiveRun.entryEvidence
        : [{
          ...positiveEntryEvidence,
          event: { ...positiveEntryEvidence.event, requestBody: {} },
        }],
      completions: [...positiveRun.completions, orphanCompletion],
      completionEvidence: [...positiveRun.completionEvidence, {
        ...positiveRun.completionEvidence[0],
        sequence: 3,
        wallTimeUnixMicros: "1900000",
        event: orphanCompletion,
      }],
    }, toolCampaign.runs[1]],
  };
}

function providerCampaign(
  negativeEligible = true,
): CollectedProviderCampaign {
  const normalizedUsage = normalizeProviderUsage({
    ...FORMAL_PROVIDER_USAGE_CONTRACT,
    rawUsage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 60 },
      output_tokens: 10,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 110,
    },
  });
  const injectionAudit = {
    wrapperCount: 1 as const,
    injectionSha256: utf8Sha256(INJECTION),
    injectionTokenEncoding: "o200k_base" as const,
    injectionTokenCount: countInjectionTokens(INJECTION),
    injectionCharacterCount: INJECTION.length,
    injectionUtf8ByteCount: Buffer.byteLength(INJECTION, "utf8"),
    hasSessionContext: false,
    toolFamilies: ["memory" as const],
    userPromptCount: 1 as const,
    userPromptSha256: "a".repeat(64),
  };
  const run = (
    receipt: FormalExecutionReceipt,
    eligible: boolean,
  ): CollectedProviderCampaign["runs"][number] => {
    const correlationId = `${receipt.runId}-provider`;
    const rawBodySha256 = "a".repeat(64);
    return ({
    runId: receipt.runId,
    caseId: receipt.caseId,
    variantId: "V0",
    sessionId: receipt.sessionId,
    requests: [{
      correlationId,
      requestSequence: 1,
      requestWallTimeUnixMicros: "1100000",
      completionSequence: 2,
      completionWallTimeUnixMicros: "1200000",
      latencyMs: 100,
      path: "/codex/space-a/v1/responses",
      method: "POST",
      rawBodySha256,
      providerToolDefinitionCount: receipt.caseId === MEMORY_SEARCH_GOLD.caseId ? 1 : 0,
      status: 200,
      upstreamRequestId: `${receipt.runId}-official`,
      responseBodySha256: "b".repeat(64),
      usage: {
        inputTokens: 100,
        cachedInputTokens: 60,
        outputTokens: 10,
        reasoningOutputTokens: 2,
        totalTokens: 110,
      },
      providerUsageNormalization: normalizedUsage,
      injectionAudit,
      providerVisibleInjection: INJECTION,
      productionSourceEvidence: sourceEvidence(correlationId, rawBodySha256),
    }],
    injection: {
      encoding: "o200k_base",
      tokens: countInjectionTokens(INJECTION),
      characters: INJECTION.length,
      utf8Bytes: Buffer.byteLength(INJECTION, "utf8"),
      sha256: utf8Sha256(INJECTION),
      toolFamilies: ["memory"],
    },
    providerUsage: {
      requestCount: 1,
      inputTokens: 100,
      cachedInputTokens: 60,
      outputTokens: 10,
      reasoningOutputTokens: 2,
      totalTokens: 110,
    },
    formalProviderEvidenceEligible: eligible,
    issues: eligible ? [] : [{ code: "provider_usage_missing_or_invalid", message: "missing" }],
    });
  };
  return {
    schemaVersion: "task1.provider-evidence-collection.v1",
    campaignId: "campaign-integration",
    proxyProcessInstanceId: "proxy-a",
    formalCampaignEligible: negativeEligible,
    issues: negativeEligible ? [] : [{ code: "provider_usage_missing_or_invalid", message: "missing" }],
    unassignedSequences: [],
    runs: [run(positiveExecution, true), run(negativeExecution, negativeEligible)],
  };
}

function m2PreGoldEvidence(
  observedCampaign: CollectedObservedCampaign = toolCampaign,
): readonly FormalM2PreGoldEvidence[] {
  const providerRuns = new Map(
    providerCampaign().runs.map((run) => [run.runId, run]),
  );
  const toolRuns = new Map(observedCampaign.runs.map((run) => [run.runId, run]));
  return [positiveExecution, negativeExecution].map((receipt, index) => {
    const providerRun = providerRuns.get(receipt.runId);
    const toolRun = toolRuns.get(receipt.runId);
    if (!providerRun || !toolRun) throw new Error(`missing fixture run ${receipt.runId}`);
    return buildFormalM2PreGoldEvidence({
      execution: receipt,
      providerRun,
      toolRun,
      frozenControl: {
        caseInputControlSha256: String(index + 1).repeat(64),
        comparisonGroupSha256: "3".repeat(64),
        visibleAssetSetSha256: receipt.visibleAssetSetSha256,
      },
    });
  });
}

const privateMeasurement = {
  split: "dev",
  goldCount: 2,
  pairCount: 1,
  runtimeContractCount: 21,
  gold: [MEMORY_SEARCH_GOLD, NO_TOOL_GOLD],
  pairs: [{
    schemaVersion: "2",
    pairId: "pair-memory-positive-negative",
    positiveCaseId: MEMORY_SEARCH_GOLD.caseId,
    negativeCaseId: NO_TOOL_GOLD.caseId,
    causalFactorId: "memory-relevance",
    allowedChangedPointers: ["/query"],
    invariantProjectionSchemaVersion: "pair-invariant-projection-v2",
    invariantFieldsSha256: "f".repeat(64),
    changedPointerCount: 1,
    minimalityReviewStatus: "approved",
    independenceKey: "memory-relevance-a",
    split: "dev",
  }],
  runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
  hashes: {
    manifestCanonicalSha256: "a".repeat(64),
    goldCanonicalSha256: "b".repeat(64),
    pairCanonicalSha256: "c".repeat(64),
    runtimeContractsCanonicalSha256: "d".repeat(64),
  },
  formalMetricEligible: false,
} as unknown as PrivateMeasurementSplitData;

const validatedPair: ValidatedPairContractV2 = {
  contract: privateMeasurement.pairs[0],
  changedPointers: ["/query"],
  computedInvariantFieldsSha256: privateMeasurement.pairs[0].invariantFieldsSha256,
};

function pairScoring(
  frozenPairSetSha256 = privateMeasurement.hashes.pairCanonicalSha256,
): FormalPairScoringInput {
  const repeatId = "repeat-01";
  const runEvidence = [{
    runId: positiveExecution.runId,
    repeatId,
    rawEvidenceArtifactRef: "artifact://formal/run-positive/tool-trace",
    rawEvidenceArtifactSha256: "4".repeat(64),
    localStateId: "local-state-positive",
  }, {
    runId: negativeExecution.runId,
    repeatId,
    rawEvidenceArtifactRef: "artifact://formal/run-negative/tool-trace",
    rawEvidenceArtifactSha256: "5".repeat(64),
    localStateId: "local-state-negative",
  }];
  const frozenPairSetRevision = "formal-dev-pairs-v1";
  const frozenPairSlotManifest = buildFrozenPairSlotManifestV2([{
    validatedPair,
    repeats: [{
      repeatId,
      positive: runEvidence[0],
      negative: runEvidence[1],
    }],
  }], {
    revision: frozenPairSetRevision,
    sha256: frozenPairSetSha256,
  });
  const campaign = {
    schemaVersion: "pair-summary-campaign-v2" as const,
    split: "dev" as const,
    variantId: "V0",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    provider: "openai",
    apiProtocol: "responses-v1",
    adapterVersion: "formal-real-chain-v1",
    executionIdentitySha256: "7".repeat(64),
    assetSnapshotSha256: "8".repeat(64),
    expectedPairIds: [validatedPair.contract.pairId],
    expectedRepeatIds: [repeatId],
    frozenPairSetRevision,
    frozenPairSetSha256,
    frozenPairSlotManifest,
    frozenPairSlotEvidenceRootSha256: frozenPairSlotManifest.canonicalSha256,
    strictPairExactEnabled: false,
    scoringPolicySha256: computePairScoringPolicySha256V2(false),
  };
  return {
    campaign: {
      ...campaign,
      expectedPairIdsSha256: computeExpectedPairMembershipSha256V2(campaign),
    },
    validatedPairs: [validatedPair],
    runEvidence,
  };
}

describe("integrateFormalMeasurement", () => {
  it("uses the frozen M1 PairExact scorer for formal paired behavior", () => {
    const m2 = m2PreGoldEvidence();
    const ledger = m2[0].tokenCapture.tokenLedger;
    const result = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2,
      pairScoring: pairScoring(),
    });

    expect(result).toMatchObject({
      schemaVersion: "task1.formal-measurement-integration.v2",
      campaignId: "campaign-integration",
      variantId: "V0",
      eligibleRunCount: 2,
      excludedRunCount: 0,
      aggregate: {
        shortestExactRate: { numerator: 1, denominator: 1, value: 1 },
        falseCallAttemptRate: { numerator: 0, denominator: 1, value: 0 },
        conditionalTerminalAccuracy: { numerator: 1, denominator: 1, value: 1 },
      },
      paired: {
        schemaVersion: "pair-score-summary-v2",
        campaignEligibility: "eligible",
        repeatAggregationPolicyId: "all-repeats-pass-v1",
        jFrozen: 1,
        jEligible: 1,
        pairExact: { numerator: 1, denominator: 1, value: 1 },
      },
      tokens: {
        runCount: 2,
        totalInjectionTokens: {
          sum: ledger.totalInjectionTokens * 2,
          min: ledger.totalInjectionTokens,
          max: ledger.totalInjectionTokens,
          mean: ledger.totalInjectionTokens,
        },
        toolDescriptionStaticTokens: {
          sum: ledger.toolDescriptionStaticTokens * 2,
          min: ledger.toolDescriptionStaticTokens,
          max: ledger.toolDescriptionStaticTokens,
          mean: ledger.toolDescriptionStaticTokens,
        },
        components: {
          staticTemplateTokens: ledger.staticTemplateTokens * 2,
          executionContractTokens: ledger.executionContractTokens * 2,
          runtimeBindingTokens: ledger.runtimeBindingTokens * 2,
          dynamicAssetTokens: ledger.dynamicAssetTokens * 2,
        },
        providerUsageToEvaluationHorizon: {
          providerTotalInputTokens: 200,
          ordinaryInputTokens: 80,
          cacheReadInputTokens: 120,
          cacheWriteInputTokens: null,
          outputTokens: 20,
          reasoningOrThinkingTokens: 4,
        },
      },
    });
    expect(result.runs.every((run) => run.formalMetricEligible)).toBe(true);
  }, 15_000);

  it("fails closed when Pair contracts lack a frozen M1 campaign", () => {
    expect(() => integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
    })).toThrowError(FormalPairScoringRequiredError);
  }, 15_000);

  it("binds the frozen M1 pair set to the loaded private Pair hash", () => {
    expect(() => integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
      pairScoring: pairScoring("6".repeat(64)),
    })).toThrowError(/frozen M1 pair-set hash does not match private measurement Pair hash/u);
  });

  it("does not let a frozen M1 campaign shrink the private Pair denominator", () => {
    const expandedPrivateMeasurement = {
      ...privateMeasurement,
      pairCount: 2,
      pairs: [...privateMeasurement.pairs, {
        ...privateMeasurement.pairs[0],
        pairId: "pair-unfrozen-control",
        positiveCaseId: "positive-unfrozen-control",
        negativeCaseId: "negative-unfrozen-control",
      }],
    } as unknown as PrivateMeasurementSplitData;

    expect(() => integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement: expandedPrivateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
      pairScoring: pairScoring(),
    })).toThrowError(/frozen M1 pair membership does not match private measurement Pair set/u);
  });

  it("rejects a validated Pair oracle whose content differs from the private Pair", () => {
    const frozen = pairScoring();
    const stalePairScoring: FormalPairScoringInput = {
      ...frozen,
      validatedPairs: [{
        ...frozen.validatedPairs[0],
        contract: {
          ...frozen.validatedPairs[0].contract,
          causalFactorId: "stale-or-substituted-causal-factor",
        },
      }],
    };

    expect(() => integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
      pairScoring: stalePairScoring,
    })).toThrowError(/validated M1 Pair contract does not match private Pair content/u);
  });

  it("does not substitute shortestExact for complete-chain PairExact", () => {
    const baseline = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
      pairScoring: pairScoring(),
    });
    const positive = baseline.runs.find((run) => run.runId === positiveExecution.runId)!;
    const negative = baseline.runs.find((run) => run.runId === negativeExecution.runId)!;
    const paired = integrateFormalPairScores([{
      ...positive,
      score: {
        ...positive.score!,
        completeChainSuccess: true,
        strictChainExact: false,
        shortestExact: false,
        positiveOvercall: true,
      },
    }, negative], privateMeasurement, pairScoring());

    expect(paired?.pairExact).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  it("keeps a correct positive chain and PairExact when its terminal returns 400", () => {
    const positiveRun = toolCampaign.runs[0];
    const terminal400Campaign: CollectedObservedCampaign = {
      ...toolCampaign,
      runs: [{
        ...positiveRun,
        completions: positiveRun.completions.map((completion) => ({
          ...completion,
          status: 400,
          responseBody: { error: "asset rejected request" },
        })),
        completionEvidence: positiveRun.completionEvidence.map((evidence) => ({
          ...evidence,
          event: {
            ...evidence.event,
            status: 400,
            responseBody: { error: "asset rejected request" },
          },
        })),
      }, toolCampaign.runs[1]],
    };
    const result = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign: terminal400Campaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(terminal400Campaign),
      pairScoring: pairScoring(),
    });

    expect(result.runs[0].score).toMatchObject({
      completeChainSuccess: true,
      runtimeAcceptedChain: false,
      failureLayer: null,
    });
    expect(result.aggregate.completeChainSuccessRate).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
    expect(result.aggregate.runtimeAcceptedChainRate).toEqual({
      numerator: 0,
      denominator: 1,
      value: 0,
    });
    expect(result.paired?.pairExact).toEqual({ numerator: 1, denominator: 1, value: 1 });
  }, 15_000);

  it("excludes a 5xx runtime failure from formal behavior denominators", () => {
    const positiveRun = toolCampaign.runs[0];
    const terminal503Campaign: CollectedObservedCampaign = {
      ...toolCampaign,
      runs: [{
        ...positiveRun,
        completions: positiveRun.completions.map((completion) => ({
          ...completion,
          status: 503,
          responseBody: { error: "runtime unavailable" },
        })),
        completionEvidence: positiveRun.completionEvidence.map((evidence) => ({
          ...evidence,
          event: {
            ...evidence.event,
            status: 503,
            responseBody: { error: "runtime unavailable" },
          },
        })),
      }, toolCampaign.runs[1]],
    };
    const result = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign: terminal503Campaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(terminal503Campaign),
      pairScoring: pairScoring(),
    });

    expect(result.runs[0]).toMatchObject({
      formalMetricEligible: false,
      exclusionReasons: ["tool_runtime_infrastructure_failure"],
      score: {
        completeChainSuccess: true,
        runtimeAcceptedChain: false,
        rawInfrastructureFailure: [{ kind: "bridge_5xx", code: "http_503" }],
      },
    });
    expect(result.aggregate).toMatchObject({
      toolPositiveCount: 0,
      completeChainSuccessRate: { numerator: 0, denominator: 0, value: null },
    });
  }, 15_000);

  it("does not exclude observation-level infrastructure recorded after a behavior-valid terminal", () => {
    const observedCampaign = campaignWithPostTerminalOrphanCompletion(true);
    const result = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign: observedCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(observedCampaign),
      pairScoring: pairScoring(),
    });

    expect(result.runs[0]).toMatchObject({
      formalMetricEligible: true,
      exclusionReasons: [],
      score: {
        completeChainSuccess: true,
        behaviorValidTerminalAttemptIndex: 0,
        terminalAttemptIndex: 0,
        rawInfrastructureFailure: [{ code: "orphan_completion" }],
      },
    });
  }, 15_000);

  it("excludes observation-level infrastructure when only a raw terminal candidate exists", () => {
    const observedCampaign = campaignWithPostTerminalOrphanCompletion(false);
    const result = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign: observedCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(observedCampaign),
      pairScoring: pairScoring(),
    });

    expect(result.runs[0]).toMatchObject({
      formalMetricEligible: false,
      exclusionReasons: ["tool_runtime_infrastructure_failure"],
      score: {
        completeChainSuccess: false,
        behaviorValidTerminalAttemptIndex: null,
        terminalAttemptIndex: 0,
        rawInfrastructureFailure: [{ code: "orphan_completion" }],
      },
    });
  }, 15_000);

  it("counts malformed unbound negative intent as a PairExact failure", () => {
    const baseline = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
      pairScoring: pairScoring(),
    });
    const positive = baseline.runs.find((run) => run.runId === positiveExecution.runId)!;
    const negative = baseline.runs.find((run) => run.runId === negativeExecution.runId)!;
    const paired = integrateFormalPairScores([positive, {
      ...negative,
      score: {
        ...negative.score!,
        triggeredAttempt: false,
        falseCallAttempt: false,
        malformedFalseIntent: true,
        failureLayer: "malformed_intent",
      },
    }], privateMeasurement, pairScoring());

    expect(paired?.pairExact).toEqual({ numerator: 0, denominator: 1, value: 0 });
  });

  it("excludes the whole structurally damaged campaign and its Pair denominator", () => {
    const result = integrateFormalMeasurement({
      campaignId: "campaign-integration",
      executions: [positiveExecution, negativeExecution],
      toolCampaign,
      providerCampaign: providerCampaign(false),
      privateMeasurement,
      m2PreGoldEvidence: m2PreGoldEvidence(),
      pairScoring: pairScoring(),
    });

    expect(result.eligibleRunCount).toBe(0);
    expect(result.excludedRunCount).toBe(2);
    expect(result.aggregate.caseCount).toBe(0);
    expect(result.paired).toMatchObject({
      campaignEligibility: "incomplete",
      jFrozen: 1,
      jEligible: 0,
      jIncomplete: 1,
      pairExact: { numerator: 0, denominator: 0, value: null },
    });
    expect(result.runs.every((run) => (
      run.exclusionReasons.includes("provider_campaign_ineligible")
    ))).toBe(true);
  });
});
