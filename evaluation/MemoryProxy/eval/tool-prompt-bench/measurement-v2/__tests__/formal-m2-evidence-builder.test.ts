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
import { canonicalSha256, utf8Sha256 } from "../canonical-json.js";
import {
  buildFormalM2PreGoldEvidence,
  finalizeFormalM2Evidence,
} from "../formal-m2-evidence-builder.js";
import type { CollectedObservedRun } from "../observed-event-collector.js";
import {
  FORMAL_PROVIDER_USAGE_CONTRACT,
  type CollectedProviderRequest,
  type CollectedProviderRun,
} from "../provider-evidence-collector.js";
import { normalizeProviderUsage } from "../provider-usage.js";
import type { CaseChainScoreV2 } from "../types.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const INJECTION = [
  "<tdai_injections>",
  "<skill_tools>search and view skills</skill_tools>",
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
        sourceId: "test-skill-tools",
        sourceKind: "static-tool",
        injectionBlockId: "skill-tools",
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

function usage(inputTokens: number, cachedInputTokens = 0) {
  return normalizeProviderUsage({
    ...FORMAL_PROVIDER_USAGE_CONTRACT,
    rawUsage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: cachedInputTokens },
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: inputTokens + 20,
    },
  });
}

function audit() {
  return {
    wrapperCount: 1 as const,
    injectionSha256: utf8Sha256(INJECTION),
    injectionTokenEncoding: "o200k_base" as const,
    injectionTokenCount: countInjectionTokens(INJECTION),
    injectionCharacterCount: INJECTION.length,
    injectionUtf8ByteCount: Buffer.byteLength(INJECTION, "utf8"),
    hasSessionContext: false,
    toolFamilies: ["skill" as const],
    userPromptCount: 1 as const,
    userPromptSha256: SHA_A,
  };
}

function request(
  ordinal: number,
  requestWallTimeUnixMicros: string,
  completionWallTimeUnixMicros: string,
  cachedInputTokens = 0,
): CollectedProviderRequest {
  const normalized = usage(100 + ordinal * 10, cachedInputTokens);
  const correlationId = `provider-${ordinal}`;
  const rawBodySha256 = ordinal === 0 ? SHA_B : SHA_C;
  return {
    correlationId,
    requestSequence: 10 + ordinal * 10,
    requestWallTimeUnixMicros,
    completionSequence: 11 + ordinal * 10,
    completionWallTimeUnixMicros,
    latencyMs: Math.ceil(
      Number(BigInt(completionWallTimeUnixMicros) - BigInt(requestWallTimeUnixMicros)) / 1_000,
    ),
    path: "/v1/responses",
    method: "POST",
    rawBodySha256,
    providerToolDefinitionCount: 9,
    status: 200,
    upstreamRequestId: `upstream-${ordinal}`,
    responseBodySha256: SHA_D,
    usage: {
      inputTokens: 100 + ordinal * 10,
      cachedInputTokens,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 120 + ordinal * 10,
    },
    providerUsageNormalization: normalized,
    injectionAudit: audit(),
    providerVisibleInjection: INJECTION,
    productionSourceEvidence: sourceEvidence(correlationId, rawBodySha256),
  };
}

function execution(): FormalExecutionReceipt {
  const effectiveInvocationCanonical = {
    executable: "codex",
    args: ["exec", "--json", "-"],
    cwd: "D:\\formal-test-workspace",
    runtimeIdentity: {
      resolvedAuthUserId: "user-1",
      spaceId: "space-1",
      teamId: "team-1",
      agentId: "agent-1",
      taskId: "task-1",
    },
  };
  return {
    schemaVersion: "task1.formal-execution-receipt.v1",
    formalMetricEligible: false,
    runId: "run-1",
    caseId: "case-1",
    variantId: "V0",
    repeat: 1,
    sessionId: "session-1",
    proxyInstanceId: "proxy-1",
    knowledgeInstanceId: "knowledge-1",
    providerPromptSha256: SHA_A,
    visibleAssetSetSha256: SHA_E,
    preflightReceiptSha256: SHA_B,
    artifactBindings: {
      runManifestFileSha256: SHA_A,
      prepareCommandFileSha256: SHA_B,
      providerPromptFileSha256: SHA_C,
      preflightReceiptFileSha256: SHA_D,
    },
    executionIdentity: {
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
      verbosity: "medium",
      codexCliVersion: "codex-cli 1.0.0",
    },
    effectiveInvocation: {
      canonical: effectiveInvocationCanonical,
      canonicalSha256: canonicalSha256(effectiveInvocationCanonical),
    },
    preparationBinding: {
      runManifestCanonicalSha256: SHA_A,
      prepareCommandCanonicalSha256: SHA_B,
      workspacePolicySha256: SHA_C,
      runNamespace: "run:isolated-1",
      memoryProxyContextId: "proxy-context:isolated-1",
      localStateId: "local-state:isolated-1",
      freshLocalState: true,
      inheritedHistory: false,
    },
    snapshotBinding: {
      restorePlanSha256: SHA_A,
      snapshotId: "snapshot-1",
      snapshotCanonicalSha256: SHA_D,
      inspectEnvelopeCanonicalSha256: SHA_E,
    },
    codeFreeze: {
      executionCodeCommit: "1".repeat(40),
      promptFreezeTagObject: FORMAL_PROMPT_FREEZE_TAG_OBJECT,
      promptFreezeCommit: FORMAL_PROMPT_FREEZE_COMMIT,
      promptFreezeIsAncestor: true,
      workingTreeClean: true,
    },
    startedAt: "2026-08-30T00:00:01.000Z",
    finishedAt: "2026-08-30T00:00:02.000Z",
    startedWallTimeUnixMicros: "1000000",
    finishedWallTimeUnixMicros: "2000000",
    process: {
      exitCode: 0,
      timedOut: false,
      infrastructureError: null,
      stdoutSha256: SHA_A,
      stderrSha256: SHA_B,
    },
    clientUsage: null,
    promptEvidenceState: "captured-by-provider-observer-pending-seal",
    providerUsageState: "captured-by-provider-observer-pending-seal",
    traceCollectionState: "pending-campaign-seal",
    episodePolicy: { additionalUserTurns: 0, tdaiAttemptHorizon: 4, wallTimeMs: 180_000 },
  };
}

function providerRun(): CollectedProviderRun {
  return {
    runId: "run-1",
    caseId: "case-1",
    variantId: "V0",
    sessionId: "session-1",
    requests: [
      request(0, "1100000", "1200000"),
      request(1, "1500000", "1700000"),
    ],
    injection: {
      encoding: "o200k_base",
      tokens: countInjectionTokens(INJECTION),
      characters: INJECTION.length,
      utf8Bytes: Buffer.byteLength(INJECTION, "utf8"),
      sha256: utf8Sha256(INJECTION),
      toolFamilies: ["skill"],
    },
    providerUsage: {
      requestCount: 2,
      inputTokens: 210,
      cachedInputTokens: 0,
      outputTokens: 40,
      reasoningOutputTokens: 10,
      totalTokens: 250,
    },
    formalProviderEvidenceEligible: true,
    issues: [],
  };
}

function providerRunWithPostTerminalRequest(): CollectedProviderRun {
  return {
    ...providerRun(),
    requests: [
      request(0, "1100000", "1200000", 10),
      request(1, "1500000", "1700000", 20),
      request(2, "1850000", "1950000", 80),
    ],
    providerUsage: {
      requestCount: 3,
      inputTokens: 330,
      cachedInputTokens: 110,
      outputTokens: 60,
      reasoningOutputTokens: 15,
      totalTokens: 390,
    },
  };
}

function toolEntry(correlationId: string) {
  return {
    correlationId,
    family: "skill" as const,
    endpoint: "/skills/search",
    method: "POST",
    requestBody: { query: "typescript" },
    requestBodyCapture: { outcome: "captured" as const, rawBodySha256: SHA_A },
    correlationHeaders: {
      "x-conversation-id": "session-1",
      "x-tdai-service-id": "service-1",
    },
  };
}

function toolRun(withAttempts = true): CollectedObservedRun {
  const entries = withAttempts ? [toolEntry("attempt-1"), toolEntry("attempt-2")] : [];
  return {
    runId: "run-1",
    caseId: "case-1",
    variantId: "V0",
    sessionId: "session-1",
    entries,
    completions: [],
    entryEvidence: withAttempts
      ? [
        {
          source: "memory-proxy",
          sequence: 3,
          wallTimeUnixMicros: "1300000",
          event: entries[0],
        },
        {
          source: "memory-proxy",
          sequence: 4,
          wallTimeUnixMicros: "1800000",
          event: entries[1],
        },
      ]
      : [],
    completionEvidence: [],
    formalTraceEligible: true,
    issues: [],
  };
}

function frozenControl() {
  return {
    caseInputControlSha256: SHA_A,
    comparisonGroupSha256: SHA_B,
    visibleAssetSetSha256: SHA_E,
  };
}

function score(overrides: Partial<CaseChainScoreV2> = {}): CaseChainScoreV2 {
  return {
    evaluationSchemaVersion: 2,
    caseId: "case-1",
    runId: "run-1",
    variantId: "V0",
    rawTraceStatus: "complete",
    traceCompleteness: true,
    rawInfrastructureFailure: [],
    triggeredAttempt: true,
    firstActionSelectionCorrect: true,
    terminalSelectionCorrect: true,
    completeChainSuccess: true,
    runtimeAcceptedChain: true,
    strictChainExact: true,
    falseCallAttempt: null,
    falseCallAccepted: null,
    malformedFalseIntent: null,
    positiveOvercall: false,
    matchedSequenceId: "skill-search-view",
    shortestAllowedLength: 2,
    matchedSequenceLength: 2,
    observedAttemptCount: 2,
    evaluationPrefixAttemptCount: 2,
    behaviorValidTerminalAttemptIndex: 1,
    terminalAttemptIndex: 1,
    toolSplContribution: 1,
    shortestExact: true,
    failureLayer: null,
    ...overrides,
  };
}

describe("formal M2 evidence builder", () => {
  it("attributes a multi-step chain to strict response windows and finalizes ready M2 evidence", () => {
    const preGold = buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: providerRun(),
      frozenControl: frozenControl(),
    });

    expect(preGold.attributionContractId)
      .toBe("codex-single-thread-request-to-next-request-v1");
    expect(preGold.requestUsageLedger).toMatchObject({
      status: "ready",
      ledger: {
        requests: [
          {
            requestId: "provider-0",
            observedAttemptIds: ["attempt-1"],
            phaseId: "task-model:0",
            phaseType: "initial",
          },
          {
            requestId: "provider-1",
            observedAttemptIds: ["attempt-2"],
            phaseId: "task-model:1",
            phaseType: "executor",
          },
        ],
      },
    });
    expect(preGold.runIsolation.isolationStatus).toBe("ready");
    expect(preGold.tokenCapture.tokenLedger.classification.formalCompilerClosure.status)
      .toBe("ready");
    expect(preGold).not.toHaveProperty("score");
    expect(preGold).not.toHaveProperty("gold");
    expect(preGold).not.toHaveProperty("privateGold");

    const result = finalizeFormalM2Evidence({ preGold, score: score() });
    expect(result.m0EvaluationBoundary).toMatchObject({
      status: "observed",
      evaluationHorizonRequestId: "provider-1",
      evaluationHorizonPhaseId: "task-model:1",
      modelRoundsToTerminal: 2,
      tdaiCallCount: 2,
      timeToTerminalMs: 800,
      terminalReached: true,
      terminalBoundaryGivenSuccess: {
        requestId: "provider-1",
        phaseId: "task-model:1",
        terminalAttemptId: "attempt-2",
      },
    });
    expect(result.usageHorizon).toMatchObject({
      status: "ready",
      accumulatedRequestCount: 2,
      providerInputToEvaluationHorizon: 210,
      providerInputToTerminalGivenSuccess: 210,
    });
    expect(result.eligibility).toMatchObject({
      m2EvidenceStatus: "ready_for_integration",
      blockers: [],
    });
    expect(result.canonicalSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses the last provider request as a no-tool/non-success usage horizon", () => {
    const preGold = buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(false),
      providerRun: providerRun(),
      frozenControl: frozenControl(),
    });
    const result = finalizeFormalM2Evidence({
      preGold,
      score: score({
        triggeredAttempt: false,
        firstActionSelectionCorrect: null,
        terminalSelectionCorrect: null,
        completeChainSuccess: null,
        runtimeAcceptedChain: null,
        strictChainExact: null,
        falseCallAttempt: false,
        falseCallAccepted: false,
        malformedFalseIntent: false,
        positiveOvercall: null,
        matchedSequenceId: null,
        shortestAllowedLength: 0,
        matchedSequenceLength: null,
        observedAttemptCount: 0,
        evaluationPrefixAttemptCount: 0,
        behaviorValidTerminalAttemptIndex: null,
        terminalAttemptIndex: null,
        toolSplContribution: null,
        shortestExact: null,
      }),
    });

    expect(preGold.requestUsageLedger.status).toBe("ready");
    if (preGold.requestUsageLedger.status !== "ready") throw new Error("ledger must be ready");
    expect(preGold.requestUsageLedger.ledger.requests.map((requestEvidence) => (
      requestEvidence.phaseType
    ))).toEqual(["initial", "followup"]);
    expect(result.m0EvaluationBoundary).toMatchObject({
      evaluationHorizonRequestId: "provider-1",
      evaluationHorizonPhaseId: "task-model:1",
      modelRoundsToTerminal: null,
      tdaiCallCount: 0,
      timeToTerminalMs: null,
      terminalReached: false,
    });
    expect(result.usageHorizon).toMatchObject({
      status: "ready",
      accumulatedRequestCount: 2,
      providerInputToTerminalGivenSuccess: null,
    });
  });

  it("stops failed-chain usage and cache totals at a behavior-valid terminal request", () => {
    const preGold = buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: providerRunWithPostTerminalRequest(),
      frozenControl: frozenControl(),
    });
    const result = finalizeFormalM2Evidence({
      preGold,
      score: score({
        terminalSelectionCorrect: false,
        completeChainSuccess: false,
        runtimeAcceptedChain: null,
        strictChainExact: false,
        positiveOvercall: true,
        matchedSequenceId: null,
        matchedSequenceLength: null,
        toolSplContribution: 0,
        shortestExact: false,
        failureLayer: "wrong_family",
      }),
    });

    expect(result.m0EvaluationBoundary).toMatchObject({
      evaluationHorizonRequestId: "provider-1",
      evaluationHorizonPhaseId: "task-model:1",
      terminalReached: false,
      terminalBoundaryGivenSuccess: null,
      modelRoundsToTerminal: null,
      timeToTerminalMs: null,
    });
    expect(result.usageHorizon).toMatchObject({
      status: "ready",
      accumulatedRequestCount: 2,
      providerInputToEvaluationHorizon: 210,
      providerInputToTerminalGivenSuccess: null,
      aggregatesToEvaluationHorizon: {
        providerTotalInputTokens: 210,
        cacheReadInputTokens: 30,
      },
    });
  });

  it("uses the final request only when no behavior-valid terminal horizon exists", () => {
    const preGold = buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: providerRunWithPostTerminalRequest(),
      frozenControl: frozenControl(),
    });
    const result = finalizeFormalM2Evidence({
      preGold,
      score: score({
        terminalSelectionCorrect: false,
        completeChainSuccess: false,
        runtimeAcceptedChain: null,
        strictChainExact: false,
        positiveOvercall: true,
        matchedSequenceId: null,
        matchedSequenceLength: null,
        behaviorValidTerminalAttemptIndex: null,
        terminalAttemptIndex: 1,
        toolSplContribution: 0,
        shortestExact: false,
        failureLayer: "arguments",
      }),
    });

    expect(result.m0EvaluationBoundary).toMatchObject({
      evaluationHorizonRequestId: "provider-2",
      evaluationHorizonPhaseId: "task-model:2",
      terminalReached: false,
      terminalBoundaryGivenSuccess: null,
      modelRoundsToTerminal: null,
      timeToTerminalMs: null,
    });
    expect(result.usageHorizon).toMatchObject({
      status: "ready",
      accumulatedRequestCount: 3,
      providerInputToEvaluationHorizon: 330,
      providerInputToTerminalGivenSuccess: null,
      aggregatesToEvaluationHorizon: {
        providerTotalInputTokens: 330,
        cacheReadInputTokens: 110,
      },
    });
  });

  it("attributes production events that share one millisecond by causal sequence", () => {
    const coarse = toolRun();
    const entries = [
      { ...coarse.entryEvidence[0], wallTimeUnixMicros: "1100000" },
      { ...coarse.entryEvidence[1], wallTimeUnixMicros: "1700000" },
    ];
    const provider = providerRun();
    const requests = [
      request(0, "1100000", "1100000"),
      request(1, "1100000", "1700000"),
    ];
    const receipt = {
      ...execution(),
      startedWallTimeUnixMicros: "1100000",
    };

    const result = buildFormalM2PreGoldEvidence({
      execution: receipt,
      toolRun: { ...coarse, entryEvidence: entries },
      providerRun: { ...provider, requests },
      frozenControl: frozenControl(),
    });

    expect(result.attributedAttempts.map((attempt) => attempt.requestOrdinal))
      .toEqual([0, 1]);
  });

  it("uses request-to-next-request causality when completion tee evidence arrives late", () => {
    const provider = providerRun();
    const requests = [
      { ...request(0, "1100000", "1600000"), completionSequence: 21 },
      { ...request(1, "1500000", "1900000"), completionSequence: 22 },
    ];

    const result = buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: { ...provider, requests },
      frozenControl: frozenControl(),
    });

    expect(result.attributedAttempts.map((attempt) => attempt.requestOrdinal))
      .toEqual([0, 1]);
  });

  it("rejects a provider request without completion evidence", () => {
    const provider = providerRun();
    const incomplete = {
      ...provider.requests[0],
      completionSequence: null,
      completionWallTimeUnixMicros: null,
      latencyMs: null,
      status: null,
      providerUsageNormalization: null,
    };

    expect(() => buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: { ...provider, requests: [incomplete, provider.requests[1]] },
      frozenControl: frozenControl(),
    })).toThrow(/completion/iu);
  });

  it("rejects run identity drift and a post-hoc visible-asset control", () => {
    expect(() => buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: { ...providerRun(), sessionId: "different-session" },
      frozenControl: frozenControl(),
    })).toThrow(/identity|session/iu);

    expect(() => buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: providerRun(),
      frozenControl: { ...frozenControl(), visibleAssetSetSha256: SHA_A },
    })).toThrow(/visible asset/iu);
  });

  it("rejects missing provider usage rather than substituting zeros", () => {
    const provider = providerRun();
    const missingUsage = {
      ...provider.requests[1],
      providerUsageNormalization: null,
    };

    expect(() => buildFormalM2PreGoldEvidence({
      execution: execution(),
      toolRun: toolRun(),
      providerRun: { ...provider, requests: [provider.requests[0], missingUsage] },
      frozenControl: frozenControl(),
    })).toThrow(/usage/iu);
  });
});
