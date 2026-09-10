import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { ownProcessTree, processTreeSpawnOptions, processTreeIsStopping } from './process-tree.js';

export interface CodexInvocationInput {
  workspaceDir: string;
  model: string;
  configArgs: string[];
  approveForMe?: boolean;
  /** Evaluation-only mode for an already isolated case workspace. */
  executionPolicy?: "auto-review" | "unrestricted";
}

export interface CodexInvocation {
  executable: string;
  args: string[];
  commandPrefix?: string[];
}

export interface ResolveCodexInvocationOptions {
  explicitExecutable?: string;
  platform?: NodeJS.Platform;
  appData?: string;
  nodeExecutable?: string;
  pathExists?: (path: string) => boolean;
}

export interface CodexProfileInput {
  /**
   * Mock-contract compatibility only. Real-chain runs leave this undefined so
   * MemoryProxy remains the sole owner of TDAI system-prompt injection.
   */
  developerInstructions?: string;
  providerBaseUrl?: string;
  providerHeaders?: Record<string, string>;
  /** Provider header -> environment variable name. Secret values never enter CLI args. */
  providerEnvHeaders?: Record<string, string>;
  reasoningEffort: CodexReasoningEffort;
  verbosity: CodexVerbosity;
}

export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexVerbosity = "low" | "medium" | "high";

export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "high";
export const DEFAULT_CODEX_VERBOSITY: CodexVerbosity = "medium";
export const TDAI_EVAL_USER_KEY_ENV = "TDAI_EVAL_USER_KEY" as const;


export interface CodexPromptAudit {
  sha256: string;
  messageCount: number;
  skillsInstructionsPresent: false;
}

export function codexProcessInfrastructureError(result: {
  timedOut: boolean;
  exitCode: number | null;
  stoppedByEvaluation?: boolean;
  infrastructureStopReason?: string;
  stdout?: string;
  stderr?: string;
}): string | undefined {
  if (result.infrastructureStopReason) return result.infrastructureStopReason;
  if (result.stoppedByEvaluation) return undefined;
  if (result.timedOut) return "Codex runner timed out";
  const processOutput = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/(?:rejected:\s*)?blocked by (?:execution )?policy|command execution[^\n]*(?:denied|blocked)|status["']?\s*:\s*["']declined|history envelope|automatic approval review failed/i.test(processOutput)) {
    return "Codex tool execution was blocked by local policy";
  }
  if (result.exitCode !== 0) return `Codex runner exited with code ${String(result.exitCode)}`;
  return undefined;
}

export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ParsedCodexJsonlRecord {
  lineNumber: number;
  raw: string;
  event: Record<string, unknown> | null;
  parseError?: string;
}

export interface CodexProcessExecutionInput {
  /** Raw decoded chunks, delivered before event interpretation or stopping. */
  readonly onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  /** Return a reason to stop only the child process started for this evaluation. */
  readonly stopWhen?: (snapshot: CodexProcessSnapshot) => string | undefined;
  readonly stopCheckIntervalMs?: number;
}

export interface CodexProcessExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly stoppedByEvaluation?: boolean;
  readonly evaluationStopReason?: string;
  readonly infrastructureStopReason?: string;
}

export interface CodexProcessSnapshot {
  readonly stdout: string;
  readonly stderr: string;
}

/** Public, Gold-blind stop predicate. Count completed tool calls, not stream events. */
export function createPublicTdaiHorizonStopWhen(horizon: number, reason = "tdai_attempt_horizon") {
  if (!Number.isSafeInteger(horizon) || horizon < 1) throw new Error("public TDAI horizon must be a positive integer");
  return ({ stdout }: CodexProcessSnapshot): string | undefined => {
    const completed = new Set<string>();
    const claudeCalls = new Set<string>();
    const isBridgeCall = (value: unknown): boolean => /\/(?:memory-bridge|skill-bridge|knowledge)\//iu.test(
      typeof value === "string" ? value : JSON.stringify(value ?? ""),
    );
    for (const record of parseCodexJsonlEvents(stdout)) {
      const value = record.event;
      if (!value) continue;
      if (value.type === "item.completed" && value.item && typeof value.item === "object") {
        const item = value.item as Record<string, unknown>;
        if (item.type === "command_execution" && isBridgeCall(item.command)) {
          completed.add(`codex:${item.id ?? record.lineNumber}`);
        }
      } else if (value.type === "function_call" && isBridgeCall(value.arguments)) {
        completed.add(`function:${value.call_id ?? value.id ?? record.lineNumber}`);
      } else if (value.type === "assistant" || value.type === "user") {
        const message = value.message as { content?: Array<Record<string, unknown>> } | undefined;
        if (!Array.isArray(message?.content)) continue;
        for (const part of message.content) {
          if (part.type === "tool_use" && typeof part.id === "string" && isBridgeCall(part.input)) {
            claudeCalls.add(part.id);
          } else if (part.type === "tool_result" && typeof part.tool_use_id === "string" && claudeCalls.has(part.tool_use_id)) {
            completed.add(`claude:${part.tool_use_id}`);
          }
        }
      }
    }
    return completed.size >= horizon ? reason : undefined;
  };
}

/**
 * Detect a terminal provider retry sequence while the Codex child is still
 * running. The CLI can otherwise remain alive until the benchmark's much
 * longer outer timeout even after its final request retry has failed.
 */
export function codexStreamingInfrastructureError(
  stdout: string,
  stderr = "",
): string | undefined {
  const messages = parseCodexJsonlEvents(stdout).flatMap((record) => {
    if (record.event?.type !== "error" || typeof record.event.message !== "string") return [];
    return [record.event.message];
  });
  const combined = [...messages, stderr];
  if (combined.some((message) => /Reconnecting\.\.\.\s*5\/5\s*\(request timed out\)/i.test(message))) {
    return "Codex provider request timed out after reconnect retries";
  }
  return undefined;
}

/**
 * Lossless, pure JSONL parsing seam for real-chain event reconciliation.
 * Blank lines are ignored; malformed non-blank lines remain in the result.
 */
export function parseCodexJsonlEvents(eventsJsonl: string): ParsedCodexJsonlRecord[] {
  const records: ParsedCodexJsonlRecord[] = [];
  eventsJsonl.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        records.push({
          lineNumber: index + 1,
          raw,
          event: null,
          parseError: "Codex JSONL event must be an object",
        });
        return;
      }
      records.push({ lineNumber: index + 1, raw, event: parsed as Record<string, unknown> });
    } catch (err) {
      records.push({
        lineNumber: index + 1,
        raw,
        event: null,
        parseError: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return records;
}

export function codexRunInfrastructureError(
  result: Parameters<typeof codexProcessInfrastructureError>[0],
  usage: CodexUsage | null,
): string | undefined {
  return codexProcessInfrastructureError(result)
    ?? (usage || result.stoppedByEvaluation
      ? undefined
      : "Codex JSONL did not contain complete turn.completed usage");
}

export function countInjectionTokens(prompt: string): number {
  // Native CLI execution does not require the mock harness's local tokenizer.
  const { get_encoding } = createRequire(import.meta.url)("tiktoken");
  const encoding = get_encoding("o200k_base");
  try {
    return encoding.encode(prompt).length;
  } finally {
    encoding.free();
  }
}

export function normalizePromptCacheTemplate(
  prompt: string,
  bridgeBaseUrl: string,
  sessionId: string,
): string {
  return prompt
    .split(bridgeBaseUrl.replace(/\/$/, "")).join("<BRIDGE_BASE_URL>")
    .split(sessionId).join("<SESSION_ID>");
}

export function extractCodexUsage(eventsJsonl: string): CodexUsage | null {
  const records = eventsJsonl.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed.type === "turn.completed" && parsed.usage && typeof parsed.usage === "object"
        ? [parsed.usage as Record<string, unknown>]
        : [];
    } catch {
      return [];
    }
  });
  const usage = records.at(-1);
  if (!usage) return null;
  const requiredFields = [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ] as const;
  if (requiredFields.some((field) => (
    typeof usage[field] !== "number"
    || !Number.isFinite(usage[field])
    || (usage[field] as number) < 0
  ))) return null;
  const number = (field: typeof requiredFields[number]): number => usage[field] as number;
  return {
    inputTokens: number("input_tokens"),
    cachedInputTokens: number("cached_input_tokens"),
    cacheWriteInputTokens: number("cache_write_input_tokens"),
    outputTokens: number("output_tokens"),
    reasoningOutputTokens: number("reasoning_output_tokens"),
  };
}

/** Verify the effective client prompt, not only the benchmark-owned block. */
export function auditCodexPromptInput(
  rawPromptInput: string,
  expectedDeveloperInstructions: string,
): CodexPromptAudit {
  let messages: unknown;
  try {
    messages = JSON.parse(rawPromptInput);
  } catch {
    throw new Error("Codex prompt audit did not return valid JSON");
  }
  if (!Array.isArray(messages)) throw new Error("Codex prompt audit must be a JSON array");
  const texts = messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => (
      part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
        ? [(part as Record<string, unknown>).text as string]
        : []
    ));
  });
  if (!texts.some((value) => value.includes(expectedDeveloperInstructions))) {
    throw new Error("Codex prompt audit is missing the benchmark developer instructions");
  }
  if (texts.some((value) => value.includes("<skills_instructions>"))) {
    throw new Error("Codex prompt audit contains client skill instructions");
  }
  return {
    sha256: createHash("sha256").update(rawPromptInput).digest("hex"),
    messageCount: messages.length,
    skillsInstructionsPresent: false,
  };
}

export function buildCodexInvocation(input: CodexInvocationInput): CodexInvocation {
  return {
    executable: process.platform === "win32" ? "codex.exe" : "codex",
    commandPrefix: [],
    args: [
      "exec",
      "--ephemeral",
      "--ignore-rules",
      "--ignore-user-config",
      ...(input.executionPolicy === "unrestricted"
        ? ["--sandbox", "danger-full-access"]
        : input.approveForMe
        ? ["--approve-for-me"]
        : ["--sandbox", "workspace-write"]),
      "--disable",
      "plugins",
      "--disable",
      "recommended_plugins",
      "--disable",
      "remote_plugin",
      ...input.configArgs,
      "--json",
      "--skip-git-repo-check",
      "--cd",
      input.workspaceDir,
      "--model",
      input.model,
      "-",
    ],
  };
}

/** Avoid the Windows Store alias, which cannot always be spawned by Node. */
export function resolveCodexInvocation(
  invocation: CodexInvocation,
  options: ResolveCodexInvocationOptions = {},
): CodexInvocation {
  if (options.explicitExecutable) {
    return { executable: options.explicitExecutable, args: [...invocation.args], commandPrefix: [] };
  }
  const platform = options.platform ?? process.platform;
  const appData = options.appData ?? process.env.APPDATA;
  if (platform === "win32" && appData) {
    const cliEntrypoint = join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    const pathExists = options.pathExists ?? existsSync;
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

export function isolateCodexEnvironment(
  source: NodeJS.ProcessEnv,
  authenticatedCodexHome: string,
  isolatedHome: string,
): NodeJS.ProcessEnv {
  const isolated = Object.fromEntries(Object.entries(source).filter(([name]) => !name.toUpperCase().startsWith("CODEX_")));
  // Authentication remains in the single, already logged-in CODEX_HOME. Never
  // copy auth.json: OAuth refresh/rotation from a copied cache can invalidate the
  // cache used by the desktop app or the user's normal CLI session.
  isolated.CODEX_HOME = authenticatedCodexHome;
  isolated.CODEX_SQLITE_HOME = join(isolatedHome, "sqlite");
  isolated.CODEX_CI = "1";
  // Codex also discovers user-level assets below the platform home directory
  // (for example ~/.agents/skills). Point both home variables at the fresh run
  // directory so a benchmark cannot inherit personal skills or prior state.
  isolated.HOME = isolatedHome;
  isolated.USERPROFILE = isolatedHome;
  // Keep platform-specific config/data/state roots inside the run directory as
  // well. CODEX_HOME intentionally remains the authenticated home for auth
  // lookup, while --ignore-user-config and the isolated SQLite home prevent its
  // mutable config/history from entering the benchmark.
  isolated.XDG_CONFIG_HOME = join(isolatedHome, "xdg-config");
  isolated.XDG_DATA_HOME = join(isolatedHome, "xdg-data");
  isolated.XDG_STATE_HOME = join(isolatedHome, "xdg-state");
  isolated.APPDATA = join(isolatedHome, "appdata");
  isolated.LOCALAPPDATA = join(isolatedHome, "localappdata");
  return isolated;
}

/** Convert the benchmark-only profile into invocation-scoped CLI overrides. */
export function buildCodexConfigArgs(input: CodexProfileInput): string[] {
  const values = [
    'approval_policy="never"',
    `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`,
    `model_verbosity=${JSON.stringify(input.verbosity)}`,
    "features.plugins=false",
    "features.apps=false",
    "features.multi_agent=false",
    "features.skill_search=false",
    "skills.include_instructions=false",
    "sandbox_workspace_write.network_access=true",
  ];
  if (input.developerInstructions !== undefined) {
    values.unshift(`developer_instructions=${JSON.stringify(input.developerInstructions)}`);
  }
  if (input.providerBaseUrl) {
    values.push(
      'model_provider="custom"',
      'model_providers.custom.name="TDAI Eval Proxy"',
      `model_providers.custom.base_url=${JSON.stringify(input.providerBaseUrl.replace(/\/$/, ""))}`,
      'model_providers.custom.wire_api="responses"',
      "model_providers.custom.requires_openai_auth=false",
      'model_providers.custom.env_key="OPENAI_API_KEY"',
      // Formal evaluation must use the HTTP Responses path.  Leaving this at
      // the CLI default makes Codex prewarm a ChatGPT WebSocket endpoint
      // before the custom provider is contacted, which bypasses the proxy and
      // can fail independently of the configured DS_BASE_URL.
      "model_providers.custom.supports_websockets=false",
    );
    const providerHeaders = Object.entries(input.providerHeaders ?? {}).filter(([name]) => !["authorization", "x-api-key"].includes(name.toLowerCase())).sort(([left], [right]) => left.localeCompare(right));
    if (providerHeaders.length > 0) {
      for (const [name] of providerHeaders) {
        if (!/^[a-z0-9-]+$/i.test(name)) throw new Error(`invalid provider header name: ${name}`);
      }
      const inlineTable = providerHeaders
        .map(([name, value]) => `${JSON.stringify(name.toLowerCase())} = ${JSON.stringify(value)}`)
        .join(", ");
      values.push(`model_providers.custom.http_headers={ ${inlineTable} }`);
    }
    const providerEnvHeaders = Object.entries(input.providerEnvHeaders ?? {}).sort(([left], [right]) => left.localeCompare(right));
    if (providerEnvHeaders.length > 0) {
      for (const [name, environmentName] of providerEnvHeaders) {
        if (!/^[a-z0-9-]+$/i.test(name)) throw new Error(`invalid provider header name: ${name}`);
        if (!/^[A-Z_][A-Z0-9_]*$/i.test(environmentName)) {
          throw new Error(`invalid provider header environment name: ${environmentName}`);
        }
      }
      const inlineTable = providerEnvHeaders
        .map(([name, environmentName]) => `${JSON.stringify(name.toLowerCase())} = ${JSON.stringify(environmentName)}`)
        .join(", ");
      values.push(`model_providers.custom.env_http_headers={ ${inlineTable} }`);
      values.push(`shell_environment_policy.exclude=${JSON.stringify(providerEnvHeaders.map(([, environmentName]) => environmentName))}`);
    }
  }
  return values.flatMap((value) => ["-c", value]);
}


function runChild(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  stdin: string,
  timeoutMs: number,
  options: Pick<CodexProcessExecutionInput, "stopWhen" | "stopCheckIntervalMs" | "onOutput"> = {},
): Promise<CodexProcessExecutionResult> {
  return new Promise((resolveRun, reject) => {
    if(processTreeIsStopping()){reject(Error('Evaluation is shutting down'));return;}
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, ...processTreeSpawnOptions() });
    const stopTree=ownProcessTree(child);
    let stopFailure:unknown;
    const terminateChild=(_child:ChildProcess)=>{void stopTree().catch(error=>{stopFailure=error;});};
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stoppedByEvaluation = false;
    let stopReason: string | undefined;
    let infrastructureStopReason: string | undefined;
    let settled = false;
    let stopCheck: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      clearTimeout(timeout);
      if (stopCheck) clearInterval(stopCheck);
    };
    const inspectForStop = (): void => {
      if (stoppedByEvaluation || infrastructureStopReason || timedOut || settled) return;
      infrastructureStopReason = codexStreamingInfrastructureError(stdout, stderr);
      if (infrastructureStopReason) {
        terminateChild(child);
        return;
      }
      if (!options.stopWhen) return;
      let reason: string | undefined;
      try {
        reason = options.stopWhen({ stdout, stderr });
      } catch (error) {
        settled = true;
        cleanup();
        terminateChild(child);
        reject(error);
        return;
      }
      if (!reason) return;
      stoppedByEvaluation = true;
      stopReason = reason;
      terminateChild(child);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);
    if (options.stopWhen) {
      stopCheck = setInterval(inspectForStop, options.stopCheckIntervalMs ?? 25);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const capture = (stream: "stdout" | "stderr", chunk: string): void => {
      if (settled) return;
      try {
        options.onOutput?.(stream, chunk);
      } catch (error) {
        settled = true;
        cleanup();
        terminateChild(child);
        reject(error);
        return;
      }
      inspectForStop();
    };
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      capture("stdout", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      capture("stderr", chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", async (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      if(process.platform!=='win32'){
        try{await stopTree();}catch(error){reject(error);return;}
      }
      if(stopFailure){reject(stopFailure);return;}
      resolveRun({
        exitCode,
        stdout,
        stderr,
        timedOut,
        stoppedByEvaluation,
        ...(stopReason ? { evaluationStopReason: stopReason } : {}),
        ...(infrastructureStopReason ? { infrastructureStopReason } : {}),
      });
    });
    child.stdin.end(stdin);
  });
}

/** Execution seam shared by Pilot and the Gold-blind formal runner. */
export function executeCodexProcess(
  input: CodexProcessExecutionInput,
): Promise<CodexProcessExecutionResult> {
  return runChild(
    input.executable,
    [...input.args],
    input.cwd,
    input.environment,
    input.stdin,
    input.timeoutMs,
    { stopWhen: input.stopWhen, stopCheckIntervalMs: input.stopCheckIntervalMs, onOutput: input.onOutput },
  );
}
