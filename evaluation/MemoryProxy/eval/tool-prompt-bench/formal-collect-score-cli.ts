import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEffectiveFormalInvocation,
  buildFormalRunIsolationIdentity,
  FORMAL_PROMPT_FREEZE_COMMIT,
  FORMAL_PROMPT_FREEZE_TAG_OBJECT,
  validatePreflightReceipt,
  type FormalExecutionReceipt,
} from "./formal-execution-runner.js";
import type { PreparedFormalRun } from "./formal-prepare-runner.js";
import { inspectFormalCacheStructureFreeze } from "./formal-cache-structure-gate.js";
import { FORMAL_EPISODE_POLICY } from "./formal-episode-policy.js";
import {
  loadFormalDatasetMetadata,
  openFormalProviderSplit,
  resolveFormalDataFreeze,
  type FormalDataFreeze,
  type FormalProviderRuntimeCase,
  type FormalPublicDatasourceSplit,
} from "./formal-runtime/index.js";
import {
  loadPrivateMeasurementSplit,
  type PrivateMeasurementSplitData,
} from "./formal-runtime/private-loader.js";
import {
  assertFormalWorldContract,
  type FormalWorldContract,
} from "./worlds/formal-schema.js";
import { buildRealChainProviderInput } from "./real-chain-adapter.js";
import { canonicalSha256 as canonicalSha256V1 } from "./worlds/formal-snapshot.js";
import selectionContract from "./measurement-v2/SELECTION-CONTRACT.json";
import { canonicalSha256 } from "./measurement-v2/canonical-json.js";
import {
  buildFormalPairEvidenceV2,
  type FormalPairRepeatStageV2,
  type SealedFormalPairRunEvidenceV2,
} from "./measurement-v2/formal-pair-evidence-builder.js";
import {
  buildFormalM2PreGoldEvidence,
  type FormalM2PreGoldEvidence,
} from "./measurement-v2/formal-m2-evidence-builder.js";
import { buildRunExecutionIdentityEvidence } from "./measurement-v2/isolation-evidence.js";
import {
  integrateFormalMeasurement,
  type FormalPairScoringInput,
} from "./measurement-v2/formal-measurement-integration.js";
import {
  collectObservedToolEvents,
  type CollectedObservedRun,
  type ObservedRunWindow,
} from "./measurement-v2/observed-event-collector.js";
import {
  collectProviderEvidence,
  FORMAL_PROVIDER_USAGE_CONTRACT,
  type CollectedProviderRun,
} from "./measurement-v2/provider-evidence-collector.js";
import type { ProviderUsageNormalizationResult } from "./measurement-v2/provider-usage.js";

export type FormalCampaignPhase =
  | "dev-discovery"
  | "dev-confirmation"
  | "hidden";

export interface FormalCollectScoreCliOptions {
  readonly campaignId: string;
  readonly campaignRoot: string;
  readonly traceCampaignDirectory: string;
  readonly repositoryRoot: string;
  readonly split: "dev" | "hidden_test";
  readonly campaignPhase: FormalCampaignPhase;
  readonly allowHiddenTest: boolean;
  readonly outputPath: string;
}

export interface FormalCampaignExecutionIdentity {
  readonly executionIdentitySha256: string;
  readonly apiProtocol: "responses-v1";
}

export interface PreparedFormalPairScoringV1 {
  readonly executionCohort: FormalCampaignExecutionIdentity;
  readonly pairScoring: FormalPairScoringInput;
}

export interface BuildFormalM2CampaignPreGoldEvidenceInput {
  readonly campaignPhase: FormalCampaignPhase;
  readonly publicDatasource: FormalPublicDatasourceSplit;
  readonly executions: readonly FormalExecutionReceipt[];
  readonly toolRuns: readonly CollectedObservedRun[];
  readonly providerRuns: readonly CollectedProviderRun[];
}

export function formalCampaignPhaseToPairStage(
  phase: FormalCampaignPhase,
): FormalPairRepeatStageV2 {
  if (phase === "dev-discovery") return "dev_discovery";
  if (phase === "dev-confirmation") return "dev_finalist_confirmation";
  return "hidden";
}

export function formatFormalRepeatId(repeat: number): string {
  if (!Number.isSafeInteger(repeat) || repeat < 1) {
    throw new Error("formal repeat must be a positive safe integer");
  }
  return `r${String(repeat).padStart(2, "0")}`;
}

export function assertFormalCampaignIsolationUniqueness(
  executions: readonly FormalExecutionReceipt[],
): void {
  const dimensions: ReadonlyArray<readonly [string, (run: FormalExecutionReceipt) => string]> = [
    ["runId", (run) => run.runId],
    ["run namespace", (run) => run.preparationBinding.runNamespace],
    ["session", (run) => run.sessionId],
    ["MemoryProxy context", (run) => run.preparationBinding.memoryProxyContextId],
    ["local state", (run) => run.preparationBinding.localStateId],
  ];
  for (const [label, select] of dimensions) {
    const values = executions.map(select);
    if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) {
      throw new Error(`formal campaign must use a unique non-blank ${label} per run`);
    }
  }
  for (const run of executions) {
    if (run.preparationBinding.freshLocalState !== true
      || run.preparationBinding.inheritedHistory !== false) {
      throw new Error(`${run.runId}: formal campaign local state is not fresh`);
    }
  }
}

export function buildFormalPairRunBindings(
  campaignId: string,
  executions: readonly FormalExecutionReceipt[],
  m2PreGoldEvidence: readonly FormalM2PreGoldEvidence[],
): readonly SealedFormalPairRunEvidenceV2[] {
  const normalizedCampaignId = campaignId.trim();
  if (!normalizedCampaignId) throw new Error("campaignId must be non-blank");
  const executionByRunId = uniqueRunMap(executions, "execution receipt");
  const m2ByRunId = uniqueRunMap(m2PreGoldEvidence, "M2 pre-Gold evidence");
  const m2IndexByRunId = new Map(
    m2PreGoldEvidence.map((evidence, index) => [evidence.runId, index] as const),
  );
  if (m2ByRunId.size !== executionByRunId.size) {
    throw new Error("Pair bindings require one M2 pre-Gold evidence item per execution");
  }

  const pairBindings: SealedFormalPairRunEvidenceV2[] = [];
  const seenRefs = new Set<string>();
  const seenHashes = new Set<string>();
  const seenSlots = new Set<string>();
  const seenLocalStateIds = new Set<string>();
  const ordered = [...executions].sort((left, right) => (
    left.variantId.localeCompare(right.variantId)
    || left.caseId.localeCompare(right.caseId)
    || left.repeat - right.repeat
    || left.runId.localeCompare(right.runId)
  ));
  for (const execution of ordered) {
    const m2PreGold = m2ByRunId.get(execution.runId);
    if (!m2PreGold) {
      throw new Error(`Pair binding is missing M2 pre-Gold run ${execution.runId}`);
    }
    assertM2PreGoldIdentity(execution, m2PreGold);
    const repeatId = formatFormalRepeatId(execution.repeat);
    const m2Index = m2IndexByRunId.get(execution.runId);
    if (m2Index === undefined) {
      throw new Error(`Pair binding is missing bundle M2 pre-Gold path for ${execution.runId}`);
    }
    const ref = `#/m2PreGoldEvidence/${m2Index}`;
    const sha256 = m2PreGold.canonicalSha256;
    const slot = `${execution.variantId}\u0000${execution.caseId}\u0000${repeatId}`;
    const localStateId = execution.preparationBinding.localStateId;
    if (
      seenRefs.has(ref)
      || seenHashes.has(sha256)
      || seenSlots.has(slot)
      || seenLocalStateIds.has(localStateId)
    ) {
      throw new Error(`Pair binding identity is not unique for ${execution.runId}`);
    }
    seenRefs.add(ref);
    seenHashes.add(sha256);
    seenSlots.add(slot);
    seenLocalStateIds.add(localStateId);
    pairBindings.push({
      caseId: execution.caseId,
      runId: execution.runId,
      repeatId,
      rawEvidenceArtifactRef: ref,
      rawEvidenceArtifactSha256: sha256,
      localStateId,
    });
  }
  return pairBindings;
}

export function deriveFormalCampaignExecutionIdentity(
  executions: readonly FormalExecutionReceipt[],
  providerRuns: readonly CollectedProviderRun[],
): FormalCampaignExecutionIdentity {
  if (executions.length === 0) throw new Error("formal campaign has no executions");
  const providers = uniqueRunMap(providerRuns, "provider run");
  const identityHashes = new Set<string>();
  for (const execution of executions) {
    assertSelectionExecutionCohort(execution);
    const providerRun = providers.get(execution.runId);
    if (!providerRun) throw new Error(`provider evidence is missing run ${execution.runId}`);
    assertCollectedRunIdentity(execution, providerRun, "provider run");
    if (providerRun.requests.length === 0) {
      throw new Error(`${execution.runId}: provider evidence has no requests`);
    }
    for (const request of providerRun.requests) {
      if (!/\/responses$/u.test(request.path)) {
        throw new Error(`${execution.runId}: provider request path is not a Responses endpoint`);
      }
      const usage = request.providerUsageNormalization;
      if (!usage || !usage.ok) {
        throw new Error(`${execution.runId}: provider usage normalization is incomplete`);
      }
      assertProviderUsageContract(usage);
      identityHashes.add(buildRunExecutionIdentityEvidence({
        execution: execution.executionIdentity,
        usage,
      }).canonicalSha256);
    }
  }
  if (identityHashes.size !== 1) {
    throw new Error("formal campaign contains multiple execution identities");
  }
  return {
    executionIdentitySha256: [...identityHashes][0],
    apiProtocol: "responses-v1",
  };
}

export function buildFormalM2CampaignPreGoldEvidence(
  input: BuildFormalM2CampaignPreGoldEvidenceInput,
): readonly FormalM2PreGoldEvidence[] {
  const expectedSplit = input.campaignPhase === "hidden" ? "hidden_test" : "dev";
  if (input.publicDatasource.split !== expectedSplit) {
    throw new Error("formal public datasource does not match campaign phase");
  }
  const cases = uniqueStringMap(
    input.publicDatasource.cases,
    (item) => item.provider.caseId,
    "formal public runtime case",
  );
  const tools = uniqueRunMap(input.toolRuns, "tool run");
  const providers = uniqueRunMap(input.providerRuns, "provider run");
  return [...input.executions]
    .sort((left, right) => (
      left.variantId.localeCompare(right.variantId)
      || left.caseId.localeCompare(right.caseId)
      || left.repeat - right.repeat
    ))
    .map((execution) => {
      const formalCase = cases.get(execution.caseId);
      const toolRun = tools.get(execution.runId);
      const providerRun = providers.get(execution.runId);
      if (!formalCase) {
        throw new Error(`${execution.runId}: formal case is absent from the campaign split`);
      }
      if (!toolRun || !providerRun) {
        throw new Error(`${execution.runId}: formal M2 evidence is missing a collected run`);
      }
      if (execution.snapshotBinding.snapshotId !== formalCase.binding.snapshotId
        || execution.visibleAssetSetSha256 !== formalCase.binding.visibleAssetSetSha256) {
        throw new Error(`${execution.runId}: execution does not match frozen public case binding`);
      }
      return buildFormalM2PreGoldEvidence({
        execution,
        toolRun,
        providerRun,
        frozenControl: {
          caseInputControlSha256: canonicalSha256(
            formalRuntimeCaseControlProjection(formalCase),
          ),
          comparisonGroupSha256: canonicalSha256({
            schemaVersion: "task1.formal-comparison-group.v1",
            formalDataRevision: selectionContract.formalData.tag,
            campaignPhase: input.campaignPhase,
            caseId: execution.caseId,
            repeatId: formatFormalRepeatId(execution.repeat),
          }),
          visibleAssetSetSha256: formalCase.binding.visibleAssetSetSha256,
        },
      });
    });
}

export function buildFormalExpectedProviderPrompts(
  publicDatasource: FormalPublicDatasourceSplit,
  executions: readonly FormalExecutionReceipt[],
): ReadonlyMap<string, Readonly<{ userPrompt: string; userPromptSha256: string }>> {
  const cases = uniqueStringMap(
    publicDatasource.cases,
    (item) => item.provider.caseId,
    "formal public runtime case",
  );
  const result = new Map<string, Readonly<{ userPrompt: string; userPromptSha256: string }>>();
  for (const execution of executions) {
    if (result.has(execution.runId)) throw new Error(`duplicate formal execution run: ${execution.runId}`);
    const formalCase = cases.get(execution.caseId);
    if (!formalCase) throw new Error(`${execution.runId}: formal case is absent from the campaign split`);
    const messages = buildRealChainProviderInput({
      history: formalCase.provider.contextMessages,
      finalQuery: formalCase.provider.query,
    });
    const userPrompt = messages[0]?.content[0]?.text;
    if (!userPrompt) throw new Error(`${execution.runId}: frozen provider prompt is empty`);
    const userPromptSha256 = createHash("sha256").update(userPrompt, "utf8").digest("hex");
    if (execution.providerPromptSha256 !== userPromptSha256) {
      throw new Error(`${execution.runId}: execution receipt does not match the frozen provider prompt`);
    }
    result.set(execution.runId, Object.freeze({ userPrompt, userPromptSha256 }));
  }
  return result;
}

export function prepareFormalPairScoring(
  input: Readonly<{
    campaignId: string;
    campaignPhase: FormalCampaignPhase;
    executions: readonly FormalExecutionReceipt[];
    providerRuns: readonly CollectedProviderRun[];
    m2PreGoldEvidence: readonly FormalM2PreGoldEvidence[];
    privateMeasurement: PrivateMeasurementSplitData;
    formalWorld: FormalWorldContract;
  }>,
): PreparedFormalPairScoringV1 {
  const variants = new Set(input.executions.map((execution) => execution.variantId));
  if (variants.size !== 1) {
    throw new Error("one formal collection campaign must contain one variant");
  }
  const pairBindings = buildFormalPairRunBindings(
    input.campaignId,
    input.executions,
    input.m2PreGoldEvidence,
  );
  const executionCohort = deriveFormalCampaignExecutionIdentity(
    input.executions,
    input.providerRuns,
  );
  const pairScoring = buildFormalPairEvidenceV2({
    privateMeasurement: input.privateMeasurement,
    formalWorld: input.formalWorld,
    repeatStage: formalCampaignPhaseToPairStage(input.campaignPhase),
    variantId: [...variants][0],
    apiProtocol: executionCohort.apiProtocol,
    executionIdentitySha256: executionCohort.executionIdentitySha256,
    runs: pairBindings,
  });
  return { executionCohort, pairScoring };
}

export function parseFormalCollectScoreCliArguments(
  argv: readonly string[],
): FormalCollectScoreCliOptions {
  const booleanFlags = new Set(["--allow-hidden-test"]);
  const valueFlags = new Set([
    "--campaign-id",
    "--campaign-root",
    "--trace-campaign-dir",
    "--repo-root",
    "--split",
    "--campaign-phase",
    "--output",
  ]);
  const values = new Map<string, string>();
  let allowHiddenTest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (allowHiddenTest) throw new Error(`duplicate formal collection argument: ${flag}`);
      allowHiddenTest = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`unsupported formal collection argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (values.has(flag)) throw new Error(`duplicate formal collection argument: ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const split = required(values, "--split");
  if (split !== "dev" && split !== "hidden_test") {
    throw new Error("--split must be dev or hidden_test");
  }
  const campaignPhase = required(values, "--campaign-phase");
  if (campaignPhase !== "dev-discovery"
    && campaignPhase !== "dev-confirmation"
    && campaignPhase !== "hidden") {
    throw new Error(
      "--campaign-phase must be dev-discovery, dev-confirmation, or hidden",
    );
  }
  if ((campaignPhase === "hidden") !== (split === "hidden_test")) {
    throw new Error("campaign phase does not match split");
  }
  if (split === "hidden_test" && !allowHiddenTest) {
    throw new Error("hidden_test collection requires --allow-hidden-test");
  }
  return {
    campaignId: required(values, "--campaign-id"),
    campaignRoot: resolve(required(values, "--campaign-root")),
    traceCampaignDirectory: resolve(required(values, "--trace-campaign-dir")),
    repositoryRoot: resolve(required(values, "--repo-root")),
    split,
    campaignPhase,
    allowHiddenTest,
    outputPath: resolve(required(values, "--output")),
  };
}

export async function runFormalCollectScoreCli(
  options: FormalCollectScoreCliOptions,
): Promise<void> {
  const executions = await discoverExecutionReceipts(options.campaignRoot, options.campaignId);
  if (executions.length === 0) throw new Error("campaign contains no formal execution receipts");
  assertFormalCampaignIsolationUniqueness(executions);
  const proxyIds = new Set(executions.map((receipt) => receipt.proxyInstanceId));
  const knowledgeIds = new Set(executions.map((receipt) => receipt.knowledgeInstanceId));
  if (proxyIds.size !== 1 || knowledgeIds.size !== 1) {
    throw new Error("one campaign must use one Proxy and one Knowledge process instance");
  }
  const windows: ObservedRunWindow[] = executions.map((receipt) => ({
    runId: receipt.runId,
    caseId: receipt.caseId,
    variantId: receipt.variantId,
    sessionId: receipt.sessionId,
    startedAtUnixMicros: receipt.startedWallTimeUnixMicros,
    finishedAtUnixMicros: receipt.finishedWallTimeUnixMicros,
  }));
  const [memoryProxyJsonl, memoryKnowledgeJsonl, providerJsonl] = await Promise.all([
    readFile(join(options.traceCampaignDirectory, "memory-proxy.events.jsonl"), "utf8"),
    readFile(join(options.traceCampaignDirectory, "memory-knowledge.events.jsonl"), "utf8"),
    readFile(join(options.traceCampaignDirectory, "memory-proxy.provider-requests.jsonl"), "utf8"),
  ]);
  const expectedProxyInstanceId = [...proxyIds][0];
  const expectedKnowledgeInstanceId = [...knowledgeIds][0];
  const freeze = resolveFormalDataFreeze({ repositoryRoot: options.repositoryRoot });
  const publicDatasource = openFormalProviderSplit({
    freeze,
    split: options.split,
    ...(options.allowHiddenTest ? { allowHiddenTest: true as const } : {}),
    projection: "repo-backed-v2.1",
  });
  const expectedPromptsByRunId = buildFormalExpectedProviderPrompts(
    publicDatasource,
    executions,
  );
  const toolCampaign = collectObservedToolEvents({
    campaignId: options.campaignId,
    expectedProxyInstanceId,
    expectedKnowledgeInstanceId,
    runs: windows,
    memoryProxyJsonl,
    memoryKnowledgeJsonl,
  });
  const providerCampaign = collectProviderEvidence({
    campaignId: options.campaignId,
    expectedProxyInstanceId,
    runs: windows,
    expectedPromptsByRunId,
    providerJsonl,
  });
  const m2PreGoldEvidence = buildFormalM2CampaignPreGoldEvidence({
    campaignPhase: options.campaignPhase,
    publicDatasource,
    executions,
    toolRuns: toolCampaign.runs,
    providerRuns: providerCampaign.runs,
  });
  const cacheStructureGate = await inspectFormalCacheStructureFreeze({
    repositoryRoot: options.repositoryRoot,
    executions,
    m2PreGoldEvidence,
  });

  // Private Gold and Pair material become reachable only after every run has
  // a canonical pre-Gold M2 envelope built from the public datasource.
  const privateMeasurement = loadPrivateMeasurementSplit({
    freeze,
    split: options.split,
    ...(options.allowHiddenTest ? { allowHiddenTest: true as const } : {}),
    projection: "repo-backed-v2.1",
  });
  const formalWorld = await loadFrozenFormalWorld(freeze);
  const preparedPair = prepareFormalPairScoring({
    campaignId: options.campaignId,
    campaignPhase: options.campaignPhase,
    executions,
    providerRuns: providerCampaign.runs,
    m2PreGoldEvidence,
    privateMeasurement,
    formalWorld,
  });
  const measurement = integrateFormalMeasurement({
    campaignId: options.campaignId,
    executions,
    toolCampaign,
    providerCampaign,
    privateMeasurement,
    m2PreGoldEvidence,
    pairScoring: preparedPair.pairScoring,
  });
  const bundle = {
    schemaVersion: "task1.formal-measurement-bundle.v1",
    createdAt: new Date().toISOString(),
    campaignPhase: options.campaignPhase,
    executionCohort: preparedPair.executionCohort,
    rawEvidenceFiles: {
      memoryProxy: join(options.traceCampaignDirectory, "memory-proxy.events.jsonl"),
      memoryKnowledge: join(options.traceCampaignDirectory, "memory-knowledge.events.jsonl"),
      provider: join(options.traceCampaignDirectory, "memory-proxy.provider-requests.jsonl"),
    },
    toolCollection: toolCampaign,
    providerCollection: providerCampaign,
    cacheStructureGate,
    publicDatasourceBinding: {
      split: publicDatasource.split,
      count: publicDatasource.count,
      datasetContractRevision: publicDatasource.datasetContractRevision,
      snapshotCanonicalSha256: publicDatasource.snapshotCanonicalSha256,
      caseBindingsCanonicalSha256: publicDatasource.caseBindingsCanonicalSha256,
    },
    m2PreGoldEvidence,
    pairScoring: preparedPair.pairScoring,
    measurement,
  } as const;
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    outputPath: options.outputPath,
    formalCampaignEligible: measurement.formalCampaignEligible,
    eligibleRunCount: measurement.eligibleRunCount,
    excludedRunCount: measurement.excludedRunCount,
  }, null, 2)}\n`);
}

export async function discoverExecutionReceipts(
  campaignRoot: string,
  expectedCampaignId: string,
): Promise<FormalExecutionReceipt[]> {
  const found: FormalExecutionReceipt[] = [];
  const root = resolve(campaignRoot);
  const campaignId = expectedCampaignId.trim();
  if (!campaignId) throw new Error("formal receipt discovery requires a campaign id");
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name === "formal-execution-receipt.json") {
        found.push(await verifyExecutionReceiptArtifactSet(root, campaignId, path));
      }
    }
  }
  found.sort((left, right) => (
    left.variantId.localeCompare(right.variantId)
    || left.caseId.localeCompare(right.caseId)
    || left.repeat - right.repeat
  ));
  return found;
}

async function verifyExecutionReceiptArtifactSet(
  campaignRoot: string,
  expectedCampaignId: string,
  receiptPath: string,
): Promise<FormalExecutionReceipt> {
  const directory = dirname(receiptPath);
  const receipt = parseFormalExecutionReceipt(
    parseJson(await readFile(receiptPath, "utf8"), receiptPath),
    receiptPath,
  );
  const paths = {
    runManifest: join(directory, "run-manifest.json"),
    prepareCommand: join(directory, "prepare-command.json"),
    providerPrompt: join(directory, "provider-prompt.json"),
    preflightReceipt: join(directory, "formal-execution-preflight-receipt.json"),
    stdout: join(directory, "codex-events.jsonl"),
    stderr: join(directory, "codex-stderr.log"),
  } as const;
  const [runManifestRaw, prepareCommandRaw, providerPromptRaw, preflightRaw, stdout, stderr] =
    await Promise.all([
      readFile(paths.runManifest, "utf8"),
      readFile(paths.prepareCommand, "utf8"),
      readFile(paths.providerPrompt, "utf8"),
      readFile(paths.preflightReceipt, "utf8"),
      readFile(paths.stdout, "utf8"),
      readFile(paths.stderr, "utf8"),
    ]);
  assertFileSha256(
    paths.runManifest,
    runManifestRaw,
    receipt.artifactBindings.runManifestFileSha256,
  );
  assertFileSha256(
    paths.prepareCommand,
    prepareCommandRaw,
    receipt.artifactBindings.prepareCommandFileSha256,
  );
  assertFileSha256(
    paths.providerPrompt,
    providerPromptRaw,
    receipt.artifactBindings.providerPromptFileSha256,
  );
  assertFileSha256(
    paths.preflightReceipt,
    preflightRaw,
    receipt.artifactBindings.preflightReceiptFileSha256,
  );
  assertFileSha256(paths.stdout, stdout, receipt.process.stdoutSha256);
  assertFileSha256(paths.stderr, stderr, receipt.process.stderrSha256);

  const manifest = record(parseJson(runManifestRaw, paths.runManifest), paths.runManifest);
  const command = record(parseJson(prepareCommandRaw, paths.prepareCommand), paths.prepareCommand);
  const providerPrompt = record(parseJson(providerPromptRaw, paths.providerPrompt), paths.providerPrompt);
  const preflight = record(parseJson(preflightRaw, paths.preflightReceipt), paths.preflightReceipt);
  if (manifest.schemaVersion !== "task1.formal-prepare-run-manifest.v1") {
    throw new Error(`${paths.runManifest}: schemaVersion mismatch`);
  }
  if (manifest.prepareOnly !== true || manifest.formalMetricEligible !== false) {
    throw new Error(`${paths.runManifest}: preparation state mismatch`);
  }
  if (command.schemaVersion !== "task1.formal-prepare-command.v1") {
    throw new Error(`${paths.prepareCommand}: schemaVersion mismatch`);
  }
  if (command.autoExecute !== false) {
    throw new Error(`${paths.prepareCommand}: autoExecute must remain false`);
  }
  if (providerPrompt.schemaVersion !== "task1.formal-provider-prompt.v1") {
    throw new Error(`${paths.providerPrompt}: schemaVersion mismatch`);
  }
  if (preflight.schemaVersion !== "task1.formal-execution-preflight-receipt.v1") {
    throw new Error(`${paths.preflightReceipt}: schemaVersion mismatch`);
  }
  const relativeDirectory = relative(campaignRoot, directory);
  const directoryParts = relativeDirectory.split(/[\\/]/u);
  if (relativeDirectory.startsWith("..")
    || directoryParts.length !== 5
    || directoryParts[0] !== manifest.dataset_revision
    || directoryParts[1] !== expectedCampaignId
    || directoryParts[2] !== receipt.caseId
    || directoryParts[3] !== receipt.variantId
    || directoryParts[4] !== String(receipt.repeat)) {
    throw new Error(`${receiptPath}: execution receipt directory identity mismatch`);
  }
  assertEqual("run manifest canonical SHA-256", canonicalSha256(manifest),
    receipt.preparationBinding.runManifestCanonicalSha256);
  assertEqual("prepare command canonical SHA-256", canonicalSha256(command),
    receipt.preparationBinding.prepareCommandCanonicalSha256);
  assertEqual("preflight receipt canonical SHA-256", canonicalSha256(preflight),
    receipt.preflightReceiptSha256);
  const workspacePolicy = record(command.workspacePolicy, "prepare-command.workspacePolicy");
  assertEqual("workspace policy SHA-256", canonicalSha256(workspacePolicy),
    receipt.preparationBinding.workspacePolicySha256);

  assertManifestReceiptIdentity(manifest, receipt);
  const providerPromptText = extractProviderPromptText(providerPrompt);
  assertEqual("provider prompt SHA-256", utf8Sha256(providerPromptText), receipt.providerPromptSha256);
  assertEqual("provider prompt/run manifest SHA-256", receipt.providerPromptSha256,
    requireSha256Field(manifest, "provider_input_sha256", "run manifest"));

  const preparedRun = {
    directory,
    manifest,
    command,
  } as unknown as PreparedFormalRun;
  validatePreflightReceipt(
    preparedRun,
    preflight as unknown as Parameters<typeof validatePreflightReceipt>[1],
  );
  assertEqual(
    "effective invocation/preflight binding SHA-256",
    receipt.effectiveInvocation.canonicalSha256,
    buildEffectiveFormalInvocation(
      preparedRun,
      preflight as unknown as Parameters<typeof validatePreflightReceipt>[1],
    ).canonicalSha256,
  );
  if (canonicalSha256(receipt.snapshotBinding) !== canonicalSha256(preflight.provenance)) {
    throw new Error(`${receiptPath}: snapshot binding does not match preflight provenance`);
  }
  const isolation = buildFormalRunIsolationIdentity(preparedRun);
  if (receipt.preparationBinding.runNamespace !== isolation.runNamespace
    || receipt.preparationBinding.memoryProxyContextId !== isolation.memoryProxyContextId
    || receipt.preparationBinding.localStateId !== isolation.localStateId) {
    throw new Error(`${receiptPath}: execution isolation identity mismatch`);
  }
  return receipt;
}

function parseFormalExecutionReceipt(value: unknown, label: string): FormalExecutionReceipt {
  const root = record(value, label);
  if (root.schemaVersion !== "task1.formal-execution-receipt.v1") {
    throw new Error(`${label}: execution receipt schemaVersion mismatch`);
  }
  if (root.formalMetricEligible !== false) {
    throw new Error(`${label}: execution receipt must remain formalMetricEligible=false`);
  }
  for (const field of [
    "runId", "caseId", "variantId", "sessionId", "proxyInstanceId", "knowledgeInstanceId",
  ] as const) requireNonBlankField(root, field, "execution receipt");
  if (!Number.isSafeInteger(root.repeat) || (root.repeat as number) < 1) {
    throw new Error(`${label}: execution receipt repeat must be a positive integer`);
  }
  for (const field of ["providerPromptSha256", "visibleAssetSetSha256", "preflightReceiptSha256"] as const) {
    requireSha256Field(root, field, "execution receipt");
  }
  const artifacts = record(root.artifactBindings, "execution receipt artifactBindings");
  for (const field of [
    "runManifestFileSha256",
    "prepareCommandFileSha256",
    "providerPromptFileSha256",
    "preflightReceiptFileSha256",
  ] as const) requireSha256Field(artifacts, field, "execution receipt artifactBindings");
  const identity = record(root.executionIdentity, "execution receipt executionIdentity");
  for (const field of ["modelId", "reasoningEffort", "verbosity", "codexCliVersion"] as const) {
    requireNonBlankField(identity, field, "execution receipt executionIdentity");
  }
  const effectiveInvocation = record(
    root.effectiveInvocation,
    "execution receipt effectiveInvocation",
  );
  const effectiveInvocationCanonical = record(
    effectiveInvocation.canonical,
    "execution receipt effectiveInvocation.canonical",
  );
  requireNonBlankField(
    effectiveInvocationCanonical,
    "executable",
    "execution receipt effectiveInvocation.canonical",
  );
  requireNonBlankField(
    effectiveInvocationCanonical,
    "cwd",
    "execution receipt effectiveInvocation.canonical",
  );
  if (!Array.isArray(effectiveInvocationCanonical.args)
    || effectiveInvocationCanonical.args.some((argument) => typeof argument !== "string")) {
    throw new Error(`${label}: execution receipt effectiveInvocation.canonical args must be strings`);
  }
  const runtimeIdentity = record(
    effectiveInvocationCanonical.runtimeIdentity,
    "execution receipt effectiveInvocation.canonical.runtimeIdentity",
  );
  for (const field of ["resolvedAuthUserId", "spaceId", "teamId", "agentId", "taskId"] as const) {
    requireNonBlankField(
      runtimeIdentity,
      field,
      "execution receipt effectiveInvocation.canonical.runtimeIdentity",
    );
  }
  assertEqual(
    "execution receipt effective invocation canonical SHA-256",
    canonicalSha256(effectiveInvocationCanonical),
    requireSha256Field(
      effectiveInvocation,
      "canonicalSha256",
      "execution receipt effectiveInvocation",
    ),
  );
  const preparation = record(root.preparationBinding, "execution receipt preparationBinding");
  for (const field of [
    "runManifestCanonicalSha256", "prepareCommandCanonicalSha256", "workspacePolicySha256",
  ] as const) requireSha256Field(preparation, field, "execution receipt preparationBinding");
  for (const field of ["runNamespace", "memoryProxyContextId", "localStateId"] as const) {
    requireNonBlankField(preparation, field, "execution receipt preparationBinding");
  }
  if (preparation.freshLocalState !== true || preparation.inheritedHistory !== false) {
    throw new Error(`${label}: execution receipt local-state declaration is invalid`);
  }
  record(root.snapshotBinding, "execution receipt snapshotBinding");
  const codeFreeze = record(root.codeFreeze, "execution receipt codeFreeze");
  requireCommitField(codeFreeze, "executionCodeCommit", "execution receipt codeFreeze");
  if (requireCommitField(codeFreeze, "promptFreezeTagObject", "execution receipt codeFreeze")
      !== FORMAL_PROMPT_FREEZE_TAG_OBJECT
    || requireCommitField(codeFreeze, "promptFreezeCommit", "execution receipt codeFreeze")
      !== FORMAL_PROMPT_FREEZE_COMMIT) {
    throw new Error(`${label}: execution receipt Prompt freeze identity is invalid`);
  }
  if (codeFreeze.promptFreezeIsAncestor !== true || codeFreeze.workingTreeClean !== true) {
    throw new Error(`${label}: execution receipt code freeze is invalid`);
  }
  for (const field of ["startedAt", "finishedAt"] as const) {
    const value = requireNonBlankField(root, field, "execution receipt");
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${label}: ${field} must be ISO date-time`);
  }
  const startedMicros = requireMicrosField(root, "startedWallTimeUnixMicros", "execution receipt");
  const finishedMicros = requireMicrosField(root, "finishedWallTimeUnixMicros", "execution receipt");
  if (BigInt(finishedMicros) <= BigInt(startedMicros)) {
    throw new Error(`${label}: execution receipt wall-time window is invalid`);
  }
  const processReceipt = record(root.process, "execution receipt process");
  if (processReceipt.exitCode !== null && !Number.isSafeInteger(processReceipt.exitCode)) {
    throw new Error(`${label}: process exitCode is invalid`);
  }
  if (typeof processReceipt.timedOut !== "boolean"
    || (processReceipt.infrastructureError !== null
      && typeof processReceipt.infrastructureError !== "string")) {
    throw new Error(`${label}: process status is invalid`);
  }
  requireSha256Field(processReceipt, "stdoutSha256", "execution receipt process");
  requireSha256Field(processReceipt, "stderrSha256", "execution receipt process");
  if (root.clientUsage !== null && (!root.clientUsage || typeof root.clientUsage !== "object")) {
    throw new Error(`${label}: clientUsage must be an object or null`);
  }
  if (root.promptEvidenceState !== "captured-by-provider-observer-pending-seal"
    || root.providerUsageState !== "captured-by-provider-observer-pending-seal"
    || root.traceCollectionState !== "pending-campaign-seal") {
    throw new Error(`${label}: execution receipt evidence state is invalid`);
  }
  const episodePolicy = record(root.episodePolicy, "execution receipt episodePolicy");
  if (episodePolicy.additionalUserTurns !== FORMAL_EPISODE_POLICY.additionalUserTurns
    || episodePolicy.tdaiAttemptHorizon !== FORMAL_EPISODE_POLICY.tdaiAttemptHorizon
    || !Number.isSafeInteger(episodePolicy.wallTimeMs)
    || (episodePolicy.wallTimeMs as number) < 1) {
    throw new Error(`${label}: execution receipt episode policy is invalid`);
  }
  return root as unknown as FormalExecutionReceipt;
}

function assertManifestReceiptIdentity(
  manifest: Record<string, unknown>,
  receipt: FormalExecutionReceipt,
): void {
  const pairs: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["runId", receipt.runId, manifest.run_id],
    ["caseId", receipt.caseId, manifest.case_id],
    ["variantId", receipt.variantId, manifest.variant_id],
    ["repeat", receipt.repeat, manifest.repeat],
    ["sessionId", receipt.sessionId, manifest.session_id],
    ["proxyInstanceId", receipt.proxyInstanceId, manifest.proxy_instance_id],
    ["visibleAssetSetSha256", receipt.visibleAssetSetSha256, manifest.visible_asset_set_sha256],
    ["modelId", receipt.executionIdentity.modelId, manifest.model_id],
    ["reasoningEffort", receipt.executionIdentity.reasoningEffort, manifest.reasoning_effort],
    ["verbosity", receipt.executionIdentity.verbosity, manifest.verbosity],
    ["executionCodeCommit", receipt.codeFreeze.executionCodeCommit, manifest.code_commit],
    ["promptFreezeCommit", receipt.codeFreeze.promptFreezeCommit, manifest.prompt_freeze_commit],
    ["additionalUserTurns", receipt.episodePolicy.additionalUserTurns,
      record(manifest.episode_policy, "run manifest episode_policy").additionalUserTurns],
    ["tdaiAttemptHorizon", receipt.episodePolicy.tdaiAttemptHorizon,
      record(manifest.episode_policy, "run manifest episode_policy").tdaiAttemptHorizon],
  ];
  for (const [field, actual, expected] of pairs) assertEqual(`receipt/manifest ${field}`, actual, expected);
}

function extractProviderPromptText(root: Record<string, unknown>): string {
  const messages = root.messages;
  if (!Array.isArray(messages) || messages.length !== 1) {
    throw new Error("provider-prompt.json must contain exactly one message");
  }
  const message = record(messages[0], "provider-prompt messages[0]");
  const content = message.content;
  if (!Array.isArray(content) || content.length !== 1) {
    throw new Error("provider-prompt.json must contain exactly one content part");
  }
  return requireNonBlankField(record(content[0], "provider-prompt content[0]"), "text", "provider prompt");
}

function assertFileSha256(path: string, raw: string, expected: string): void {
  if (utf8Sha256(raw) !== expected) throw new Error(`${path}: file SHA-256 mismatch`);
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${label}: invalid JSON`, { cause: error });
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) throw new Error(`${label} mismatch`);
}

function requireNonBlankField(
  root: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = root[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} ${field} must be non-blank`);
  return value;
}

function requireSha256Field(root: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonBlankField(root, field, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} ${field} must be SHA-256`);
  return value;
}

function requireCommitField(root: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonBlankField(root, field, label).toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error(`${label} ${field} must be a Git commit`);
  return value;
}

function requireMicrosField(root: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonBlankField(root, field, label);
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${label} ${field} must be microseconds`);
  return value;
}

function utf8Sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function formalRuntimeCaseControlProjection(
  formalCase: FormalProviderRuntimeCase,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "task1.formal-case-input-control.v1",
    caseId: formalCase.provider.caseId,
    split: formalCase.binding.split,
    providerInput: formalCase.provider,
    runtimeIdentitySeed: formalCase.binding.identity,
    snapshotId: formalCase.binding.snapshotId,
    workspace: formalCase.binding.workspace,
    visibleAssetSetSha256: formalCase.binding.visibleAssetSetSha256,
  };
}

async function loadFrozenFormalWorld(
  freeze: FormalDataFreeze,
): Promise<FormalWorldContract> {
  const path = join(
    freeze.datasetRoot,
    "registry",
    "contracts",
    "formal-v1.json",
  );
  const text = await readFile(path, "utf8");
  const formalWorld = JSON.parse(text) as FormalWorldContract;
  assertFormalWorldContract(formalWorld);
  const metadata = loadFormalDatasetMetadata({ freeze });
  const fileSha256 = createHash("sha256")
    .update(text.replace(/\r\n/gu, "\n"), "utf8")
    .digest("hex");
  const canonical = canonicalSha256V1(formalWorld);
  if (fileSha256 !== metadata.contractHashes.fileSha256
    || canonical !== metadata.contractHashes.canonicalSha256) {
    throw new Error("formal World contract does not match the frozen public dataset status");
  }
  return formalWorld;
}

function uniqueStringMap<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value).trim();
    if (!id) throw new Error(`${label} id must be non-blank`);
    if (result.has(id)) throw new Error(`duplicate ${label} id: ${id}`);
    result.set(id, value);
  }
  return result;
}

function uniqueRunMap<T extends { readonly runId: string }>(
  runs: readonly T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const run of runs) {
    if (!run.runId.trim()) throw new Error(`${label} runId must be non-blank`);
    if (result.has(run.runId)) throw new Error(`duplicate ${label} runId: ${run.runId}`);
    result.set(run.runId, run);
  }
  return result;
}

function assertCollectedRunIdentity(
  execution: FormalExecutionReceipt,
  observed: Pick<CollectedObservedRun, "runId" | "caseId" | "variantId" | "sessionId">
    | Pick<CollectedProviderRun, "runId" | "caseId" | "variantId" | "sessionId">,
  label: string,
): void {
  if (observed.runId !== execution.runId
    || observed.caseId !== execution.caseId
    || observed.variantId !== execution.variantId
    || observed.sessionId !== execution.sessionId) {
    throw new Error(`${execution.runId}: ${label} identity does not match execution receipt`);
  }
}

function assertM2PreGoldIdentity(
  execution: FormalExecutionReceipt,
  evidence: FormalM2PreGoldEvidence,
): void {
  if (evidence.runId !== execution.runId
    || evidence.caseId !== execution.caseId
    || evidence.variantId !== execution.variantId
    || evidence.runIsolation.runId !== execution.runId
    || evidence.runIsolation.caseId !== execution.caseId
    || evidence.runIsolation.variantId !== execution.variantId
    || evidence.runIsolation.repeatIndex !== execution.repeat
    || evidence.runIsolation.localState.pathId
      !== execution.preparationBinding.localStateId) {
    throw new Error(`${execution.runId}: M2 pre-Gold identity does not match execution receipt`);
  }
  const { canonicalSha256: recorded, ...withoutSha } = evidence;
  if (canonicalSha256(withoutSha) !== recorded) {
    throw new Error(`${execution.runId}: M2 pre-Gold canonical hash does not match its contents`);
  }
}

function assertSelectionExecutionCohort(execution: FormalExecutionReceipt): void {
  const expected = selectionContract.executionCohort;
  if (execution.executionIdentity.modelId !== expected.model
    || execution.executionIdentity.reasoningEffort !== expected.reasoningEffort
    || execution.executionIdentity.verbosity !== expected.verbosity) {
    throw new Error(`${execution.runId}: execution identity does not match Selection Contract`);
  }
}

function assertProviderUsageContract(usage: ProviderUsageNormalizationResult): void {
  const expected = selectionContract.executionCohort;
  if (usage.provider !== expected.provider
    || usage.schema !== expected.usageSchema
    || usage.apiVersion !== expected.apiVersion
    || usage.adapterVersion !== expected.adapterVersion
    || usage.provider !== FORMAL_PROVIDER_USAGE_CONTRACT.provider
    || usage.schema !== FORMAL_PROVIDER_USAGE_CONTRACT.schema
    || usage.apiVersion !== FORMAL_PROVIDER_USAGE_CONTRACT.apiVersion
    || usage.adapterVersion !== FORMAL_PROVIDER_USAGE_CONTRACT.adapterVersion
    || !sameStringSet(usage.requiredFields, FORMAL_PROVIDER_USAGE_CONTRACT.requiredFields)
    || !sameStringSet(usage.unsupportedFields, FORMAL_PROVIDER_USAGE_CONTRACT.unsupportedFields)) {
    throw new Error("provider usage identity does not match the frozen formal contract");
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runFormalCollectScoreCli(parseFormalCollectScoreCliArguments(process.argv.slice(2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
