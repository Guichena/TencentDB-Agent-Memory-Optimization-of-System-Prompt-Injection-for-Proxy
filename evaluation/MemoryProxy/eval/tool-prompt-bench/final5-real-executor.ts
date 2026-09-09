import { isolatedClientEnvironment, limitGitDiscoveryToWorkspace, prepareClientHome } from "./client-home.mjs";
import { executeCodexProcess, buildCodexConfigArgs, buildCodexInvocation, resolveCodexInvocation } from "./codex-runner.js";
import { spawn, execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { rm as rmAsync } from "node:fs/promises";
import { join, relative as relativePath, resolve } from "node:path";
import type { Final5CampaignPlan } from "./final5-campaign-builder.js";
import type { Final5Record } from "./final5-formal-datasource.js";
import type { Final5WorkspaceBinding } from "./final5-workspace-manifest.js";
import { buildMemoryProxyCodexBaseUrl, buildRealChainIdentityHeaders } from "./real-chain-adapter.js";
import { encodeFrozenSkillCatalog, FROZEN_SKILL_CATALOG_HEADER, type FrozenSkillCatalogPayload } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";
import { inspectCodexLifecycle, executeWithRawCapture } from "./codex-output-capture.js";
import { EvaluationExecutionError, RetryableEvaluationError } from "./execution-checkpoint.js";
import { extractCodexUsage } from "./codex-runner.js";
import { FINAL5_TASK_INSTRUCTIONS, final5TaskInput, type Final5Client } from "./final5-task-input.js";
import { runClaudeCodeCase } from "./claude-code-runner.js";
import { extractClaudeCommandObservations } from "./claude-code-event-parser.js";
import type { Final5RuntimeIdentity } from "./final5-runtime-bindings.js";
import { sealAttemptCapture } from "./final5-evidence.js";

// Formal worktrees must not run repository-local hooks. In particular, an LFS
// post-checkout hook can block a slot before the client process is started.
const DISABLE_GIT_HOOKS_CONFIG = "core.hooksPath=NUL";

export function executeFinal5CodexSlot(slot: Final5CampaignPlan["slots"][number], row: Final5Record, options: { repoRoot: string; outputRoot: string; timeoutMs?: number; maxInfrastructureRetries?: number }): Promise<unknown> {
  const messages = Array.isArray(row.case.messages) ? row.case.messages as Array<{role:string;content:string}> : [];
  const prompt = messages.filter((m) => m.role === "user").at(-1)?.content ?? "Inspect the repository and complete the requested task.";
  const workspace = typeof row.case.workspace_path === "string" ? row.case.workspace_path : undefined;
  const script = resolve(options.repoRoot, "scripts/run-codex-eval.ps1");
  const attempts = Math.max(0, options.maxInfrastructureRetries ?? 0);
  const run = (attempt: number): Promise<unknown> => new Promise((resolvePromise, reject) => {
    const sessionId = `final5-${slot.caseId}-${slot.variant}-${slot.repeat}-a${attempt}`;
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Prompt", prompt, "-SessionId", sessionId, ...(workspace ? ["-WorkspacePath", workspace] : [])], { cwd: options.repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false; child.stdout.on("data", (b) => { stdout += String(b); }); child.stderr.on("data", (b) => { stderr += String(b); }); const timer = setTimeout(() => { if (settled) return; settled = true; execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined); reject(new Error(`Codex slot timed out after ${options.timeoutMs ?? 180000}ms`)); }, options.timeoutMs ?? 180000); child.on("error", (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); }); child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); if (code !== 0) reject(new Error(`Codex slot failed (${code}): ${stderr.slice(-2000)}`)); else resolvePromise({ stdout, stderr, exitCode: code, attempt, sessionId, caseId: row.case_id, variant: slot.variant }); });
  });
  return run(0).catch((error) => attempts > 0 ? run(1) : Promise.reject(error));
}

export function buildFinal5ProviderHeaders(input: {
  spaceId: string;
  sessionId: string;
  teamId: string;
  agentId: string;
  taskId?: string;
  apiKey: string;
  frozenSkillCatalog?: FrozenSkillCatalogPayload;
}): Record<string, string> {
  const identity = {
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    teamId: input.teamId,
    agentId: input.agentId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
  };
  return {
    Authorization: `Bearer ${input.apiKey}`,
    ...buildRealChainIdentityHeaders(identity),
    "x-conversation-id": input.sessionId,
    "x-tdai-team-id": input.teamId,
    "x-tdai-agent-id": input.agentId,
    ...(input.taskId ? { "x-tdai-task-id": input.taskId } : {}),
    ...(input.frozenSkillCatalog ? {
      [FROZEN_SKILL_CATALOG_HEADER]: encodeFrozenSkillCatalog(input.frozenSkillCatalog),
    } : {}),
  };
}

export function prepareFinal5IsolatedWorkspace(input: {
  slot: Final5CampaignPlan["slots"][number];
  binding: Final5WorkspaceBinding;
  baseSha: string;
  workspaceRoot: string;
}): { path: string; cleanup: () => void } {
  if (!input.binding.workspaceReady || input.binding.resolutionStatus !== "resolved" || !input.binding.repositoryPath) {
    throw new Error(`workspace binding is not ready for ${input.binding.caseId}`);
  }
  const baseSha = input.baseSha.trim();
  if (!/^[0-9a-f]{40}$/i.test(baseSha)) throw new Error(`invalid base_sha for ${input.binding.caseId}`);
  const safeSlot = createHash("sha256")
    .update(`${input.slot.caseId}:${input.slot.variant}:${input.slot.repeat}`)
    .digest("hex")
    .slice(0, 16);
  mkdirSync(input.workspaceRoot, { recursive: true });
  const isolatedWorkspace = mkdtempSync(join(input.workspaceRoot, `${safeSlot}-`));
  if (input.binding.isGitRepository) {
    execFileSync("git", ["-c", "core.longpaths=true", "-c", DISABLE_GIT_HOOKS_CONFIG, "-C", input.binding.repositoryPath, "worktree", "add", "--detach", isolatedWorkspace, baseSha], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    });
  } else {
    copyPlainSnapshot(input.binding.repositoryPath, isolatedWorkspace);
  }
  let cleaned = false;
  return {
    path: isolatedWorkspace,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      removeIsolatedWorkspace(input.binding!.repositoryPath!, input.workspaceRoot, isolatedWorkspace, input.binding.isGitRepository);
    },
  };
}

export interface Final5SlotOptions {
  runtimeIdentity?: Final5RuntimeIdentity;
  workspace: Final5WorkspaceBinding; workspaceRoot: string; teamsRoot?: string; proxyBaseUrl?: string;
  model?: string; timeoutMs?: number; frozenSkillCatalog?: FrozenSkillCatalogPayload; evidenceRoot?: string;
  executeProcess?: (input: import("./codex-runner.js").CodexProcessExecutionInput) => Promise<import("./codex-runner.js").CodexProcessExecutionResult>;
}

export function isRetryableProviderRejection(rawOutput: string, completedTurns: number): boolean {
  if (completedTurns !== 0) return false;
  return /model_not_found[\s\S]{0,300}not available for this group/i.test(rawOutput)
    || /(?:\b429\b[\s\S]{0,120}too many requests|too many requests[\s\S]{0,120}\b429\b)/i.test(rawOutput);
}


export async function executeFinal5NativeSlot(slot: Final5CampaignPlan["slots"][number], row: Final5Record, options: Final5SlotOptions): Promise<unknown> {
  const totalStart = performance.now();
  const timings = { prepareMs: 0, clientMs: 0, firstOutputMs: null as number | null, cleanupMs: 0, totalMs: 0 };
  const historyEnvelope = final5TaskInput(row.case.messages).envelope;
  const model = options.model ?? process.env.DS_MODEL ?? "grok-4.6";
  const spaceId = options.runtimeIdentity?.spaceId ?? process.env.TDAI_SPACE_ID ?? "default";
  const proxyBaseUrl = options.proxyBaseUrl ?? process.env.TDAI_PROXY_BASE_URL ?? "http://127.0.0.1:8096";
  const sessionId = `final5-${slot.caseId}-${slot.variant}-${slot.repeat}-${randomUUID()}`;
  const baseSha = String(row.case.base_sha ?? "").trim();
  if (!/^[0-9a-f]{40}$/i.test(baseSha)) throw new Error(`invalid base_sha for ${row.case_id}`);
  if (options.workspace.caseId !== row.case_id) throw new Error(`workspace binding Case mismatch: ${options.workspace.caseId} vs ${row.case_id}`);
  if (options.workspace.baseSha !== baseSha) throw new Error(`workspace binding baseSha mismatch for ${row.case_id}`);
  if (!options.workspace.workspaceReady || options.workspace.resolutionStatus !== "resolved" || !options.workspace.repositoryPath) {
    throw new Error(`workspace binding is not ready for ${row.case_id}`);
  }
  const evidenceRoot = options.evidenceRoot ?? join(options.workspaceRoot, "evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  const evidenceDirectory = mkdtempSync(join(evidenceRoot, "attempt-"));
  const isolatedCodexHome = join(evidenceDirectory, "runtime", "home");
  const prepared = prepareFinal5IsolatedWorkspace({ slot, binding: options.workspace, baseSha, workspaceRoot: options.workspaceRoot });
  const isolatedWorkspace = prepared.path;
  let lifecycleComplete = false;
  try {
    const configArgs = buildCodexConfigArgs({
      providerBaseUrl: buildMemoryProxyCodexBaseUrl(proxyBaseUrl, spaceId),
      providerHeaders: buildFinal5ProviderHeaders({
        apiKey: process.env.FINAL5_PROVIDER_API_KEY ?? process.env.DS_API_KEY ?? "",
        spaceId,
        sessionId,
        teamId: options.runtimeIdentity?.teamId ?? process.env.TDAI_TEAM_ID ?? "",
        agentId: options.runtimeIdentity?.agentId ?? process.env.TDAI_AGENT_ID ?? "",
        taskId: options.runtimeIdentity ? options.runtimeIdentity.taskId : process.env.TDAI_TASK_ID,
        frozenSkillCatalog: options.frozenSkillCatalog,
      }),
      providerEnvHeaders: { "x-tdai-user-key": "TDAI_MEMORY_USER_KEY" },
      reasoningEffort: "high",
      verbosity: "medium",
      developerInstructions: FINAL5_TASK_INSTRUCTIONS,
    });
    // Formal evaluation needs the Codex local workspace tools to run normally
    // (read, test and edit). The command is still isolated to the case
    // repository and uses the benchmark's disabled plugin configuration.
    const invocation = resolveCodexInvocation(buildCodexInvocation({
      workspaceDir: isolatedWorkspace,
      model,
      configArgs,
      executionPolicy: "unrestricted",
    }), { explicitExecutable: process.env.CODEX_EXECUTABLE });
    // Every formal slot gets a clean local Codex home. This prevents the CLI's
    // system-skills/config initialization from racing with another slot or
    // inheriting the operator's personal skills. Cloud runtime Skills remain
    // served by MemoryProxy and are not re-imported here.
    const environment = {
      ...isolatedClientEnvironment(process.env, isolatedCodexHome, "codex"),
      OPENAI_API_KEY: process.env.FINAL5_PROVIDER_API_KEY ?? process.env.DS_API_KEY ?? "",
      TDAI_CODEX_PROVIDER_API_KEY: process.env.FINAL5_PROVIDER_API_KEY ?? process.env.DS_API_KEY ?? "",
      TDAI_MEMORY_USER_KEY: process.env.TDAI_MEMORY_USER_KEY ?? "",
    };
    limitGitDiscoveryToWorkspace(environment, isolatedWorkspace);
    prepareClientHome(environment);
    timings.prepareMs = performance.now() - totalStart;
    const clientStart = performance.now();
    const processInput = { executable: invocation.executable, args: invocation.args, cwd: isolatedWorkspace, environment, stdin: historyEnvelope, timeoutMs: options.timeoutMs ?? 180000,
      onOutput: (stream: "stdout" | "stderr", _chunk: string) => { if (stream === "stdout" && timings.firstOutputMs === null) timings.firstOutputMs = performance.now() - clientStart; } };
    const execute = options.executeProcess ?? executeCodexProcess;
    const result = await executeWithRawCapture(processInput, evidenceDirectory, execute);
    timings.clientMs = performance.now() - clientStart;
    const lifecycle = inspectCodexLifecycle(result.stdout);
    const hasCompleteUsage = extractCodexUsage(result.stdout) !== null;
    const recoverableCompletedTurn = !result.timedOut && !result.infrastructureStopReason && lifecycle.completed && hasCompleteUsage;
    if (result.timedOut || result.infrastructureStopReason || !lifecycle.completed || (result.exitCode !== 0 && !recoverableCompletedTurn)) {
      const observedCommands = result.stdout.includes('"type":"command_execution"') ? 1 : 0;
      const retryable = (result.infrastructureStopReason === "Codex provider request timed out after reconnect retries"
        && observedCommands === 0 && lifecycle.completedTurns === 0)
        || isRetryableProviderRejection(result.stdout, lifecycle.completedTurns);
      const Failure = retryable ? RetryableEvaluationError : EvaluationExecutionError;
      throw new Failure("Native Codex slot failed", { ...result, timings, evidenceDirectory });
    }
    if (accessedPrivateEvaluationData(result.stdout)) {
      throw new Error(`Native Codex slot contaminated by private evaluation-data access: ${row.case_id}/${slot.variant}`);
    }
    lifecycleComplete = true;
    return { ...result, sessionId, timings, evidenceDirectory, caseId: row.case_id, variant: slot.variant, isolatedWorkspace: true, baseSha, lifecycle, recoveredNonZeroExit: recoverableCompletedTurn && result.exitCode !== 0 };
  } finally {
    try { sealAttemptCapture(evidenceDirectory, { client: "codex", caseId: row.case_id, variant: slot.variant, repeat: slot.repeat, sessionId, lifecycleComplete }); }
    finally {
      const cleanupStart = performance.now();
      try { prepared.cleanup(); }
      catch (error) { console.warn(`FINAL5_WORKSPACE_CLEANUP_FAILED codex ${row.case_id}: ${String(error)}`); }
      finally {
        void removeIsolatedClientHome(evidenceDirectory, join(evidenceDirectory, "runtime")).catch(() => undefined);
        timings.cleanupMs = performance.now() - cleanupStart;
        timings.totalMs = performance.now() - totalStart;
      }
    }
  }
}

export async function executeFinal5ClaudeSlot(slot: Final5CampaignPlan["slots"][number], row: Final5Record, options: Final5SlotOptions): Promise<unknown> {
  const start = performance.now();
  const input = final5TaskInput(row.case.messages);
  const baseSha = String(row.case.base_sha ?? "").trim();
  if (slot.caseId !== row.case_id || options.workspace.caseId !== row.case_id || options.workspace.baseSha !== baseSha) throw new Error("Claude workspace/case binding mismatch");
  if (!options.model || !options.evidenceRoot) throw new Error("Claude model and evidenceRoot are required");
  mkdirSync(options.evidenceRoot, { recursive: true });
  const outputDir = mkdtempSync(join(options.evidenceRoot, "attempt-"));
  const prepared = prepareFinal5IsolatedWorkspace({ slot, binding: options.workspace, baseSha, workspaceRoot: options.workspaceRoot });
  const timings = { workspaceMs: performance.now() - start, cleanupMs: 0, totalMs: 0 };
  const sessionId = "final5-claude-" + randomUUID();
  let lifecycleComplete = false;
  try {
    const result = await runClaudeCodeCase({
      caseId: row.case_id, prompt: input.claudePrompt, model: options.model, workspaceDir: prepared.path,
      outputDir, proxyBaseUrl: options.proxyBaseUrl ?? "http://127.0.0.1:8097",
      isolatedHome: join(outputDir, "runtime", "home"),
      identity: { ...(options.runtimeIdentity ?? { spaceId: process.env.TDAI_SPACE_ID ?? "default",
        teamId: process.env.TDAI_TEAM_ID ?? "", agentId: process.env.TDAI_AGENT_ID ?? "", taskId: process.env.TDAI_TASK_ID }), sessionId },
      systemInstructions: FINAL5_TASK_INSTRUCTIONS, frozenSkillCatalog: options.frozenSkillCatalog,
      enableTdaiHorizonStop: false, timeoutMs: options.timeoutMs ?? 180000,
      anthropicApiKeyEnv: "FINAL5_PROVIDER_API_KEY", tdaiUserKeyEnv: "TDAI_MEMORY_USER_KEY",
      claudeExecutable: process.env.CLAUDE_EXECUTABLE, executeProcess: options.executeProcess,
    });
    const evidence = { ...result, client: "claude-code", variant: slot.variant, baseSha, isolatedWorkspace: true, slotTimings: timings };
    const stdout = readFileSync(join(outputDir, "claude-code-events.jsonl"), "utf8");
    const commandObservations = extractClaudeCommandObservations(stdout);
    if (result.infrastructureError) {
      const Failure = isRetryableProviderRejection(stdout, result.lifecycle?.completed ? 1 : 0)
        ? RetryableEvaluationError
        : EvaluationExecutionError;
      throw new Failure("Claude slot failed", evidence);
    }
    const commandEvents = commandObservations.map((item) => JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: item.command } })).join("\n");
    if (accessedPrivateEvaluationData(commandEvents)) throw new EvaluationExecutionError("Claude accessed private evaluation data", evidence);
    lifecycleComplete = true;
    return { ...evidence, sessionId };
  } finally {
    try { sealAttemptCapture(outputDir, { client: "claude-code", caseId: row.case_id, variant: slot.variant, repeat: slot.repeat, sessionId, lifecycleComplete }); }
    finally {
      const cleanupStart = performance.now();
      try { prepared.cleanup(); }
      catch (error) { console.warn(`FINAL5_WORKSPACE_CLEANUP_FAILED claude-code ${row.case_id}: ${String(error)}`); }
      finally {
        void removeIsolatedClientHome(outputDir, join(outputDir, "runtime")).catch(() => undefined);
        timings.cleanupMs = performance.now() - cleanupStart; timings.totalMs = performance.now() - start;
      }
    }
  }
}

export function runFinal5Slot(client: Final5Client, slot: Final5CampaignPlan["slots"][number], row: Final5Record, options: Final5SlotOptions) {
  return client === "codex" ? executeFinal5NativeSlot(slot, row, options) : executeFinal5ClaudeSlot(slot, row, options);
}

async function removeIsolatedClientHome(workspaceRoot: string, isolatedCodexHome: string): Promise<void> {
  const root = resolve(workspaceRoot);
  const target = resolve(isolatedCodexHome);
  if (target === root || (!target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`))) {
    throw new Error(`refusing to remove CLI runtime outside attempt root: ${target}`);
  }
  if (existsSync(target)) await rmAsync(target, { recursive: true, force: true });
}

function removeIsolatedWorkspace(repositoryPath: string, workspaceRoot: string, isolatedWorkspace: string, isGitWorkspace: boolean): void {
  const root = resolve(workspaceRoot);
  const target = resolve(isolatedWorkspace);
  if (target === root || !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
    throw new Error(`refusing to remove workspace outside the configured root: ${target}`);
  }
  if (!existsSync(target)) return;
  if (!isGitWorkspace) {
    rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    return;
  }
  try {
    execFileSync("git", ["-c", DISABLE_GIT_HOOKS_CONFIG, "-C", repositoryPath, "worktree", "remove", "--force", target], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    });
  } catch {
    rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    try {
      execFileSync("git", ["-c", DISABLE_GIT_HOOKS_CONFIG, "-C", repositoryPath, "worktree", "prune"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch { /* stale registration is harmless after the directory is gone */ }
  }
}

function copyPlainSnapshot(sourcePath: string, destinationPath: string): void {
  const sourceRoot = resolve(sourcePath);
  cpSync(sourceRoot, destinationPath, {
    recursive: true,
    filter: (candidate) => {
      const rel = relativePath(sourceRoot, resolve(candidate));
      if (!rel) return true;
      const segments = rel.split(/[\\/]+/u);
      return !segments.some((segment, index) => {
        const normalized = segment.toLowerCase();
        return normalized === ".git" || normalized === "benchmark-runs" || normalized === "gold" || normalized === "evidence"
          || normalized === "answer" || normalized === "answers" || normalized === "private"
          || (normalized === "team" && segments[index + 1]?.toLowerCase() === "data");
      });
    },
  });
}

function accessedPrivateEvaluationData(stdout: string): boolean {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('"type":"item.')) continue;
    if (!line.includes('"type":"command_execution"')) continue;
    const normalized = line.replace(/\\\\/g, "/").toLowerCase();
    if (/\/data\/(gold\.jsonl|cases\.jsonl|evidence\.jsonl)/.test(normalized)) return true;
    if (/team-migration\/teams\/.+\/data\//.test(normalized)) return true;
  }
  return false;
}
