import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { buildMemoryProxyClaudeBaseUrl, resolveClaudeCodeInvocation } from "./claude-code-runner.js";
import { resolveCodexInvocation } from "./codex-runner.js";
import { FINAL5_TASK_INSTRUCTIONS, final5TaskInput, type Final5Client } from "./final5-task-input.js";
import { buildFinal5ProviderHeaders } from "./final5-real-executor.js";
import { buildMemoryProxyCodexBaseUrl } from "./real-chain-adapter.js";
import { encodeFrozenSkillCatalog, FROZEN_SKILL_CATALOG_HEADER, type FrozenSkillCatalogPayload } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";

export const PROTOCOL_PROBE_TOOL_NAME = "eval_protocol_probe" as const;

export interface Final5CliInvocation {
  executable: string;
  commandPrefix?: string[];
}

export interface ProtocolProbeRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const PROTOCOL_TIMEOUT_MS = 60000;
const CLI_VERSION_TIMEOUT_MS = 10000;

const PROBE_TOOL_DESCRIPTION = "Evaluation-only protocol probe. Do not call this tool.";

export function resolveFinal5Cli(client: Final5Client): Final5CliInvocation {
  return client === "codex"
    ? resolveCodexInvocation({ executable: process.platform === "win32" ? "codex.exe" : "codex", args: [], commandPrefix: [] }, { explicitExecutable: process.env.CODEX_EXECUTABLE })
    : resolveClaudeCodeInvocation({ executable: process.platform === "win32" ? "claude.exe" : "claude", args: [], commandPrefix: [] }, { explicitExecutable: process.env.CLAUDE_EXECUTABLE });
}

export function readFinal5CliVersion(
  cli: Final5CliInvocation,
  run: typeof execFileSync = execFileSync,
): string {
  const version = run(cli.executable, [...(cli.commandPrefix ?? []), "--version"], {
    encoding: "utf8",
    timeout: CLI_VERSION_TIMEOUT_MS,
    windowsHide: true,
  }).trim();
  if (!version) throw new Error("CLI --version produced no output");
  return version;
}

export function evaluationProtocolIdentity() {
  const spaceId = requiredEnv("TDAI_SPACE_ID");
  const teamId = requiredEnv("TDAI_TEAM_ID");
  const agentId = requiredEnv("TDAI_AGENT_ID");
  const taskId = process.env.TDAI_TASK_ID?.trim() || undefined;
  const userKey = requiredEnv("TDAI_MEMORY_USER_KEY");
  const apiKey = process.env.FINAL5_PROVIDER_API_KEY?.trim() || process.env.DS_API_KEY?.trim();
  if (!apiKey) throw new Error("FINAL5_PROVIDER_API_KEY or DS_API_KEY is required for protocol probe");
  return { spaceId, teamId, agentId, ...(taskId ? { taskId } : {}), userKey, apiKey };
}

export function buildFinal5ProtocolProbe(input: {
  client: Final5Client;
  proxyBaseUrl: string;
  model: string;
  identity: ReturnType<typeof evaluationProtocolIdentity> & { sessionId: string };
  frozenSkillCatalog?: FrozenSkillCatalogPayload;
}): ProtocolProbeRequest {
  if (!input.model.trim()) throw new Error("An explicit model is required for protocol probe");
  if (input.client === "codex") {
    const envelope = final5TaskInput([{ role: "user", content: "Reply OK" }]).envelope;
    return {
      url: `${buildMemoryProxyCodexBaseUrl(input.proxyBaseUrl, input.identity.spaceId)}/responses`,
      headers: {
        ...buildFinal5ProviderHeaders({
          apiKey: input.identity.apiKey,
          spaceId: input.identity.spaceId,
          sessionId: input.identity.sessionId,
          teamId: input.identity.teamId,
          agentId: input.identity.agentId,
          taskId: input.identity.taskId,
          frozenSkillCatalog: input.frozenSkillCatalog,
        }),
        "x-tdai-user-key": input.identity.userKey,
        "content-type": "application/json",
      },
      body: {
        model: input.model,
        stream: false,
        store: false,
        max_output_tokens: 16,
        tools: [{
          type: "function",
          name: PROTOCOL_PROBE_TOOL_NAME,
          description: PROBE_TOOL_DESCRIPTION,
          parameters: { type: "object", properties: {} },
        }],
        input: [
          { type: "message", role: "developer", content: [{ type: "input_text", text: FINAL5_TASK_INSTRUCTIONS }] },
          { type: "message", role: "user", content: [{ type: "input_text", text: envelope }] },
        ],
        client_metadata: { session_id: input.identity.sessionId },
      },
    };
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": input.identity.apiKey,
    authorization: `Bearer ${input.identity.apiKey}`,
    "session-id": input.identity.sessionId,
    "x-conversation-id": input.identity.sessionId,
    "x-team-id": input.identity.teamId,
    "x-agent-id": input.identity.agentId,
    "x-tdai-team-id": input.identity.teamId,
    "x-tdai-agent-id": input.identity.agentId,
    "x-tdai-user-key": input.identity.userKey,
  };
  if (input.identity.taskId) {
    headers["x-task-id"] = input.identity.taskId;
    headers["x-tdai-task-id"] = input.identity.taskId;
  }
  if (input.frozenSkillCatalog) headers[FROZEN_SKILL_CATALOG_HEADER] = encodeFrozenSkillCatalog(input.frozenSkillCatalog);
  return {
    url: `${buildMemoryProxyClaudeBaseUrl(input.proxyBaseUrl, input.identity.spaceId)}/v1/messages`,
    headers,
    body: {
      model: input.model,
      max_tokens: 16,
      stream: false,
      system: FINAL5_TASK_INSTRUCTIONS,
      tools: [{
        name: PROTOCOL_PROBE_TOOL_NAME,
        description: PROBE_TOOL_DESCRIPTION,
        input_schema: { type: "object", properties: {} },
      }],
      messages: [{ role: "user", content: "Reply OK" }],
    },
  };
}

export function assertProtocolProbeAccepted(status: number, bodyText: string): void {
  if (status < 200 || status >= 300) {
    throw new Error(`protocol probe failed: HTTP ${status} ${bodyText.slice(0, 200)}`);
  }
}

export async function probeFinal5Protocol(
  input: Parameters<typeof buildFinal5ProtocolProbe>[0],
  request: typeof fetch = fetch,
): Promise<void> {
  const probe = buildFinal5ProtocolProbe(input);
  const response = await request(probe.url, {
    method: "POST",
    headers: probe.headers,
    body: JSON.stringify(probe.body),
    signal: AbortSignal.timeout(PROTOCOL_TIMEOUT_MS),
  });
  assertProtocolProbeAccepted(response.status, await response.text());
}

export async function probeFinal5NativeReady(input: {
  client: Final5Client;
  proxyBaseUrl: string;
  model: string;
  frozenSkillCatalog?: FrozenSkillCatalogPayload;
  runCli?: typeof execFileSync;
  request?: typeof fetch;
}): Promise<{ cliVersion: string; cli: Final5CliInvocation }> {
  const cli = resolveFinal5Cli(input.client);
  const cliVersion = readFinal5CliVersion(cli, input.runCli);
  const identity = evaluationProtocolIdentity();
  await probeFinal5Protocol({
    client: input.client,
    proxyBaseUrl: input.proxyBaseUrl,
    model: input.model,
    frozenSkillCatalog: input.frozenSkillCatalog,
    identity: { ...identity, sessionId: `final5-protocol-probe-${input.client}-${randomUUID()}` },
  }, input.request);
  return { cliVersion, cli };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for protocol probe`);
  return value;
}
