import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { DualClientConfig } from "./dual-client-plan.js";
import type { Final5Client } from "./final5-task-input.js";

export function sourceFingerprint(root: string): string {
  const hash = createHash("sha256");
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(root, "MemoryProxy", relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative + "/" + entry.name;
      if (entry.isSymbolicLink()) throw new Error("Source symlink needs an explicit frozen snapshot: " + path);
      if (entry.isDirectory()) visit(path);
      else { hash.update(path); hash.update(readFileSync(join(root, "MemoryProxy", path))); }
    }
  };
  visit("src");
  hash.update(readFileSync(join(root, "MemoryProxy/package.json")));
  return hash.digest("hex");
}
export function sourceContractProblems(root: string): string[] {
  const server = readFileSync(join(root, "MemoryProxy/src/server.ts"), "utf8");
  const required = ["evaluationCapabilities", "codexHistory", "codexFrozenSkills", "claudeFrozenSkills", "experimentConfigFingerprint", "experimentReadOnly", "claudeUpstream"];
  return required.filter((field) => !server.includes(field));
}
export function managedEnvironment(config: DualClientConfig, client: Final5Client): NodeJS.ProcessEnv {
  const configured = parseEnv(readFileSync(config.envFile, "utf8"));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(TDAI_|DS_|ANTHROPIC_|FINAL5_)/i.test(name)));
  const env: NodeJS.ProcessEnv = { ...inherited, ...configured };
  if (config.assetRunRoot) {
    const identity = JSON.parse(readFileSync(join(config.assetRunRoot, "runtime-core/identity.json"), "utf8"));
    env.TDAI_MEMORY_USER_KEY = identity.userKey;
    env.TDAI_SPACE_ID = identity.serviceId;
    if (!config.runtimeBindings) throw new Error("Restored assets require runtime bindings");
    const first = JSON.parse(readFileSync(config.runtimeBindings, "utf8")).teams[0];
    env.TDAI_TEAM_ID = first.teamId;
    env.TDAI_AGENT_ID = first.agentId;
    if (first.taskId) env.TDAI_TASK_ID = first.taskId;
    else delete env.TDAI_TASK_ID;
  }
  env.NODE_USE_ENV_PROXY = "1";
  const noProxy = [...new Set([...(env.NO_PROXY ?? env.no_proxy ?? "").split(",").filter(Boolean), "127.0.0.1", "localhost", "::1"])].join(",");
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  for (const key of Object.keys(env)) if (key.startsWith("FINAL5_") || key.startsWith("TDAI_EVAL_")) delete env[key];
  const item = config.clients[client];
  const key = env[item.providerKeyEnv] ?? (client === "claude-code" ? env.ANTHROPIC_API_KEY : undefined) ?? env.DS_API_KEY;
  const upstream = item.upstreamUrl ?? (client === "claude-code" ? env.TDAI_CLAUDE_UPSTREAM_URL : env.TDAI_CODEX_UPSTREAM_URL) ?? env.DS_BASE_URL;
  if (!key || !upstream) throw new Error("Provider key/upstream missing for " + client);
  const url = new URL(upstream);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid upstream URL for " + client);
  for (const name of ["TDAI_MEMORY_USER_KEY", "TDAI_SPACE_ID", "TDAI_TEAM_ID", "TDAI_AGENT_ID", ...(config.assetRunRoot ? [] : ["TDAI_TASK_ID"])]) if (!env[name]) throw new Error("Missing shared identity setting: " + name);
  env.FINAL5_PROVIDER_API_KEY = key;
  env.FINAL5_UPSTREAM_URL = upstream;
  env.TDAI_CODEX_UPSTREAM_URL = upstream;
  if (config.assetRunRoot) {
    env.FINAL5_ASSET_RUN_ROOT = config.assetRunRoot;
    env.FINAL5_CORE_URL = config.coreUrl;
  }
  return env;
}
export function managedProxyConfig(base: any, port: number, variant: "server_team" | "V4", upstream: string) {
  const config = structuredClone(base);
  config.server = { ...config.server, host: "127.0.0.1", port };
  config.upstream = { ...config.upstream, url: upstream, apiKey: "", agents: {
    codex: { url: upstream, apiKey: "" }, "claude-code": { url: upstream, apiKey: "" },
  } };
  config.redis = { ...config.redis, enabled: false };
  config.storage = { ...config.storage, enabled: true, backend: "memory" };
  config.extraction = { ...config.extraction, enabled: false, extractors: [] };
  config.sessionInit = { ...config.sessionInit, headerAutoSelect: {
    ...config.sessionInit?.headerAutoSelect,
    enabled: true,
    teamHeader: "x-tdai-team-id",
    agentHeader: "x-tdai-agent-id",
    taskHeader: "x-tdai-task-id",
  } };
  config.tdai = { ...config.tdai, memory: { ...config.tdai?.memory, writeL0: false } };
  config.skillRuntime = { ...config.skillRuntime, allowLlmWrite: false };
  config.creditPricing = { ...config.creditPricing, models: [] };
  config.injection = { ...config.injection, externalGatewayUrl: "http://127.0.0.1:" + port,
    toolPromptProfile: variant === "V4" ? "v4-compact" : "legacy",
    assetReflection: { ...config.injection?.assetReflection, markerOptIn: false } };
  for (const name of ["langfuse", "opik", "clickhouse", "creditReport"]) config[name] = { ...config[name], enabled: false };
  config.log = { ...config.log, file: "", backend: "console" };
  return config;
}
