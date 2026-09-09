import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isolatedClientEnvironment, prepareClientHome } from "../evaluation/MemoryProxy/eval/tool-prompt-bench/client-home.mjs";

const root = resolve(import.meta.dirname, "..");
const date = new Date().toISOString().slice(0, 10);
const runId = process.argv[2] || new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId)) throw new Error("Run ID must contain only letters, digits, underscores and hyphens");
const runsRoot = join(root, "runs", "cli-smoke", date);
const runDir = join(runsRoot, runId);

const required = ["TDAI_MEMORY_USER_KEY", "TDAI_SPACE_ID", "TDAI_TEAM_ID", "TDAI_AGENT_ID", "TDAI_CODEX_PROVIDER_API_KEY", "TDAI_CODEX_MODEL", "TDAI_CLAUDE_PROVIDER_API_KEY", "TDAI_CLAUDE_MODEL"];
for (const key of required) if (!process.env[key]) throw new Error("Missing " + key);
mkdirSync(runsRoot, { recursive: true });
mkdirSync(runDir);

function execute(name, executable, args, environment, stdin = "") {
  const outputDir = join(runDir, name);
  mkdirSync(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let firstOutputMs = null;
  let stdout = "";
  let stderr = "";
  return new Promise((resolveRun) => {
    const child = spawn(executable, args, { cwd: root, env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { if (firstOutputMs === null) firstOutputMs = performance.now() - started; stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(stdin);
    const timeout = setTimeout(() => child.kill(), 180_000);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      const processSummary = { name, startedAt, exitCode, signal, firstOutputMs: firstOutputMs === null ? null : Math.round(firstOutputMs), totalMs: Math.round(performance.now() - started) };
      writeFileSync(join(outputDir, "stdout.jsonl"), stdout);
      writeFileSync(join(outputDir, "stderr.log"), stderr);
      writeFileSync(join(outputDir, "process.json"), JSON.stringify(processSummary, null, 2) + "\n");
      resolveRun({ ...processSummary, stdout });
    });
  });
}

const identity = { spaceId: process.env.TDAI_SPACE_ID, teamId: process.env.TDAI_TEAM_ID, agentId: process.env.TDAI_AGENT_ID, taskId: process.env.TDAI_TASK_ID || null };
const sessions = { codex: "cli-codex-" + randomUUID(), claude: "cli-claude-" + randomUUID() };
writeFileSync(join(runDir, "session.json"), JSON.stringify({ runId, createdAt: new Date().toISOString(), identity, sessions }, null, 2) + "\n");

const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
const npmModules = join(appData, "npm", "node_modules");
const codexHome = join(runDir, "codex", "runtime", "home");
const codexEnv = { ...isolatedClientEnvironment(process.env, codexHome, "codex"), CODEX_CI: "1", OPENAI_API_KEY: process.env.TDAI_CODEX_PROVIDER_API_KEY, TDAI_MEMORY_USER_KEY: process.env.TDAI_MEMORY_USER_KEY };
prepareClientHome(codexEnv);
const codexHeaders = { "x-conversation-id": sessions.codex, "x-team-id": identity.teamId, "x-agent-id": identity.agentId, ...(identity.taskId ? { "x-task-id": identity.taskId } : {}) };
const headerTable = Object.entries(codexHeaders).map(([key, value]) => JSON.stringify(key) + " = " + JSON.stringify(value)).join(", ");
const codexArgs = [
  join(npmModules, "@openai", "codex", "bin", "codex.js"), "exec", "--ephemeral", "--ignore-rules", "--ignore-user-config",
  "--sandbox", "danger-full-access", "--disable", "plugins", "--disable", "recommended_plugins", "--disable", "remote_plugin",
  "-c", 'approval_policy="never"', "-c", 'model_provider="custom"', "-c", 'model_providers.custom.name="TDAI Smoke Proxy"',
  "-c", 'model_providers.custom.base_url="http://127.0.0.1:8096/codex/default"', "-c", 'model_providers.custom.wire_api="responses"',
  "-c", "model_providers.custom.requires_openai_auth=false", "-c", 'model_providers.custom.env_key="OPENAI_API_KEY"',
  "-c", "model_providers.custom.supports_websockets=false", "-c", "model_providers.custom.http_headers={ " + headerTable + " }",
  "-c", 'model_providers.custom.env_http_headers={ "x-tdai-user-key" = "TDAI_MEMORY_USER_KEY" }',
  "--json", "--skip-git-repo-check", "--cd", root, "--model", process.env.TDAI_CODEX_MODEL, "-",
];

const claudeHome = join(runDir, "claude", "runtime", "home");
const claudeEnv = { ...isolatedClientEnvironment(process.env, claudeHome, "claude-code"), ANTHROPIC_BASE_URL: "http://127.0.0.1:8097/claude-code/default", ANTHROPIC_API_KEY: process.env.TDAI_CLAUDE_PROVIDER_API_KEY };
prepareClientHome(claudeEnv);
claudeEnv.ANTHROPIC_CUSTOM_HEADERS = ["session-id: " + sessions.claude, "x-conversation-id: " + sessions.claude, "x-team-id: " + identity.teamId, "x-agent-id: " + identity.agentId, ...(identity.taskId ? ["x-task-id: " + identity.taskId] : []), "x-tdai-user-key: " + process.env.TDAI_MEMORY_USER_KEY].join("\n");
const claudeArgs = ["--print", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--model", process.env.TDAI_CLAUDE_MODEL, "Reply with exactly: REAL_CLAUDE_CLI_OK"];

const [codex, claude] = await Promise.all([
  execute("codex", process.execPath, codexArgs, codexEnv, "Reply with exactly: REAL_CODEX_CLI_OK"),
  execute("claude", join(npmModules, "@anthropic-ai", "claude-code", "bin", "claude.exe"), claudeArgs, claudeEnv),
]);

function summarize(processResult) {
  const events = processResult.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const final = events.findLast((event) => event.type === "result" || event.type === "turn.completed");
  const codexMessage = events.findLast((event) => event.type === "item.completed" && event.item?.type === "agent_message");
  return {
    exitCode: processResult.exitCode,
    eventCount: events.length,
    firstOutputMs: processResult.firstOutputMs,
    totalMs: processResult.totalMs,
    finalType: final?.type || null,
    result: final?.result || codexMessage?.item?.text || null,
    ttftMs: final?.ttft_ms ?? null,
    streamingTtftMs: final?.ttft_stream_ms ?? null,
    apiDurationMs: final?.duration_api_ms ?? null,
    usage: final?.usage || final?.turn?.usage || null,
  };
}
const summary = { runId, runDir, codex: summarize(codex), claude: summarize(claude) };
writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
if (codex.exitCode !== 0 || claude.exitCode !== 0) process.exitCode = 1;
