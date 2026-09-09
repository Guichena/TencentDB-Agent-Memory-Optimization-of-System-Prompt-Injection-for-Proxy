import { canonicalSha256 } from "./canonical-json.js";
import type {
  ProviderUsageFieldState,
  ProviderUsageNormalizationResult,
} from "./provider-usage.js";

export type IsolationBlockerCode =
  | "RUN_ID_INVALID"
  | "RUN_NAMESPACE_INVALID"
  | "CASE_ID_INVALID"
  | "VARIANT_ID_INVALID"
  | "REPEAT_INDEX_INVALID"
  | "CASE_INPUT_CONTROL_SHA256_INVALID"
  | "COMPARISON_GROUP_SHA256_INVALID"
  | "PROVIDER_REQUEST_SHA256_INVALID"
  | "STATIC_PROMPT_SHA256_INVALID"
  | "MODEL_ID_INVALID"
  | "REASONING_EFFORT_INVALID"
  | "VERBOSITY_INVALID"
  | "CODEX_CLI_VERSION_INVALID"
  | "USAGE_PROVIDER_INVALID"
  | "USAGE_SCHEMA_INVALID"
  | "USAGE_API_VERSION_INVALID"
  | "USAGE_ADAPTER_VERSION_INVALID"
  | "USAGE_NORMALIZATION_BLOCKED"
  | "SESSION_ID_INVALID"
  | "MEMORY_PROXY_CONTEXT_ID_INVALID"
  | "SNAPSHOT_ID_INVALID"
  | "SNAPSHOT_EXPECTED_SHA256_INVALID"
  | "SNAPSHOT_RESTORED_SHA256_INVALID"
  | "VISIBLE_ASSETS_SHA256_INVALID"
  | "LOCAL_STATE_ID_INVALID"
  | "FRESH_SESSION_NOT_PROVEN"
  | "FRESH_MEMORY_PROXY_CONTEXT_NOT_PROVEN"
  | "SNAPSHOT_RESTORE_FAILED"
  | "SNAPSHOT_HASH_MISMATCH"
  | "LOCAL_STATE_NOT_FRESH"
  | "LOCAL_HISTORY_INHERITED";

export interface BuildRunIsolationEvidenceInput {
  runId: string;
  runNamespace: string;
  caseId: string;
  variantId: string;
  repeatIndex: number;
  /** Hash of the frozen case/query/context control, excluding Variant prompt differences. */
  caseInputControlSha256: string;
  /** Hash binding members of one planned variant/counterfactual/repeat comparison. */
  comparisonGroupSha256: string;
  /** Hash of the complete provider request; diagnostic only because fresh bindings may differ. */
  providerRequestSha256: string;
  /** Hash of the frozen Variant/static Prompt before fresh runtime bindings are applied. */
  staticPromptSha256: string;
  execution: {
    modelId: string;
    reasoningEffort: string;
    verbosity: string;
    codexCliVersion: string;
  };
  counterfactualRole: "positive" | "negative" | null;
  session: { id: string; fresh: boolean };
  memoryProxyContext: { id: string; fresh: boolean };
  snapshot: {
    id: string;
    expectedSha256: string;
    restoredSha256: string;
    restoreSucceeded: boolean;
  };
  visibleAssetsSha256: string;
  localState: {
    pathId: string;
    fresh: boolean;
    inheritedHistory: boolean;
  };
  usage: ProviderUsageNormalizationResult;
}

export interface RunExecutionIdentityEvidence {
  modelId: string;
  reasoningEffort: string;
  verbosity: string;
  codexCliVersion: string;
  provider: ProviderUsageNormalizationResult["provider"];
  usageSchema: ProviderUsageNormalizationResult["schema"];
  apiVersion: string;
  adapterVersion: string;
  requiredUsageFields: readonly string[];
  unsupportedUsageFields: readonly string[];
  canonicalSha256: string;
}

export interface ProviderCacheEvidence {
  cacheLane: "cold" | "warm" | "unknown";
  cacheReadInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  cacheReadState: ProviderUsageFieldState;
  cacheWriteState: ProviderUsageFieldState;
  telemetryUsable: boolean;
}

export interface RunIsolationEvidence extends Omit<BuildRunIsolationEvidenceInput, "usage" | "execution"> {
  schemaVersion: 2;
  executionIdentity: RunExecutionIdentityEvidence | null;
  providerCache: ProviderCacheEvidence;
  isolationStatus: "ready" | "blocked";
  blockers: IsolationBlockerCode[];
}

export type PairedIsolationBlockerCode =
  | "LEFT_RUN_ISOLATION_BLOCKED"
  | "RIGHT_RUN_ISOLATION_BLOCKED"
  | "PAIR_CASE_MISMATCH"
  | "PAIR_REPEAT_MISMATCH"
  | "PAIR_REPEAT_NOT_DISTINCT"
  | "PAIR_VARIANT_MISMATCH"
  | "PAIR_VARIANT_NOT_DISTINCT"
  | "PAIR_CASE_INPUT_CONTROL_MISMATCH"
  | "PAIR_CASE_INPUT_CONTROL_NOT_DISTINCT"
  | "PAIR_STATIC_PROMPT_MISMATCH"
  | "PAIR_STATIC_PROMPT_NOT_DISTINCT"
  | "PAIR_EXECUTION_IDENTITY_MISMATCH"
  | "PAIR_COMPARISON_GROUP_MISMATCH"
  | "PAIR_COUNTERFACTUAL_ROLE_INVALID"
  | "PAIR_SNAPSHOT_MISMATCH"
  | "PAIR_VISIBLE_ASSET_MISMATCH"
  | "PAIR_RUN_ID_REUSED"
  | "PAIR_RUN_NAMESPACE_REUSED"
  | "PAIR_SESSION_REUSED"
  | "PAIR_MEMORY_PROXY_CONTEXT_REUSED"
  | "PAIR_LOCAL_STATE_REUSED";

export interface PairedIsolationEvidence {
  schemaVersion: 2;
  leftRunId: string;
  rightRunId: string;
  comparisonPurpose: "variant" | "counterfactual" | "repeat";
  controls: {
    sameCase: boolean;
    sameRepeat: boolean;
    sameVariant: boolean;
    sameCaseInputControl: boolean;
    sameProviderRequest: boolean;
    sameStaticPrompt: boolean;
    distinctStaticPrompt: boolean;
    sameExecutionIdentity: boolean;
    sameComparisonGroup: boolean;
    distinctCounterfactualRole: boolean;
    sameSnapshot: boolean;
    sameVisibleAssets: boolean;
    distinctRunId: boolean;
    distinctRunNamespace: boolean;
    distinctSession: boolean;
    distinctMemoryProxyContext: boolean;
    distinctLocalState: boolean;
  };
  pairStatus: "ready" | "blocked";
  blockers: PairedIsolationBlockerCode[];
}

function providerCacheEvidence(usage: ProviderUsageNormalizationResult): ProviderCacheEvidence {
  const cacheReadState = usage.fieldStates.cacheReadInputTokens;
  const cacheWriteState = usage.fieldStates.cacheWriteInputTokens;
  const read = usage.ok ? usage.usage?.cacheReadInputTokens ?? null : null;
  const write = usage.ok ? usage.usage?.cacheWriteInputTokens ?? null : null;
  const telemetryUsable = usage.ok && cacheReadState === "reported" && read !== null;
  return {
    cacheLane: telemetryUsable ? (read > 0 ? "warm" : "cold") : "unknown",
    cacheReadInputTokens: read,
    cacheWriteInputTokens: write,
    cacheReadState,
    cacheWriteState,
    telemetryUsable,
  };
}

export function buildRunExecutionIdentityEvidence(
  input: Pick<BuildRunIsolationEvidenceInput, "execution" | "usage">,
): RunExecutionIdentityEvidence {
  const withoutSha = {
    modelId: input.execution.modelId,
    reasoningEffort: input.execution.reasoningEffort,
    verbosity: input.execution.verbosity,
    codexCliVersion: input.execution.codexCliVersion,
    provider: input.usage.provider,
    usageSchema: input.usage.schema,
    apiVersion: input.usage.apiVersion,
    adapterVersion: input.usage.adapterVersion,
    requiredUsageFields: [...input.usage.requiredFields].sort(),
    unsupportedUsageFields: [...input.usage.unsupportedFields].sort(),
  };
  return {
    ...withoutSha,
    canonicalSha256: canonicalSha256(withoutSha),
  };
}

export function buildRunIsolationEvidence(input: BuildRunIsolationEvidenceInput): RunIsolationEvidence {
  const blockers: IsolationBlockerCode[] = [];
  const isIdentity = (value: unknown): value is string => (
    typeof value === "string" && value.trim().length > 0
  );
  const isSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);
  if (!isIdentity(input.runId)) blockers.push("RUN_ID_INVALID");
  if (!isIdentity(input.runNamespace)) blockers.push("RUN_NAMESPACE_INVALID");
  if (!isIdentity(input.caseId)) blockers.push("CASE_ID_INVALID");
  if (!isIdentity(input.variantId)) blockers.push("VARIANT_ID_INVALID");
  if (!Number.isSafeInteger(input.repeatIndex) || input.repeatIndex < 0) blockers.push("REPEAT_INDEX_INVALID");
  if (!isSha256(input.caseInputControlSha256)) blockers.push("CASE_INPUT_CONTROL_SHA256_INVALID");
  if (!isSha256(input.comparisonGroupSha256)) blockers.push("COMPARISON_GROUP_SHA256_INVALID");
  if (!isSha256(input.providerRequestSha256)) blockers.push("PROVIDER_REQUEST_SHA256_INVALID");
  if (!isSha256(input.staticPromptSha256)) blockers.push("STATIC_PROMPT_SHA256_INVALID");
  if (!isIdentity(input.execution.modelId)) blockers.push("MODEL_ID_INVALID");
  if (!isIdentity(input.execution.reasoningEffort)) blockers.push("REASONING_EFFORT_INVALID");
  if (!isIdentity(input.execution.verbosity)) blockers.push("VERBOSITY_INVALID");
  if (!isIdentity(input.execution.codexCliVersion)) blockers.push("CODEX_CLI_VERSION_INVALID");
  if (input.usage.provider !== "openai" && input.usage.provider !== "anthropic") {
    blockers.push("USAGE_PROVIDER_INVALID");
  }
  if (!isIdentity(input.usage.schema)) blockers.push("USAGE_SCHEMA_INVALID");
  if (!isIdentity(input.usage.apiVersion)) blockers.push("USAGE_API_VERSION_INVALID");
  if (!isIdentity(input.usage.adapterVersion)) blockers.push("USAGE_ADAPTER_VERSION_INVALID");
  if (!input.usage.ok || input.usage.usage?.usageCompleteForRequiredFields !== true) {
    blockers.push("USAGE_NORMALIZATION_BLOCKED");
  }
  if (!isIdentity(input.session.id)) blockers.push("SESSION_ID_INVALID");
  if (!isIdentity(input.memoryProxyContext.id)) blockers.push("MEMORY_PROXY_CONTEXT_ID_INVALID");
  if (!isIdentity(input.snapshot.id)) blockers.push("SNAPSHOT_ID_INVALID");
  if (!isSha256(input.snapshot.expectedSha256)) blockers.push("SNAPSHOT_EXPECTED_SHA256_INVALID");
  if (!isSha256(input.snapshot.restoredSha256)) blockers.push("SNAPSHOT_RESTORED_SHA256_INVALID");
  if (!isSha256(input.visibleAssetsSha256)) blockers.push("VISIBLE_ASSETS_SHA256_INVALID");
  if (!isIdentity(input.localState.pathId)) blockers.push("LOCAL_STATE_ID_INVALID");
  if (!input.session.fresh) blockers.push("FRESH_SESSION_NOT_PROVEN");
  if (!input.memoryProxyContext.fresh) blockers.push("FRESH_MEMORY_PROXY_CONTEXT_NOT_PROVEN");
  if (!input.snapshot.restoreSucceeded) blockers.push("SNAPSHOT_RESTORE_FAILED");
  if (input.snapshot.expectedSha256 !== input.snapshot.restoredSha256) {
    blockers.push("SNAPSHOT_HASH_MISMATCH");
  }
  if (!input.localState.fresh) blockers.push("LOCAL_STATE_NOT_FRESH");
  if (input.localState.inheritedHistory) blockers.push("LOCAL_HISTORY_INHERITED");

  const executionIdentityReady = (
    isIdentity(input.execution.modelId)
    && isIdentity(input.execution.reasoningEffort)
    && isIdentity(input.execution.verbosity)
    && isIdentity(input.execution.codexCliVersion)
    && (input.usage.provider === "openai" || input.usage.provider === "anthropic")
    && isIdentity(input.usage.schema)
    && isIdentity(input.usage.apiVersion)
    && isIdentity(input.usage.adapterVersion)
  );

  return {
    schemaVersion: 2,
    runId: input.runId,
    runNamespace: input.runNamespace,
    caseId: input.caseId,
    variantId: input.variantId,
    repeatIndex: input.repeatIndex,
    caseInputControlSha256: input.caseInputControlSha256,
    comparisonGroupSha256: input.comparisonGroupSha256,
    providerRequestSha256: input.providerRequestSha256,
    staticPromptSha256: input.staticPromptSha256,
    executionIdentity: executionIdentityReady
      ? buildRunExecutionIdentityEvidence(input)
      : null,
    counterfactualRole: input.counterfactualRole,
    session: { ...input.session },
    memoryProxyContext: { ...input.memoryProxyContext },
    snapshot: { ...input.snapshot },
    visibleAssetsSha256: input.visibleAssetsSha256,
    localState: { ...input.localState },
    providerCache: providerCacheEvidence(input.usage),
    isolationStatus: blockers.length === 0 ? "ready" : "blocked",
    blockers,
  };
}

export function assessPairedIsolationEvidence(
  left: RunIsolationEvidence,
  right: RunIsolationEvidence,
  options: { purpose: "variant" | "counterfactual" | "repeat" },
): PairedIsolationEvidence {
  const controls = {
    sameCase: left.caseId === right.caseId,
    sameRepeat: left.repeatIndex === right.repeatIndex,
    sameVariant: left.variantId === right.variantId,
    sameCaseInputControl: left.caseInputControlSha256 === right.caseInputControlSha256,
    sameProviderRequest: left.providerRequestSha256 === right.providerRequestSha256,
    sameStaticPrompt: left.staticPromptSha256 === right.staticPromptSha256,
    distinctStaticPrompt: left.staticPromptSha256 !== right.staticPromptSha256,
    sameExecutionIdentity:
      left.executionIdentity !== null
      && right.executionIdentity !== null
      && left.executionIdentity.canonicalSha256 === right.executionIdentity.canonicalSha256,
    sameComparisonGroup: left.comparisonGroupSha256 === right.comparisonGroupSha256,
    distinctCounterfactualRole:
      left.counterfactualRole !== null
      && right.counterfactualRole !== null
      && left.counterfactualRole !== right.counterfactualRole,
    sameSnapshot:
      left.snapshot.id === right.snapshot.id
      && left.snapshot.expectedSha256 === right.snapshot.expectedSha256
      && left.snapshot.restoredSha256 === right.snapshot.restoredSha256,
    sameVisibleAssets: left.visibleAssetsSha256 === right.visibleAssetsSha256,
    distinctRunId: left.runId !== right.runId,
    distinctRunNamespace: left.runNamespace !== right.runNamespace,
    distinctSession: left.session.id !== right.session.id,
    distinctMemoryProxyContext: left.memoryProxyContext.id !== right.memoryProxyContext.id,
    distinctLocalState: left.localState.pathId !== right.localState.pathId,
  };
  const blockers: PairedIsolationBlockerCode[] = [];
  if (left.isolationStatus !== "ready") blockers.push("LEFT_RUN_ISOLATION_BLOCKED");
  if (right.isolationStatus !== "ready") blockers.push("RIGHT_RUN_ISOLATION_BLOCKED");
  if (!controls.sameComparisonGroup) blockers.push("PAIR_COMPARISON_GROUP_MISMATCH");
  if (!controls.sameExecutionIdentity) blockers.push("PAIR_EXECUTION_IDENTITY_MISMATCH");
  if (options.purpose === "variant") {
    if (!controls.sameCase) blockers.push("PAIR_CASE_MISMATCH");
    if (!controls.sameRepeat) blockers.push("PAIR_REPEAT_MISMATCH");
    if (!controls.sameCaseInputControl) blockers.push("PAIR_CASE_INPUT_CONTROL_MISMATCH");
    if (controls.sameVariant) blockers.push("PAIR_VARIANT_NOT_DISTINCT");
    if (!controls.distinctStaticPrompt) blockers.push("PAIR_STATIC_PROMPT_NOT_DISTINCT");
  } else if (options.purpose === "counterfactual") {
    if (!controls.sameRepeat) blockers.push("PAIR_REPEAT_MISMATCH");
    if (!controls.sameVariant) blockers.push("PAIR_VARIANT_MISMATCH");
    if (!controls.sameStaticPrompt) blockers.push("PAIR_STATIC_PROMPT_MISMATCH");
    if (controls.sameCaseInputControl) blockers.push("PAIR_CASE_INPUT_CONTROL_NOT_DISTINCT");
    if (!controls.distinctCounterfactualRole) blockers.push("PAIR_COUNTERFACTUAL_ROLE_INVALID");
  } else {
    if (!controls.sameCase) blockers.push("PAIR_CASE_MISMATCH");
    if (!controls.sameVariant) blockers.push("PAIR_VARIANT_MISMATCH");
    if (controls.sameRepeat) blockers.push("PAIR_REPEAT_NOT_DISTINCT");
    if (!controls.sameCaseInputControl) blockers.push("PAIR_CASE_INPUT_CONTROL_MISMATCH");
    if (!controls.sameStaticPrompt) blockers.push("PAIR_STATIC_PROMPT_MISMATCH");
  }
  if (!controls.sameSnapshot) blockers.push("PAIR_SNAPSHOT_MISMATCH");
  if (!controls.sameVisibleAssets) blockers.push("PAIR_VISIBLE_ASSET_MISMATCH");
  if (!controls.distinctRunId) blockers.push("PAIR_RUN_ID_REUSED");
  if (!controls.distinctRunNamespace) blockers.push("PAIR_RUN_NAMESPACE_REUSED");
  if (!controls.distinctSession) blockers.push("PAIR_SESSION_REUSED");
  if (!controls.distinctMemoryProxyContext) blockers.push("PAIR_MEMORY_PROXY_CONTEXT_REUSED");
  if (!controls.distinctLocalState) blockers.push("PAIR_LOCAL_STATE_REUSED");

  return {
    schemaVersion: 2,
    leftRunId: left.runId,
    rightRunId: right.runId,
    comparisonPurpose: options.purpose,
    controls,
    pairStatus: blockers.length === 0 ? "ready" : "blocked",
    blockers,
  };
}
