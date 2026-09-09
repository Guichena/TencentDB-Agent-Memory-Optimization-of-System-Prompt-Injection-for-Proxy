import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { get_encoding } from "tiktoken";
import { AnthropicAdapter } from "../../../../../implementations/final/MemoryProxy/src/injection/adapters/anthropic.js";
import { ClaudeCodeProfile } from "../../../../../implementations/final/MemoryProxy/src/injection/agents/claude-code/index.js";
import { InjectionPipeline } from "../../../../../implementations/final/MemoryProxy/src/injection/pipeline.js";
import { isInjectionInfrastructureError } from "../../../../../implementations/final/MemoryProxy/src/injection/errors.js";
import { HookRegistryImpl } from "../../../../../implementations/final/MemoryProxy/src/injection/registry.js";
import type { NormalizeProviderUsageInput } from "./provider-usage.js";
import {
  assessPairedIsolationEvidence,
  accumulateRequestUsageToM0Horizon,
  buildM2EligibilityEvidence,
  buildFrozenCaptureSourceManifest,
  buildRequestUsageLedger,
  buildRunIsolationEvidence,
  buildTokenLedger,
  buildTrustedTokenSourceManifest,
  canonicalSha256,
  normalizeProviderUsage,
  TOKEN_CLASSIFICATION_CONTRACT,
  utf8Sha256 as sha256,
} from "./index.js";

const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");
const SHA = {
  caseInput: "1".repeat(64),
  comparisonGroup: "2".repeat(64),
  providerRequest: "3".repeat(64),
  providerRequestB: "7".repeat(64),
  snapshot: "4".repeat(64),
  visibleAssets: "5".repeat(64),
  staticPrompt: "6".repeat(64),
} as const;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeArtifact(name: string, value: unknown): { file: string; sha256: string } {
  const content = json(value);
  writeFileSync(resolve(ARTIFACT_DIR, name), content, "utf8");
  return { file: name, sha256: sha256(content) };
}

const providerFixtureInputs: Array<{ fixtureId: string; input: NormalizeProviderUsageInput }> = [
  {
    fixtureId: "openai-responses-cache-write-unsupported",
    input: {
      provider: "openai",
      schema: "openai.responses",
      apiVersion: "2026-08-01",
      adapterVersion: "responses-v1",
      requiredFields: [
        "providerTotalInputTokens",
        "ordinaryInputTokens",
        "cacheReadInputTokens",
        "outputTokens",
      ],
      unsupportedFields: ["cacheWriteInputTokens"],
      rawUsage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens: 12,
        output_tokens_details: { reasoning_tokens: 3 },
      },
    },
  },
  {
    fixtureId: "openai-responses-cache-write-reported",
    input: {
      provider: "openai",
      schema: "openai.responses",
      apiVersion: "2026-08-01",
      adapterVersion: "responses-v2-cache-write",
      requiredFields: [
        "providerTotalInputTokens",
        "ordinaryInputTokens",
        "cacheReadInputTokens",
        "cacheWriteInputTokens",
        "outputTokens",
      ],
      unsupportedFields: [],
      rawUsage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
        output_tokens: 12,
      },
    },
  },
  {
    fixtureId: "openai-chat-cache-write-unsupported",
    input: {
      provider: "openai",
      schema: "openai.chat-completions",
      apiVersion: "2026-08-01",
      adapterVersion: "chat-v1",
      requiredFields: [
        "providerTotalInputTokens",
        "ordinaryInputTokens",
        "cacheReadInputTokens",
        "outputTokens",
      ],
      unsupportedFields: ["cacheWriteInputTokens"],
      rawUsage: {
        prompt_tokens: 90,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens: 11,
        completion_tokens_details: { reasoning_tokens: 4 },
      },
    },
  },
  {
    fixtureId: "openai-codex-jsonl-complete",
    input: {
      provider: "openai",
      schema: "openai.codex-jsonl",
      apiVersion: "codex-jsonl-v1",
      adapterVersion: "codex-runner-v1",
      requiredFields: [
        "providerTotalInputTokens",
        "ordinaryInputTokens",
        "cacheReadInputTokens",
        "cacheWriteInputTokens",
        "outputTokens",
        "reasoningOrThinkingTokens",
      ],
      unsupportedFields: [],
      rawUsage: {
        input_tokens: 120,
        cached_input_tokens: 50,
        cache_write_input_tokens: 10,
        output_tokens: 20,
        reasoning_output_tokens: 7,
      },
    },
  },
  {
    fixtureId: "anthropic-messages-complete",
    input: {
      provider: "anthropic",
      schema: "anthropic.messages",
      apiVersion: "2023-06-01",
      adapterVersion: "messages-v1",
      requiredFields: [
        "providerTotalInputTokens",
        "ordinaryInputTokens",
        "cacheReadInputTokens",
        "cacheWriteInputTokens",
        "outputTokens",
      ],
      unsupportedFields: ["reasoningOrThinkingTokens"],
      rawUsage: {
        input_tokens: 60,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 10,
        output_tokens: 8,
      },
    },
  },
];

interface MetadataParityCase {
  caseId: string;
  outcome: "injected_with_parity" | "pipeline_infrastructure_failure";
  forwardableProviderRequestProduced: boolean;
  infrastructureErrorCode: "INJECTION_METADATA_PARITY_FAILURE" | null;
  markerCount: number | null;
  markerOrderSha256: string | null;
  expectedMarkerOrderSha256: string;
  modelVisibleTextSha256: string | null;
  expectedModelVisibleTextSha256: string | null;
  status: "pass";
}

function modelVisibleSystem(body: Record<string, unknown>): string {
  if (typeof body.system === "string") return body.system;
  if (!Array.isArray(body.system)) throw new Error("synthetic Anthropic system field is missing");
  return (body.system as Array<Record<string, unknown>>)
    .map((block) => String(block.text ?? ""))
    .join("\n");
}

function systemMarkers(body: Record<string, unknown>): unknown[] {
  if (!Array.isArray(body.system)) return [];
  return (body.system as Array<Record<string, unknown>>)
    .filter((block) => block.cache_control !== undefined)
    .map((block) => block.cache_control);
}

async function captureMetadataCase(input: {
  caseId: string;
  system: Array<Record<string, unknown>>;
  expectedText: string;
  expectedOutcome?: MetadataParityCase["outcome"];
  hook?: {
    id: string;
    content: string;
    relation?: "before" | "inside_append";
  };
}): Promise<MetadataParityCase> {
  const registry = new HookRegistryImpl();
  if (input.hook) {
    registry.register({
      id: input.hook.id,
      point: "system.suffix",
      priority: 1,
      anchor: { slot: "memory", relation: input.hook.relation ?? "before" },
      description: "M2 synthetic cache metadata evidence",
      execute: () => [{ type: "text", content: input.hook!.content }],
    });
  }
  const pipeline = new InjectionPipeline(
    registry,
    new Map([["anthropic", new AnthropicAdapter()]]),
    { agentProfiles: new Map([["claude-code", new ClaudeCodeProfile()]]) },
  );
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  let result: Record<string, unknown> | undefined;
  let failure: unknown;
  try {
    try {
      result = await pipeline.process({
        model: "synthetic-model",
        system: input.system,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      }, {
        protocol: "anthropic",
        traceId: input.caseId,
        keyId: "synthetic",
        modelId: "synthetic-model",
        stream: false,
        agentSource: "claude-code",
      });
    } catch (error) {
      failure = error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const expectedMarkers = input.system.map((block) => block.cache_control);
  const expectedOutcome = input.expectedOutcome ?? "injected_with_parity";
  if (expectedOutcome === "pipeline_infrastructure_failure") {
    if (!isInjectionInfrastructureError(failure)
      || failure.code !== "INJECTION_METADATA_PARITY_FAILURE"
      || result !== undefined) {
      throw new Error(`metadata infrastructure failure was not fail-closed for ${input.caseId}`);
    }
    return {
      caseId: input.caseId,
      outcome: expectedOutcome,
      forwardableProviderRequestProduced: false,
      infrastructureErrorCode: failure.code,
      markerCount: null,
      markerOrderSha256: null,
      expectedMarkerOrderSha256: sha256(JSON.stringify(expectedMarkers)),
      modelVisibleTextSha256: null,
      expectedModelVisibleTextSha256: null,
      status: "pass",
    };
  }
  if (failure !== undefined || result === undefined) {
    throw new Error(`metadata parity pipeline unexpectedly failed for ${input.caseId}`);
  }
  const actualMarkers = systemMarkers(result);
  const actualText = modelVisibleSystem(result);
  if (JSON.stringify(actualMarkers) !== JSON.stringify(expectedMarkers) || actualText !== input.expectedText) {
    throw new Error(`metadata parity failed for ${input.caseId}`);
  }
  return {
    caseId: input.caseId,
    outcome: expectedOutcome,
    forwardableProviderRequestProduced: true,
    infrastructureErrorCode: null,
    markerCount: actualMarkers.length,
    markerOrderSha256: sha256(JSON.stringify(actualMarkers)),
    expectedMarkerOrderSha256: sha256(JSON.stringify(expectedMarkers)),
    modelVisibleTextSha256: sha256(actualText),
    expectedModelVisibleTextSha256: sha256(input.expectedText),
    status: "pass",
  };
}

async function main(): Promise<void> {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifacts: Array<{ file: string; sha256: string }> = [];
  const providerFixtures = providerFixtureInputs.map((fixture) => ({
    fixtureId: fixture.fixtureId,
    provenance: "synthetic",
    input: fixture.input,
    result: normalizeProviderUsage(fixture.input),
  }));
  artifacts.push(writeArtifact("PROVIDER-USAGE-SYNTHETIC.json", {
    schemaVersion: 2,
    measurementModuleId: "M2",
    formalDataState: "blocked",
    fixtures: providerFixtures,
  }));

  const encoding = get_encoding("o200k_base");
  const sourceSegment = (
    order: number,
    sourceId: string,
    sourceKind:
      | "legacy-body"
      | "policy"
      | "execution-grammar"
      | "tool-card"
      | "dynamic-assets"
      | "runtime-binding",
    text: string,
  ) => ({ order, sourceId, sourceKind, sourceSha256: sha256(text), text });
  const segments = [
    sourceSegment(0, "skill-tools.legacy-body#static-0", "legacy-body", "<tool name=\"skill_search\">query</tool>"),
    sourceSegment(1, "shared.execution-grammar", "execution-grammar", "\nCall only when a reusable team procedure is needed."),
    sourceSegment(2, "skill-tools.legacy-body#binding-0", "runtime-binding", "\nsession_id=synthetic-session"),
    sourceSegment(3, "skill-listing.dynamic-assets", "dynamic-assets", "\n<available_skills>typescript-testing</available_skills>"),
  ];
  const compiledBlockId = "synthetic-tool-prompt-block";
  const captureBlockId = "synthetic-capture-block";
  const compiledUnits = segments
    .filter((segment) => (
      segment.sourceKind !== "runtime-binding" && segment.sourceKind !== "dynamic-assets"
    ))
    .map((segment) => ({
      id: segment.sourceId,
      family: "skill" as const,
      kind: segment.sourceKind as "legacy-body" | "policy" | "execution-grammar" | "tool-card",
      content: segment.text,
      sourceSpecIds: [] as const,
    }));
  const compiledContent = compiledUnits.map((unit) => unit.content).join("");
  const sourceManifest = buildTrustedTokenSourceManifest({
    compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
    segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
    compiledPromptBundles: [{
      injectionBlockId: compiledBlockId,
      compiledPrompt: {
        compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
        profile: "protocol-compact",
        profileLineage: ["legacy", "contract-corrected", "protocol-compact"],
        family: "skill",
        surface: "skill-tools",
        capabilitySignature: "synthetic",
        content: compiledContent,
        contentSha256: sha256(compiledContent),
        units: compiledUnits,
        contractIds: [],
        specIds: [],
      },
    }],
    captureManifest: buildFrozenCaptureSourceManifest({
      segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
      sources: segments
        .filter((segment) => (
          segment.sourceKind === "dynamic-assets" || segment.sourceKind === "runtime-binding"
        ))
        .map((segment) => ({
          provenance: segment.sourceKind === "dynamic-assets"
            ? "frozen-capture-dynamic-asset" as const
            : "frozen-capture-runtime-binding" as const,
        injectionBlockId: captureBlockId,
        sourceId: segment.sourceId,
        sourceSha256: segment.sourceSha256,
        })),
    }),
    providerOrder: segments.map((segment) => {
      if (segment.sourceKind === "runtime-binding") {
        return {
          provenance: "frozen-capture-runtime-binding" as const,
          injectionBlockId: captureBlockId,
          sourceId: segment.sourceId,
        };
      }
      if (segment.sourceKind === "dynamic-assets") {
        return {
          provenance: "frozen-capture-dynamic-asset" as const,
          injectionBlockId: captureBlockId,
          sourceId: segment.sourceId,
        };
      }
      return {
        provenance: "compiled-tool-prompt-unit" as const,
        injectionBlockId: compiledBlockId,
        unitId: segment.sourceId,
      };
    }),
  });
  const providerVisibleInjection = segments.map((segment) => segment.text).join("");
  const tokenLedger = buildTokenLedger({
    variantId: "V0",
    runId: "synthetic-m2-evidence",
    providerVisibleInjection,
    classification: {
      contractVersion: TOKEN_CLASSIFICATION_CONTRACT.contractVersion,
      contractSha256: TOKEN_CLASSIFICATION_CONTRACT.contractSha256,
      compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
      segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
    },
    sourceManifest,
    expectedSourceAttestation: {
      authority: "synthetic-self-built",
      sourceInventorySha256: sourceManifest.sourceInventorySha256,
      orderedSourceManifestSha256: sourceManifest.orderedSourceManifestSha256,
      sourceRootSha256: sourceManifest.sourceRootSha256,
    },
    segments: segments.map((segment, index) => ({
      order: segment.order,
      sourceId: sourceManifest.orderedSources[index].sourceId,
      sourceSha256: segment.sourceSha256,
      text: segment.text,
    })),
    tokenizer: {
      id: "o200k_base",
      version: "tiktoken-1.0.22",
      count: (text) => encoding.encode(text).length,
    },
  });
  encoding.free();
  artifacts.push(writeArtifact("TOKEN-LEDGER-SYNTHETIC.json", {
    formalDataState: "blocked",
    ledger: tokenLedger,
  }));

  const usage = providerFixtures[1].result;
  const requestUsageLedger = buildRequestUsageLedger({
    runId: tokenLedger.runId,
    traceId: "synthetic-m2-trace",
    requests: [0, 1].map((requestOrdinal) => ({
      runId: tokenLedger.runId,
      traceId: "synthetic-m2-trace",
      requestId: `synthetic-request-${requestOrdinal}`,
      observedAttemptIds: [`synthetic-attempt-${requestOrdinal}`],
      requestOrdinal,
      phaseId: requestOrdinal === 0 ? "initial" : "executor",
      component: "task_model" as const,
      phaseType: requestOrdinal === 0 ? "initial" as const : "executor" as const,
      promptSha256: requestOrdinal === 0 ? SHA.providerRequest : SHA.providerRequestB,
      providerToolDefinitionCount: requestOrdinal === 0 ? 3 : 1,
      injectionTokensO200k: tokenLedger.totalInjectionTokens,
      discoveryResultTokens: null,
      toolResultContextTokens: null,
      latencyMs: 25 + requestOrdinal,
      usage,
    })),
  });
  if (requestUsageLedger.status !== "ready") {
    throw new Error(`synthetic request usage ledger blocked: ${requestUsageLedger.blockers.join(",")}`);
  }
  const evaluationAttemptPrefix = [0, 1].map((requestOrdinal) => ({
    traceId: "synthetic-m2-trace",
    requestId: `synthetic-request-${requestOrdinal}`,
    attemptId: `synthetic-attempt-${requestOrdinal}`,
    phaseId: requestOrdinal === 0 ? "initial" : "executor",
  }));
  const m0EvaluationBoundary = {
    status: "observed" as const,
    runId: tokenLedger.runId,
    traceId: "synthetic-m2-trace",
    evaluationPrefixSha256: canonicalSha256(evaluationAttemptPrefix),
    evaluationAttemptPrefix,
    evaluationHorizonRequestId: "synthetic-request-1",
    evaluationHorizonPhaseId: "executor",
    terminalBoundaryGivenSuccess: {
      traceId: "synthetic-m2-trace",
      requestId: "synthetic-request-1",
      phaseId: "executor",
      terminalAttemptId: "synthetic-attempt-1",
    },
    modelRoundsToTerminal: 2,
    tdaiCallCount: 2,
    timeToTerminalMs: 450,
    terminalReached: true,
  };
  const usageHorizon = accumulateRequestUsageToM0Horizon(
    requestUsageLedger.ledger,
    m0EvaluationBoundary,
  );
  artifacts.push(writeArtifact("REQUEST-USAGE-LEDGER-SYNTHETIC.json", {
    schemaVersion: 2,
    measurementModuleId: "M2",
    formalDataState: "blocked",
    requestUsageLedger,
    m0EvaluationBoundary,
    usageHorizon,
  }));
  const runIsolation = buildRunIsolationEvidence({
    runId: tokenLedger.runId,
    runNamespace: "task1/synthetic-m2-evidence",
    caseId: "synthetic-case",
    variantId: tokenLedger.variantId,
    repeatIndex: 0,
    caseInputControlSha256: SHA.caseInput,
    comparisonGroupSha256: SHA.comparisonGroup,
    providerRequestSha256: SHA.providerRequest,
    staticPromptSha256: SHA.staticPrompt,
    execution: {
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
      verbosity: "medium",
      codexCliVersion: "synthetic-codex-cli-1",
    },
    counterfactualRole: null,
    session: { id: "synthetic-session", fresh: true },
    memoryProxyContext: { id: "synthetic-proxy-context", fresh: true },
    snapshot: {
      id: "synthetic-snapshot",
      expectedSha256: SHA.snapshot,
      restoredSha256: SHA.snapshot,
      restoreSucceeded: true,
    },
    visibleAssetsSha256: SHA.visibleAssets,
    localState: {
      pathId: "synthetic-local-state",
      fresh: true,
      inheritedHistory: false,
    },
    usage,
  });
  const repeatedRunIsolation = buildRunIsolationEvidence({
    runId: "synthetic-m2-evidence-repeat-1",
    runNamespace: "task1/synthetic-m2-evidence-repeat-1",
    caseId: "synthetic-case",
    variantId: tokenLedger.variantId,
    repeatIndex: 1,
    caseInputControlSha256: SHA.caseInput,
    comparisonGroupSha256: SHA.comparisonGroup,
    providerRequestSha256: SHA.providerRequestB,
    staticPromptSha256: SHA.staticPrompt,
    execution: {
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
      verbosity: "medium",
      codexCliVersion: "synthetic-codex-cli-1",
    },
    counterfactualRole: null,
    session: { id: "synthetic-session-repeat-1", fresh: true },
    memoryProxyContext: { id: "synthetic-proxy-context-repeat-1", fresh: true },
    snapshot: {
      id: "synthetic-snapshot",
      expectedSha256: SHA.snapshot,
      restoredSha256: SHA.snapshot,
      restoreSucceeded: true,
    },
    visibleAssetsSha256: SHA.visibleAssets,
    localState: {
      pathId: "synthetic-local-state-repeat-1",
      fresh: true,
      inheritedHistory: false,
    },
    usage,
  });
  const repeatIsolation = assessPairedIsolationEvidence(
    runIsolation,
    repeatedRunIsolation,
    { purpose: "repeat" },
  );
  const eligibility = buildM2EligibilityEvidence({
    formalDataState: "blocked",
    evaluationLayer: "mock-contract",
    requestUsageLedger,
    usageHorizon,
    tokenLedger,
    runIsolation,
    comparison: { purpose: "none" },
    prepareOnly: {
      enabled: true,
      servicesStarted: false,
      codexProcessesStarted: 0,
      providerRequestsIssued: 0,
      authFilesRead: false,
      authFilesCopied: false,
    },
    m0EvaluationBoundary,
  });
  artifacts.push(writeArtifact("ISOLATION-ELIGIBILITY-SYNTHETIC.json", {
    formalDataState: "blocked",
    runIsolation,
    repeatedRunIsolation,
    repeatIsolation,
    eligibility,
  }));

  const originalSystem = [
    "Claude Code",
    "# Harness",
    "rules",
    "# Session-specific guidance",
    "skills",
    "# Memory",
    "memory",
    "# Environment",
    "env",
  ].join("\n");
  const injectedSystem = originalSystem.replace(
    "# Memory",
    "<synthetic_memory_tools />\n# Memory",
  );
  const firstText = [
    "Claude Code",
    "# Harness",
    "rules",
    "# Session-specific guidance",
    "skills",
  ].join("\n");
  const secondText = ["# Memory", "memory", "# Environment", "env"].join("\n");
  const metadataParity = {
    schemaVersion: 2,
    measurementModuleId: "M2",
    supportedScope:
      "Single text blocks and multi-text-block insertion-only rebuilds whose original blocks remain exact ordered substrings. Unsupported rewrites raise a typed infrastructure failure before a forwardable provider request exists.",
    cases: [
      await captureMetadataCase({
        caseId: "no-hook-single-marker",
        system: [{
          type: "text",
          text: "Stable system prefix",
          cache_control: { type: "ephemeral", marker: "single" },
        }],
        expectedText: "Stable system prefix",
      }),
      await captureMetadataCase({
        caseId: "anchor-single-marker",
        system: [{
          type: "text",
          text: originalSystem,
          cache_control: { type: "ephemeral", marker: "single" },
        }],
        expectedText: injectedSystem,
        hook: { id: "synthetic-single-marker", content: "<synthetic_memory_tools />" },
      }),
      await captureMetadataCase({
        caseId: "anchor-two-markers",
        system: [
          {
            type: "text",
            text: firstText,
            cache_control: { type: "ephemeral", marker: "first" },
          },
          {
            type: "text",
            text: secondText,
            cache_control: { type: "ephemeral", marker: "second" },
          },
        ],
        expectedText: [firstText, "<synthetic_memory_tools />", secondText].join("\n"),
        hook: { id: "synthetic-two-markers", content: "<synthetic_memory_tools />" },
      }),
      await captureMetadataCase({
        caseId: "anchor-two-markers-in-block-infrastructure-failure",
        system: [
          {
            type: "text",
            text: firstText,
            cache_control: { type: "ephemeral", marker: "first" },
          },
          {
            type: "text",
            text: secondText,
            cache_control: { type: "ephemeral", marker: "second" },
          },
        ],
        expectedText: [firstText, secondText].join("\n"),
        expectedOutcome: "pipeline_infrastructure_failure",
        hook: {
          id: "synthetic-two-markers-unsupported",
          content: "<synthetic_memory_tools />",
          relation: "inside_append",
        },
      }),
    ],
  };
  artifacts.push(writeArtifact("METADATA-PARITY.json", metadataParity));

  artifacts.push(writeArtifact("INTERFACE-MANIFEST.json", {
    schemaVersion: 2,
    measurementModuleId: "M2",
    formalDataState: "blocked",
    formalDataGate: {
      status: "FORMAL_DATA_BLOCKED",
      owner: "Integration",
      reason: "formal Worlds, real-chain adapter, and frozen compiler/capture attestation are not integrated",
    },
    finalEligibilityOwner: "Integration",
    identitySeparation: {
      measurementModuleId: "M2",
      variantId: "per-run Prompt candidate such as V0, V0-C, V1, V2, or V3",
      rule: "measurementModuleId and variantId are independent identities",
    },
    providerContracts: providerFixtureInputs.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      provider: fixture.input.provider,
      schema: fixture.input.schema,
      apiVersion: fixture.input.apiVersion,
      adapterVersion: fixture.input.adapterVersion,
      requiredFields: fixture.input.requiredFields,
      unsupportedFields: fixture.input.unsupportedFields,
    })),
    tokenAccounting: {
      authoritative: ["totalInjectionTokens", "toolDescriptionStaticTokens"],
      diagnostics: [
        "staticTemplateTokens",
        "executionContractTokens",
        "runtimeBindingTokens",
        "dynamicAssetTokens",
      ],
      componentRule: "independently_encoded_non_additive",
      providerUsageRule: "never add local token estimates to provider totals",
      classificationContract: {
        contractId: TOKEN_CLASSIFICATION_CONTRACT.contractId,
        contractVersion: TOKEN_CLASSIFICATION_CONTRACT.contractVersion,
        contractSha256: TOKEN_CLASSIFICATION_CONTRACT.contractSha256,
        compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
        segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
        sourceKindToComponent: TOKEN_CLASSIFICATION_CONTRACT.sourceKindToComponent,
      },
      trustedSourceManifest: {
        canonicalSha256: sourceManifest.canonicalSha256,
        sourceInventorySha256: sourceManifest.sourceInventorySha256,
        orderedSources: sourceManifest.orderedSources,
      },
      formalCompilerClosure: tokenLedger.classification.formalCompilerClosure,
    },
    hashSemantics: {
      caseInputControlSha256: "Frozen case/query/context control; excludes Variant prompt text.",
      comparisonGroupSha256: "Binds planned variant, counterfactual, or repeat comparison members.",
      providerRequestSha256: "Complete provider request for diagnostics; never an equality Gate because fresh runtime bindings may differ.",
      staticPromptSha256: "Frozen model-visible Variant/static Prompt before fresh runtime bindings.",
      executionIdentitySha256: "Frozen model, reasoning effort, verbosity, Codex CLI version, provider, usage schema, API/adapter versions, and usage-field contract.",
      requestUsageLedgerSha256: "M2-owned ordered request/attempt/trace/phase usage evidence plus deterministic cumulative totals.",
      snapshotSha256: "Expected and restored MemoryProxy asset snapshot identity.",
      visibleAssetsSha256: "Exact provider-visible asset-set identity.",
    },
    comparisonPurposes: {
      variant: "Same case input, repeat, execution identity, snapshot, and assets; Variant id and static Prompt hash must differ, while the full provider request is diagnostic.",
      counterfactual: "Same Variant/static Prompt, repeat, execution identity, snapshot, and assets; paired positive/negative case inputs and full requests differ.",
      repeat: "Same case input, Variant/static Prompt, execution identity, snapshot, and assets; repeat index and fresh run state differ, so full provider request equality is diagnostic only.",
      none: "Ordinary run; paired evidence is not required.",
    },
    comparisonControlManifest: {
      universalEqual: [
        "comparisonGroupSha256",
        "executionIdentity.canonicalSha256",
        "snapshot.id+expectedSha256+restoredSha256",
        "visibleAssetsSha256",
      ],
      universalDistinct: [
        "runId",
        "runNamespace",
        "session.id",
        "memoryProxyContext.id",
        "localState.pathId",
      ],
      variant: {
        equal: ["caseId", "repeatIndex", "caseInputControlSha256"],
        distinct: ["variantId", "staticPromptSha256"],
        diagnosticOnly: ["providerRequestSha256"],
      },
      counterfactual: {
        equal: ["repeatIndex", "variantId", "staticPromptSha256"],
        distinct: ["caseInputControlSha256", "counterfactualRole"],
        diagnosticOnly: ["providerRequestSha256", "caseId"],
      },
      repeat: {
        equal: ["caseId", "variantId", "caseInputControlSha256", "staticPromptSha256"],
        distinct: ["repeatIndex"],
        diagnosticOnly: ["providerRequestSha256"],
      },
    },
    requestUsageAccounting: {
      owner: "M2",
      granularity: "request_and_phase",
      identity: ["runId", "traceId", "requestId", "observedAttemptIds", "phaseId"],
      cumulativeFields: [
        "providerInputToEvaluationHorizon",
        "providerInputToTerminalGivenSuccess",
        "providerTotalInputTokens",
        "ordinaryInputTokens",
        "cacheReadInputTokens",
        "cacheWriteInputTokens",
        "outputTokens",
        "reasoningOrThinkingTokens",
      ],
      successfulTerminalRule: "providerInputToTerminalGivenSuccess equals providerInputToEvaluationHorizon exactly",
      failedTerminalRule: "providerInputToTerminalGivenSuccess is null",
    },
    m0Integration: {
      owner: "M0",
      requiredInterface: "M0_EVALUATION_BOUNDARY",
      boundaryFactsOnly: [
        "traceId",
        "evaluationPrefixSha256",
        "evaluationAttemptPrefix.requestId",
        "attemptId",
        "evaluationAttemptPrefix.phaseId",
        "evaluationHorizonRequestId",
        "evaluationHorizonPhaseId",
        "terminalBoundaryGivenSuccess.terminalAttemptId",
        "modelRoundsToTerminal",
        "tdaiCallCount",
        "timeToTerminalMs",
      ],
      usageTotalsOwnedByM0: false,
    },
    metadataParityScope: metadataParity.supportedScope,
  }));

  artifacts.push(writeArtifact("NO-MODEL-GATE.json", {
    schemaVersion: 2,
    measurementModuleId: "M2",
    status: "FORMAL_DATA_BLOCKED",
    modelRuns: 0,
    codexProcessesStarted: 0,
    providerRequestsIssued: 0,
    servicesStarted: false,
    authFilesRead: false,
    authFilesCopied: false,
    providerFixtures: "synthetic_only",
    finalEligibilityFieldPresent: false,
    finalEligibilityOwner: "Integration",
    m2EvidenceStatus: eligibility.m2EvidenceStatus,
    blockers: eligibility.blockers,
    tokenLedgerCanonicalSha256: tokenLedger.canonicalSha256,
    requestUsageLedgerCanonicalSha256: requestUsageLedger.ledger.canonicalSha256,
    usageHorizonCanonicalSha256: usageHorizon.canonicalSha256,
    unsupportedMetadataForwardableRequestsProduced: metadataParity.cases.filter(
      (item) => item.outcome === "pipeline_infrastructure_failure"
        && item.forwardableProviderRequestProduced,
    ).length,
    repeatIsolationStatus: repeatIsolation.pairStatus,
  }));

  writeArtifact("ARTIFACT-SHA256.json", {
    schemaVersion: 2,
    measurementModuleId: "M2",
    artifacts,
  });
}

await main();
