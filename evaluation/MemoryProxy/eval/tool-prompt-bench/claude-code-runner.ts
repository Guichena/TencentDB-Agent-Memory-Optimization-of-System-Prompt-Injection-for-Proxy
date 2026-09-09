import { isolatedClientEnvironment, prepareClientHome } from "./client-home.mjs";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicTdaiHorizonStopWhen,
  executeCodexProcess,
  type CodexInvocation,
  type CodexProcessExecutionInput,
  type CodexProcessExecutionResult,
  type ResolveCodexInvocationOptions,
} from "./codex-runner.js";
import { executeClaudeWithRawCapture } from "./claude-code-output-capture.js";
import { extractClaudeCliUsage, inspectClaudeLifecycle } from "./claude-code-event-parser.js";
import { normalizeClaudeToolEvents } from "./claude-curl-normalizer.js";
import { FORMAL_EPISODE_POLICY } from "./formal-episode-policy.js";
import { encodeFrozenSkillCatalog, FROZEN_SKILL_CATALOG_HEADER } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";
import { evaluationStage, verifyEvaluationStage, WINDOWS_HTTP_INSTRUCTIONS, type EvaluationVariant } from "./evaluation-stage.js";
import {
  buildClaudeCodeReceipt,
  mergeClaudeUsageSources,
  writeClaudeCodeReceipt,
} from "./claude-code-receipt.js";

export const CLAUDE_CODE_RUNNER = "claude-code" as const;
export const TDAI_EVAL_USER_KEY_ENV = "TDAI_EVAL_USER_KEY" as const;

export interface ClaudeCodeIdentity {
  spaceId: string;
  sessionId: string;
  teamId: string;
  agentId: string;
  taskId?: string;
}

export interface ClaudeCodeInvocationInput {
  workspaceDir: string;
  model: string;
  prompt: string;
  systemInstructions?: string;
}

export interface ClaudeCodeRunOptions {
  variant?: EvaluationVariant;
  systemInstructions?: string;
  frozenSkillCatalog?: import("../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js").FrozenSkillCatalogPayload;
  caseId: string;
  prompt: string;
  model: string;
  workspaceDir: string;
  outputDir: string;
  proxyBaseUrl: string;
  identity: ClaudeCodeIdentity;
  timeoutMs?: number;
  claudeExecutable?: string;
  isolatedHome?: string;
  anthropicApiKeyEnv?: string;
  tdaiUserKeyEnv?: string;
  dryRun?: boolean;
  enableTdaiHorizonStop?: boolean;
  executeProcess?: (input: CodexProcessExecutionInput) => Promise<CodexProcessExecutionResult>;
}

export function buildMemoryProxyClaudeBaseUrl(proxyBaseUrl: string, spaceId: string): string {
  const base = normalizeBaseUrl(proxyBaseUrl);
  return `${base}/claude-code/${encodeURIComponent(validateIdentifier("spaceId", spaceId))}`;
}

function isClaudeCliModel(model: string): boolean {
  return /^(default|sonnet|opus|haiku|claude(?:-[a-z0-9.-]+)?)$/i.test(model.trim());
}

export function buildClaudeCodeInvocation(input: ClaudeCodeInvocationInput): CodexInvocation {
  return {
    executable: process.platform === "win32" ? "claude.exe" : "claude",
    commandPrefix: [],
    args: [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      input.systemInstructions ?? WINDOWS_HTTP_INSTRUCTIONS,
      "--dangerously-skip-permissions",
      "--model",
      input.model,
    ],
  };
}

export function resolveClaudeCodeInvocation(
  invocation: CodexInvocation,
  options: ResolveCodexInvocationOptions = {},
): CodexInvocation {
  if (options.explicitExecutable) {
    return { executable: options.explicitExecutable, args: [...invocation.args], commandPrefix: [] };
  }
  const platform = options.platform ?? process.platform;
  const appData = options.appData ?? process.env.APPDATA;
  if (platform === "win32" && appData) {
    const cliEntrypoint = join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    const pathExists = options.pathExists ?? existsSync;
    const nativeExecutable = join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (pathExists(nativeExecutable)) return { executable: nativeExecutable, args: [...invocation.args], commandPrefix: [] };
    if (pathExists(cliEntrypoint)) {
      return {
        executable: options.nodeExecutable ?? process.execPath,
        args: [cliEntrypoint, ...invocation.args],
        commandPrefix: [cliEntrypoint],
      };
    }
  }
  return {
    executable: invocation.executable,
    args: [...invocation.args],
    commandPrefix: [...(invocation.commandPrefix ?? [])],
  };
}

export function isolateClaudeEnvironment(
  source: NodeJS.ProcessEnv,
  isolatedHome: string,
  isolatedConfigDir: string,
): NodeJS.ProcessEnv {
  const isolated = isolatedClientEnvironment(source, isolatedHome, "claude-code");
  isolated.CLAUDE_CONFIG_DIR = isolatedConfigDir;
  return isolated;
}

export function buildAnthropicCustomHeaders(input: {
  identity: ClaudeCodeIdentity;
  tdaiUserKeyEnv?: string;
  environment?: NodeJS.ProcessEnv;
}): string {
  const identity = validateIdentity(input.identity);
  const lines = [
    `session-id: ${identity.sessionId}`,
    `x-conversation-id: ${identity.sessionId}`,
    `x-team-id: ${identity.teamId}`,
    `x-agent-id: ${identity.agentId}`,
    `x-tdai-team-id: ${identity.teamId}`,
    `x-tdai-agent-id: ${identity.agentId}`,
  ];
  if (identity.taskId) {
    lines.push(`x-task-id: ${identity.taskId}`);
    lines.push(`x-tdai-task-id: ${identity.taskId}`);
  }
  const env = input.environment ?? process.env;
  const userKeyName = input.tdaiUserKeyEnv ?? TDAI_EVAL_USER_KEY_ENV;
  const userKey = env[userKeyName];
  if (userKey && userKey.trim()) lines.push(`x-tdai-user-key: ${userKey.trim()}`);
  return lines.join("\n");
}

export function writeIsolatedClaudeSettings(configDir: string, proxyBaseUrl: string): string {
  mkdirSync(configDir, { recursive: true });
  const settingsPath = join(configDir, "settings.json");
  writeFileSync(settingsPath, `${JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: proxyBaseUrl,
    },
  }, null, 2)}\n`, "utf8");
  return settingsPath;
}

export function claudeProcessInfrastructureError(result: {
  timedOut: boolean;
  exitCode: number | null;
  stoppedByEvaluation?: boolean;
  infrastructureStopReason?: string;
}): string | undefined {
  if (result.infrastructureStopReason) return result.infrastructureStopReason;
  if (result.stoppedByEvaluation) return undefined;
  if (result.timedOut) return "Claude Code runner timed out";
  if (result.exitCode !== 0) return `Claude Code runner exited with code ${String(result.exitCode)}`;
  return undefined;
}

export async function runClaudeCodeCase(options: ClaudeCodeRunOptions): Promise<Record<string, unknown>> {
  const totalStart = performance.now();
  const timings = { prepareMs: 0, clientMs: 0, firstOutputMs: null as number | null, finalizeMs: 0, totalMs: 0 };
  const stage = options.variant ? evaluationStage(options.variant, options.proxyBaseUrl) : undefined;
  const proxyHealth = stage && !options.dryRun ? await verifyEvaluationStage(stage) : undefined;
  const identity = validateIdentity(options.identity);
  const workspaceDir = resolve(options.workspaceDir);
  if (!existsSync(workspaceDir)) throw new Error(`workspace does not exist: ${workspaceDir}`);
  const outputDir = resolve(options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  for (const name of ["run-manifest.json", "run-result.json", "claude-code-receipt.json", "claude-code-events.jsonl", "claude-code-stderr.log", "capture-status.json"]) {
    if (existsSync(join(outputDir, name))) throw new Error(`Output already contains evaluation evidence: ${outputDir}`);
  }
  // A persistent claim also rejects a second process before either can overwrite metadata.
  writeFileSync(join(outputDir, ".runner-claim"), `${process.pid}\n`, { flag: "wx" });
  const isolatedHome = resolve(options.isolatedHome ?? mkdtempSync(join(outputDir, "claude-home-")));
  const isolatedConfigDir = join(isolatedHome, "claude-config");
  mkdirSync(isolatedHome, { recursive: true });
  const providerBaseUrl = buildMemoryProxyClaudeBaseUrl(options.proxyBaseUrl, identity.spaceId);
  writeIsolatedClaudeSettings(isolatedConfigDir, providerBaseUrl);
  const invocation = resolveClaudeCodeInvocation(
    buildClaudeCodeInvocation({ workspaceDir, model: isClaudeCliModel(options.model) ? options.model : "sonnet", prompt: options.prompt, systemInstructions: options.systemInstructions }),
    { explicitExecutable: options.claudeExecutable },
  );
  const environment = isolateClaudeEnvironment(process.env, isolatedHome, isolatedConfigDir);
  prepareClientHome(environment);
  const apiKeyEnv = options.anthropicApiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey = process.env[apiKeyEnv] ?? process.env.DS_API_KEY ?? "";
  if (!isClaudeCliModel(options.model)) {
    environment.ANTHROPIC_DEFAULT_SONNET_MODEL = options.model;
  }
  environment.ANTHROPIC_BASE_URL = providerBaseUrl;
  environment.ANTHROPIC_API_KEY = apiKey;
  environment.ANTHROPIC_CUSTOM_HEADERS = buildAnthropicCustomHeaders({
    identity,
    tdaiUserKeyEnv: options.tdaiUserKeyEnv,
    environment: process.env,
  });
  if (options.frozenSkillCatalog) environment.ANTHROPIC_CUSTOM_HEADERS += String.fromCharCode(10) + FROZEN_SKILL_CATALOG_HEADER + ": " + encodeFrozenSkillCatalog(options.frozenSkillCatalog);
  const reproductionCommand = [
    invocation.executable,
    ...invocation.args,
    "--",
    "<prompt-on-stdin>",
  ].join(" ");
  const manifest = {
    schemaVersion: "task1.claude-code-run-manifest.v1",
    runner: CLAUDE_CODE_RUNNER,
    stage: stage ?? null,
    proxyInstanceId: proxyHealth?.serverInstanceId ?? null,
    agent: CLAUDE_CODE_RUNNER,
    caseId: options.caseId,
    model: options.model,
    proxyBaseUrl: providerBaseUrl,
    workspaceDir,
    isolatedHome,
    isolatedConfigDir,
    identity: {
      spaceId: identity.spaceId,
      sessionId: identity.sessionId,
      teamId: identity.teamId,
      agentId: identity.agentId,
      ...(identity.taskId ? { taskId: identity.taskId } : {}),
    },
    executable: invocation.executable,
    args: invocation.args,
    timeoutMs: options.timeoutMs ?? FORMAL_EPISODE_POLICY.defaultWallTimeMs,
    episodePolicy: {
      additionalUserTurns: FORMAL_EPISODE_POLICY.additionalUserTurns,
      tdaiAttemptHorizon: options.enableTdaiHorizonStop === false ? null : FORMAL_EPISODE_POLICY.tdaiAttemptHorizon,
      stopPolicy: options.enableTdaiHorizonStop === false ? "natural-completion" : "tdai-horizon",
      wallTimeMs: options.timeoutMs ?? FORMAL_EPISODE_POLICY.defaultWallTimeMs,
    },
  };
  writeFileSync(join(outputDir, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (options.dryRun) return { ...manifest, outputDir, dryRun: true, reproductionCommand };
  const processInput: CodexProcessExecutionInput = {
    onOutput: (stream) => { if (stream === "stdout" && timings.firstOutputMs === null) timings.firstOutputMs = performance.now() - clientStart; },
    executable: invocation.executable,
    args: invocation.args,
    cwd: workspaceDir,
    environment,
    stdin: options.prompt,
    timeoutMs: options.timeoutMs ?? FORMAL_EPISODE_POLICY.defaultWallTimeMs,
    ...(options.enableTdaiHorizonStop === false
      ? {}
      : { stopWhen: createPublicTdaiHorizonStopWhen(FORMAL_EPISODE_POLICY.tdaiAttemptHorizon) }),
  };
  timings.prepareMs = performance.now() - totalStart;
  const clientStart = performance.now();
  const result = await executeClaudeWithRawCapture(
    processInput,
    outputDir,
    options.executeProcess ?? executeCodexProcess,
  );
  timings.clientMs = performance.now() - clientStart;
  const finalizeStart = performance.now();
  const finalized = finalizeClaudeRun(options, identity, manifest, result, reproductionCommand, outputDir, workspaceDir);
  timings.finalizeMs = performance.now() - finalizeStart;
  timings.totalMs = performance.now() - totalStart;
  writeFileSync(join(outputDir, "timings.json"), JSON.stringify(timings), { flag: "wx" });
  return { ...finalized, timings };
}

function finalizeClaudeRun(
  options: ClaudeCodeRunOptions,
  identity: ClaudeCodeIdentity,
  manifest: Record<string, unknown>,
  result: CodexProcessExecutionResult,
  reproductionCommand: string,
  outputDir: string,
  workspaceDir: string,
): Record<string, unknown> {
  const lifecycle = inspectClaudeLifecycle(result.stdout);
  const infrastructureError = claudeProcessInfrastructureError(result)
    ?? (lifecycle.completed || result.stoppedByEvaluation ? undefined : "Claude Code lifecycle is incomplete or invalid");
  const toolEvents = normalizeClaudeToolEvents(result.stdout);
  const receipt = buildClaudeCodeReceipt({
    caseId: options.caseId,
    model: options.model,
    proxy: String(manifest.proxyBaseUrl),
    workspace: workspaceDir,
    identity,
    lifecycle: {
      ...lifecycle,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stoppedByEvaluation: result.stoppedByEvaluation ?? false,
      evaluationStopReason: result.evaluationStopReason,
      infrastructureError: infrastructureError ?? null,
    },
    toolEvents,
    usage: mergeClaudeUsageSources({
      cliUsage: extractClaudeCliUsage(result.stdout),
      proxyUsage: null,
    }),
    rawOutputPaths: {
      events: join(outputDir, "claude-code-events.jsonl"),
      stderr: join(outputDir, "claude-code-stderr.log"),
      captureStatus: join(outputDir, "capture-status.json"),
    },
    reproductionCommand,
  });
  writeClaudeCodeReceipt(outputDir, receipt);
  writeFileSync(join(outputDir, "run-result.json"), `${JSON.stringify({
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stoppedByEvaluation: result.stoppedByEvaluation ?? false,
    infrastructureError: infrastructureError ?? null,
    lifecycle,
  }, null, 2)}\n`, "utf8");
  return { ...manifest, outputDir, receipt, infrastructureError: infrastructureError ?? null, lifecycle };
}

function validateIdentity(input: ClaudeCodeIdentity): ClaudeCodeIdentity {
  return {
    spaceId: validateIdentifier("spaceId", input.spaceId),
    sessionId: validateIdentifier("sessionId", input.sessionId),
    teamId: validateIdentifier("teamId", input.teamId),
    agentId: validateIdentifier("agentId", input.agentId),
    ...(input.taskId ? { taskId: validateIdentifier("taskId", input.taskId) } : {}),
  };
}

function validateIdentifier(name: string, value: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) throw new Error(`${name} contains unsupported characters`);
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("baseUrl is required");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("baseUrl must be an absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must use HTTP or HTTPS");
  }
  return normalized;
}

function cliValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const caseId = cliValue("--case");
  const model = cliValue("--model");
  const prompt = cliValue("--prompt");
  const workspace = cliValue("--workspace");
  const proxy = cliValue("--proxy-base-url");
  const spaceId = cliValue("--space-id");
  const teamId = cliValue("--team-id");
  const agentId = cliValue("--agent-id");
  if (!caseId || !model || !prompt || !workspace || !proxy || !spaceId || !teamId || !agentId) {
    console.error("usage: tsx eval/tool-prompt-bench/claude-code-runner.ts --case <id> --model <model> --prompt <text> --workspace <dir> --proxy-base-url <url> --space-id <id> --team-id <id> --agent-id <id> [--task-id <id>] [--session-id <id>] [--out <dir>] [--timeout-ms 180000] [--dry-run]");
    process.exitCode = 2;
  } else {
    const result = await runClaudeCodeCase({
      caseId,
      model,
      prompt,
      variant: cliValue("--variant") as EvaluationVariant | undefined,
      workspaceDir: workspace,
      proxyBaseUrl: proxy,
      outputDir: cliValue("--out") ?? resolve(process.cwd(), "eval", "tool-prompt-bench", "runs", "claude-code", randomUUID()),
      identity: {
        spaceId,
        sessionId: cliValue("--session-id") ?? `eval-claude-${randomUUID()}`,
        teamId,
        agentId,
        ...(cliValue("--task-id") ? { taskId: cliValue("--task-id") } : {}),
      },
      timeoutMs: Number(cliValue("--timeout-ms") ?? String(FORMAL_EPISODE_POLICY.defaultWallTimeMs)),
      claudeExecutable: cliValue("--claude-bin"),
      dryRun: process.argv.includes("--dry-run"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.infrastructureError) process.exitCode = 1;
  }
}
