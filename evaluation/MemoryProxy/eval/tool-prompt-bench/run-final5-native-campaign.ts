import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { executeFinal5Campaign } from "./final5-formal-execution.js";
import { createHash } from "node:crypto";
import { executionHash } from "./execution-checkpoint.js";
import { evaluationStage } from "./evaluation-stage.js";
import { parseFinal5Client, type Final5Client } from "./final5-task-input.js";
import { loadFinal5Dataset, type Final5Dataset, type Final5Record } from "./final5-formal-datasource.js";
import {
  expectedCasesFromRecords,
  findWorkspaceBinding,
  loadSkillCatalogBindings as loadWorkspaceSkillCatalogBindings,
  loadSkillCatalogCoverage,
  readWorkspaceManifestFile,
  validateWorkspaceManifest,
  type Final5WorkspaceBinding,
  type SkillCatalogCoverage,
  type WorkspaceQaReport,
} from "./final5-workspace-manifest.js";
import type { FrozenSkillCatalogPayload } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";
import type { GitValidationCache } from "./workspace-git-validation.js";
import { loadFinal5RuntimeBindings } from "./final5-runtime-bindings.js";

const repositoryEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(repositoryEnv)) loadEnvFile(repositoryEnv);
// A restored formal dataset supplies identity per team. Never let a shared
// operator task override the first verified binding used by protocol preflight.
if (process.env.FINAL5_RUNTIME_BINDINGS) {
  const first = JSON.parse(readFileSync(process.env.FINAL5_RUNTIME_BINDINGS, "utf8")).teams?.[0];
  if (first?.taskId) process.env.TDAI_TASK_ID = first.taskId;
  else delete process.env.TDAI_TASK_ID;
}

export interface Final5WorkspacePreview {
  mode: "preview";
  campaignId: string;
  allCaseCount: number;
  selectedCaseCount: number;
  slotCount: number;
  workspaceManifest: string;
  missingWorkspaceCount: number;
  invalidWorkspaceCount: number;
  missingSkillCatalogCount: number;
  gitWorkspaceCount: number;
  plainSnapshotCount: number;
  blockedWorkspaceCount: number;
  workspaceReady: boolean;
  workspaceQaStatus: WorkspaceQaReport["status"];
  skillCatalogBindingsPath: string;
  skillCatalogCoverage: SkillCatalogCoverage;
  datasetDigest: string;
}

interface Final5PlanLike {
  campaignId: string;
  datasetDigest: string;
  allCaseCount: number;
  selectedCaseIds: string[];
  slots: Array<{ caseId: string; variant: "server_team" | "V4"; repeat: number }>;
}

function planFromFile(path: string): Final5PlanLike {
  return JSON.parse(readFileSync(path, "utf8")) as Final5PlanLike;
}

export function selectNativeStagePlan(parentPlan: Final5PlanLike, variant: "server_team" | "V4", client: Final5Client = "codex") {
  const slots = parentPlan.slots.filter((slot) => slot.variant === variant);
  if (!slots.length) throw new Error("No slots for selected stage");
  const keys = slots.map((slot) => JSON.stringify([slot.caseId, slot.repeat]));
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate stage slots");
  const stageBase = { ...parentPlan, campaignId: parentPlan.campaignId + "-" + client + "-" + variant, slots };
  return { ...stageBase, planSha256: createHash("sha256").update(JSON.stringify(stageBase)).digest("hex") };
}

export function buildFinal5WorkspacePreview(input: {
  plan: Final5PlanLike;
  dataset: Final5Dataset;
  workspaceManifest: string;
  workspaceRows: unknown;
  teamsRoot: string;
  skillCatalogBindingsPath: string;
  skillCatalogByCase: ReadonlyMap<string, FrozenSkillCatalogPayload>;
  skillCatalogCoverage: SkillCatalogCoverage;
  gitCache?: GitValidationCache;
}): Final5WorkspacePreview {
  const expectedCases = expectedCasesFromRecords(input.dataset.records);
  const validation = validateWorkspaceManifest(input.workspaceRows, expectedCases, {
    teamsRoot: resolve(input.teamsRoot),
    expectedTeamCount: input.dataset.teams.length,
    skillCatalog: input.skillCatalogCoverage,
    gitCache: input.gitCache,
  });
  const byCase = new Map(validation.bindings.map((binding) => [binding.caseId, binding]));
  const rows = Array.isArray(input.workspaceRows) ? input.workspaceRows : [];
  const selectedIds = input.plan.selectedCaseIds;
  const selectedBindings = selectedIds.map((caseId) => findWorkspaceBinding(validation.bindings, caseId));
  const rowIds = new Set(rows.flatMap((row) => row && typeof row === "object" && typeof (row as Record<string, unknown>).caseId === "string" ? [(row as Record<string, unknown>).caseId as string] : []));
  const missingWorkspaceCount = selectedBindings.filter((binding) => !binding?.workspaceReady).length;
  const invalidWorkspaceCount = selectedIds.filter((caseId) => rowIds.has(caseId) && !byCase.has(caseId)).length;
  return {
    mode: "preview",
    campaignId: input.plan.campaignId,
    allCaseCount: input.dataset.records.length,
    selectedCaseCount: selectedIds.length,
    slotCount: input.plan.slots.length,
    workspaceManifest: input.workspaceManifest,
    missingWorkspaceCount,
    invalidWorkspaceCount,
    missingSkillCatalogCount: selectedIds.filter((caseId) => !input.skillCatalogByCase.has(caseId)).length,
    gitWorkspaceCount: selectedBindings.filter((binding) => binding?.resolutionStatus === "resolved" && binding.isGitRepository).length,
    plainSnapshotCount: selectedBindings.filter((binding) => binding?.resolutionStatus === "resolved" && !binding.isGitRepository).length,
    blockedWorkspaceCount: selectedBindings.filter((binding) => binding?.resolutionStatus === "blocked").length,
    workspaceReady: validation.qa.workspaceReady,
    workspaceQaStatus: validation.qa.status,
    skillCatalogBindingsPath: input.skillCatalogBindingsPath,
    skillCatalogCoverage: input.skillCatalogCoverage,
    datasetDigest: input.dataset.sourceDigest,
  };
}

export function loadSkillCatalogBindings(path: string): Map<string, FrozenSkillCatalogPayload> {
  return loadWorkspaceSkillCatalogBindings(path);
}

function emptySkillCatalogCoverage(path: string, expectedCaseIds: readonly string[]): SkillCatalogCoverage {
  return {
    path: resolve(path),
    expectedCaseCount: expectedCaseIds.length,
    bindingCount: 0,
    missingCaseIds: [...expectedCaseIds],
    unknownCaseIds: [],
    duplicateCaseIds: [],
    valid: false,
  };
}

export async function runFinal5NativeCampaign(): Promise<Final5WorkspacePreview | Record<string, unknown>> {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const datasetRoot = resolve(sourceDirectory, "formal-dataset/final5");
  const teamsRoot = process.env.FINAL5_TEAMS_ROOT ?? resolve(datasetRoot, "teams");
  const base = process.env.FINAL5_RUN_ROOT ?? resolve(sourceDirectory, "../../../../runs/final5-native");
  const planPath = process.env.FINAL5_PLAN ?? resolve(datasetRoot, "manifests/final5-campaign-plan-small-compare-4.json");
  const parentPlan = planFromFile(planPath);
  const stage = evaluationStage(process.env.FINAL5_VARIANT ?? "", process.env.FINAL5_PROXY);
  const concurrency = Number(process.env.FINAL5_CONCURRENCY ?? 1);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error("FINAL5_CONCURRENCY must be 1..5");
  const client = parseFinal5Client(process.env.FINAL5_CLIENT);
  const plan = selectNativeStagePlan(parentPlan, stage.variant, client);
  const outputPath = process.env.FINAL5_RECEIPT ?? `${base}/${plan.campaignId}-execution.json`;
  const workspaceManifest = process.env.FINAL5_WORKSPACE_MANIFEST ?? resolve(datasetRoot, "manifests/workspace-resolution-final5-manifest-v2.json");
  const workspaceRows = readWorkspaceManifestFile(workspaceManifest);
  const dataset = loadFinal5Dataset(teamsRoot);
  const quick = process.env.FINAL5_QUICK === "1";
  if (quick) {
    // Quick runs describe the current inputs instead of requiring an older plan digest.
    plan.datasetDigest = dataset.sourceDigest;
    plan.allCaseCount = dataset.records.length;
    plan.planSha256 = executionHash(plan);
  }
  if (plan.datasetDigest !== dataset.sourceDigest) throw new Error("final5 dataset digest mismatch");
  if (!dataset.records.length || new Set(dataset.records.map(row => row.case_id)).size !== dataset.records.length) throw new Error("Empty dataset or duplicate Case IDs");
  if (new Set(plan.selectedCaseIds).size !== plan.selectedCaseIds.length || plan.selectedCaseIds.some(id => !dataset.records.some(row => row.case_id === id))) throw new Error("Invalid campaign selection");
  if (plan.allCaseCount !== dataset.records.length) throw new Error(`campaign plan allCaseCount mismatch: ${plan.allCaseCount}`);
  const skillCatalogBindingsPath = process.env.FINAL5_SKILL_CATALOG_BINDINGS
    ?? resolve(datasetRoot, "skill-catalog/case-skill-catalog.jsonl");
  const expectedCaseIds = dataset.records.map((record) => record.case_id);
  let skillCatalogByCase = new Map<string, FrozenSkillCatalogPayload>();
  let skillCatalogCoverage: SkillCatalogCoverage;
  try {
    skillCatalogCoverage = loadSkillCatalogCoverage(skillCatalogBindingsPath, expectedCaseIds);
    skillCatalogByCase = loadSkillCatalogBindings(skillCatalogBindingsPath);
  } catch {
    skillCatalogCoverage = emptySkillCatalogCoverage(skillCatalogBindingsPath, expectedCaseIds);
  }
  const gitCache = process.env.FINAL5_WORKSPACE_CACHE === "0" ? undefined : {
    directory: resolve(dirname(outputPath), ".cache", "workspace-validation"),
    inputFingerprint: executionHash({
      dataset: dataset.sourceDigest, workspaceRows, teamsRoot: resolve(teamsRoot),
      skillCatalog: existsSync(skillCatalogBindingsPath) ? readFileSync(skillCatalogBindingsPath, "utf8") : null,
      validator: ["workspace-git-validation.ts", "final5-workspace-manifest.ts", "run-final5-native-campaign.ts", "native-protocol-preflight.ts"].map((name) => readFileSync(resolve(sourceDirectory, name), "utf8")),
    }),
  };
  if (process.env.FINAL5_PREVIEW === "1") {
    const preview = buildFinal5WorkspacePreview({
    plan,
    dataset,
    workspaceManifest,
    workspaceRows,
    teamsRoot,
    skillCatalogBindingsPath,
    skillCatalogByCase,
    skillCatalogCoverage,
    gitCache,
  });
    console.log(JSON.stringify(preview));
    return preview;
  }
  if (!quick && !skillCatalogCoverage.valid) {
    throw new Error(`missing frozen Skill catalog binding for ${skillCatalogCoverage.missingCaseIds.length} Cases`);
  }
  const runtimeBindingsPath = process.env.FINAL5_RUNTIME_BINDINGS;
  if (resolve(teamsRoot).split(/[\\/]/u).includes("test100") && !runtimeBindingsPath) throw new Error("test100 requires FINAL5_RUNTIME_BINDINGS from verified asset restore; shared environment identity is not valid");
  const runtimeBindings = runtimeBindingsPath ? loadFinal5RuntimeBindings(runtimeBindingsPath, dataset.sourceDigest, dataset.teams, !quick) : undefined;
  const { runFinal5Slot } = await import("./final5-real-executor.js");
  const { probeFinal5NativeReady, resolveFinal5Cli, readFinal5CliVersion } = await import("./native-protocol-preflight.js");
  const model = process.env.FINAL5_MODEL ?? (client === "codex" ? process.env.TDAI_CODEX_MODEL : process.env.TDAI_CLAUDE_MODEL) ?? process.env.DS_MODEL;
  if (!model) throw new Error("An explicit model is required for reproducible evaluation");
  const timeoutMs = Number(process.env.FINAL5_SLOT_TIMEOUT_MS ?? 180000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Invalid slot timeout");
  if (existsSync(outputPath)) throw new Error("Receipt already exists: " + outputPath);
  const proxyHealth = await requireProxyProfile(stage.proxyBaseUrl, stage.profile, stage.variant, client);
  const { cli, cliVersion } = quick ? (() => {
    const cli = resolveFinal5Cli(client);
    return { cli, cliVersion: readFinal5CliVersion(cli) };
  })() : await probeFinal5NativeReady({
    client,
    proxyBaseUrl: stage.proxyBaseUrl,
    model,
    frozenSkillCatalog: skillCatalogByCase.get(plan.selectedCaseIds[0] ?? ""),
  });
  const expectedCases = expectedCasesFromRecords(dataset.records);
  const workspaceValidation = quick ? {
    bindings: workspaceRows as Final5WorkspaceBinding[],
    qa: { valid: true, errors: [] },
  } : validateWorkspaceManifest(workspaceRows, expectedCases, {
    teamsRoot: resolve(teamsRoot),
    expectedTeamCount: dataset.teams.length,
    skillCatalog: skillCatalogCoverage,
    gitCache,
  });
  if (!workspaceValidation.qa.valid) {
    throw new Error(`workspace manifest QA failed: ${workspaceValidation.qa.errors.map((item) => item.message).slice(0, 5).join("; ")}`);
  }
  const bindingsByCase = new Map(workspaceValidation.bindings.map((binding) => [binding.caseId, binding]));
  const selectedIds = new Set(plan.selectedCaseIds);
  const selectedRows = dataset.records.filter((record) => selectedIds.has(record.case_id));
  if (selectedRows.length !== selectedIds.size) throw new Error("selection contains unknown final5 Case");
  for (const row of selectedRows) {
    const binding = bindingsByCase.get(row.case_id);
    if (!binding || !binding.workspaceReady || binding.resolutionStatus !== "resolved" || !binding.repositoryPath) {
      throw new Error(`workspace is not ready for ${row.case_id}; blocked=${binding?.resolutionStatus === "blocked"}`);
    }
    if (!quick && binding.baseSha !== String(row.case.base_sha ?? "")) throw new Error(`manifest baseSha mismatch for ${row.case_id}`);
  }
  const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const comparison = {
    quick,
    cliVersion,
    client, model, timeoutMs, concurrency, policy: "natural-completion",
    reasoningEffort: client === "codex" ? "high" : "client-default", verbosity: client === "codex" ? "medium" : "client-default",
    historyTransport: client === "codex" ? "user-plane-envelope-v1" : "user-plane-transcript-v1",
    datasetDigest: dataset.sourceDigest, slots: parentPlan.slots.map(({ caseId, repeat }) => ({ caseId, repeat })),
    workspaceManifestSha256: hashFile(workspaceManifest), skillCatalogSha256: hashFile(skillCatalogBindingsPath),
    runnerSha256: executionHash(["final5-http-capture.ts", "final5-evidence.ts", "final5-gold-compiler.ts", "final5-provider-usage.ts", "collect-final5-evidence.ts", "final5-metrics-report.ts", "measurement-v2/scorer.ts", "measurement-v2/types.ts", "measurement-v2/json-path.ts", "client-home.mjs", "client-runtime-env.ts", "final5-real-executor.ts", "codex-runner.ts", "claude-code-runner.ts", "final5-task-input.ts", "evaluation-stage.ts", "execution-checkpoint.ts", "final5-formal-execution.ts", "run-final5-native-campaign.ts", "final5-workspace-manifest.ts", "workspace-git-validation.ts", "native-protocol-preflight.ts"].map((name) => hashFile(resolve(dirname(fileURLToPath(import.meta.url)), name)))),
    provider: client === "codex" ? proxyHealth.codexUpstream : proxyHealth.claudeUpstream, executable: cli.executable,
    identity: runtimeBindings ? Object.fromEntries(runtimeBindings) : { space: process.env.TDAI_SPACE_ID, team: process.env.TDAI_TEAM_ID, agent: process.env.TDAI_AGENT_ID, task: process.env.TDAI_TASK_ID },
  };
  const sourceFingerprint = process.env.FINAL5_PROXY_SOURCE_SHA256;
  if (sourceFingerprint && !/^[0-9a-f]{64}$/.test(sourceFingerprint)) throw new Error("Invalid managed source fingerprint");
  const executionContext = { comparison, stage: { ...stage, sourceFingerprint, proxyInstanceId: proxyHealth.serverInstanceId, proxyConfigFingerprint: proxyHealth.experimentConfigFingerprint } };
  // Managed restarts may recover only identical source/config under the read-only asset contract.
  const resumeContext = sourceFingerprint ? { ...executionContext, stage: { ...executionContext.stage, proxyInstanceId: undefined } } : executionContext;
  const executionWorkspaceRoot = process.env.FINAL5_EXECUTION_WORKSPACE_ROOT ?? resolve(dirname(outputPath), "workspaces");
  const evidenceRoot = outputPath + ".evidence";
  mkdirSync(executionWorkspaceRoot, { recursive: true });
  mkdirSync(evidenceRoot, { recursive: true });
  const receipt = await executeFinal5Campaign({
    teamsRoot,
    plan: plan as Parameters<typeof executeFinal5Campaign>[0]["plan"],
    concurrency,
    dataset,
    executionContext,
    checkpoint: { directory: outputPath + ".checkpoint", config: { plan, executionContext: resumeContext }, resume: process.env.FINAL5_RESUME === "1", maxRetries: Number(process.env.FINAL5_MAX_RETRIES ?? 0) },
    executor: async (slot, row) => {
      const binding = bindingsByCase.get(row.case_id);
      if (!binding) throw new Error(`workspace is not ready for ${row.case_id} in ${workspaceManifest}`);
      return runFinal5Slot(client, slot, row, {
        workspace: binding,
        runtimeIdentity: runtimeBindings?.get(row.team_id),
        workspaceRoot: executionWorkspaceRoot,
        proxyBaseUrl: stage.proxyBaseUrl,
        model,
        timeoutMs,
        evidenceRoot,
        frozenSkillCatalog: skillCatalogByCase.get(row.case_id),
        teamsRoot,
      });
    },
  });
  if (receipt.datasetDigest !== dataset.sourceDigest) throw new Error("receipt dataset digest mismatch");
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  const summary = { campaignId: receipt.campaignId, slotCount: receipt.slotCount, completed: receipt.completed, failed: receipt.failed, outputPath };
  console.log(JSON.stringify(summary));
  return summary;
}

export async function requireProxyProfile(baseUrl: string, expected: string, label: string, client: Final5Client = "codex") {
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${label} health failed: HTTP ${response.status}`);
  const health = await response.json() as { toolPromptProfile?: unknown; codexUpstream?: string; claudeUpstream?: string; serverInstanceId?: string; experimentConfigFingerprint?: string; experimentReadOnly?: { ready?: boolean }; evaluationCapabilities?: { codexHistory?: boolean; codexFrozenSkills?: boolean; claudeFrozenSkills?: boolean } };
  if (!health.serverInstanceId || !health.experimentConfigFingerprint) throw new Error("Proxy must expose instance and configuration fingerprints for checkpointing");
  if (health.experimentReadOnly?.ready !== true) throw new Error("Checkpointed evaluation requires a read-only experiment Proxy");
  if (health.toolPromptProfile !== expected) throw new Error(`${label} profile mismatch: expected ${expected}, got ${String(health.toolPromptProfile)}`);
  const supported = client === "codex" ? health.evaluationCapabilities?.codexHistory && health.evaluationCapabilities?.codexFrozenSkills : health.evaluationCapabilities?.claudeFrozenSkills;
  if (!supported) throw new Error(client + " proxy lacks required evaluation capabilities");
  const upstream = client === "codex" ? health.codexUpstream : health.claudeUpstream;
  if (process.env.FINAL5_UPSTREAM_URL && upstream !== process.env.FINAL5_UPSTREAM_URL) throw new Error("Proxy upstream mismatch");
  return health;
}

if (process.argv[1]?.endsWith("run-final5-native-campaign.ts")) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: FINAL5_PREVIEW=1 pnpm exec tsx eval/tool-prompt-bench/run-final5-native-campaign.ts\nReads FINAL5_PLAN, FINAL5_WORKSPACE_MANIFEST, FINAL5_TEAMS_ROOT and FINAL5_SKILL_CATALOG_BINDINGS.");
  } else {
    try {
      await runFinal5NativeCampaign();
    } catch (error) {
      console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    }
  }
}

export type { Final5Record };
