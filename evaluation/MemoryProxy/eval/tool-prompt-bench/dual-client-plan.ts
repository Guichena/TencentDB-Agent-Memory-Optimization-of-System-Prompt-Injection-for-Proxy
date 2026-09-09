import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, resolve } from "node:path";
import type { Final5Client } from "./final5-task-input.js";

export function resolveConfigPath(base: string, value: string): string {
  if (process.platform !== "win32" && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) {
    throw new Error("Windows absolute config path cannot be used here; prepare a new run: " + value);
  }
  return resolve(base, value.replace(/\\/g, "/"));
}

export interface DualClientConfig {
  baselineRoot: string; v4Root: string; proxyConfig: string; envFile: string;
  plan: string; workspaceManifest: string; teamsRoot: string; skillCatalogBindings: string;
  outputRoot: string; timeoutMs: number; maxRetries: number;
  runtimeBindings?: string;
  assetRunRoot?: string;
  coreUrl?: string;
  clients: Record<Final5Client, { model: string; port: number; concurrency: number; upstreamUrl?: string; providerKeyEnv: string }>;
}
export function readDualClientConfig(path: string): DualClientConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const base = dirname(resolve(path));
  const env = parseEnv(readFileSync(resolveConfigPath(base, raw.envFile), "utf8"));
  if (raw.clients?.codex) {
    raw.clients.codex.model = env.TDAI_CODEX_MODEL || env.DS_MODEL;
    raw.clients.codex.port ??= Number(env.TDAI_CODEX_PROXY_PORT || 8096);
  }
  if (raw.clients?.["claude-code"]) {
    raw.clients["claude-code"].model = env.TDAI_CLAUDE_MODEL;
    raw.clients["claude-code"].port ??= Number(env.TDAI_CLAUDE_PROXY_PORT || 8097);
  }
  return validateDualClientConfig(raw, base);
}
export function validateDualClientConfig(raw: any, base: string): DualClientConfig {
  if (!raw || typeof raw !== "object") throw new Error("Experiment config must be an object");
  const path = (key: string) => {
    if (typeof raw[key] !== "string" || !raw[key].trim()) throw new Error("Missing " + key);
    return resolveConfigPath(base, raw[key]);
  };
  const integer = (value: unknown, fallback: number, min: number, max: number) => {
    const n = value === undefined ? fallback : value;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) throw new Error("Invalid concurrency, port, timeout or retry budget");
    return n;
  };
  const client = (name: Final5Client, port: number) => {
    const item = raw.clients?.[name];
    if (typeof item?.model !== "string" || !item.model.trim() || item.model.includes("<")) throw new Error("Specify the exact model for " + name);
    if (item.upstreamUrl !== undefined) {
      const url = new URL(item.upstreamUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid upstream URL");
    }
    const providerKeyEnv = item.providerKeyEnv ?? (name === "codex" ? "TDAI_CODEX_PROVIDER_API_KEY" : "TDAI_CLAUDE_PROVIDER_API_KEY");
    if (!/^[A-Z_][A-Z0-9_]*$/.test(providerKeyEnv)) throw new Error("Invalid provider key environment name");
    return { model: item.model.trim(), port: integer(item.port, port, 1024, 65535), concurrency: integer(item.concurrency, 1, 1, 10), upstreamUrl: item.upstreamUrl, providerKeyEnv };
  };
  const config: DualClientConfig = { baselineRoot: path("baselineRoot"), v4Root: path("v4Root"), proxyConfig: path("proxyConfig"), envFile: path("envFile"),
    plan: path("plan"), workspaceManifest: path("workspaceManifest"), teamsRoot: path("teamsRoot"), skillCatalogBindings: path("skillCatalogBindings"), outputRoot: path("outputRoot"),
    timeoutMs: integer(raw.timeoutMs, 180000, 1000, 3600000), maxRetries: integer(raw.maxRetries, 0, 0, 5),
    ...(raw.runtimeBindings ? { runtimeBindings: path("runtimeBindings") } : {}),
    ...(raw.assetRunRoot ? { assetRunRoot: path("assetRunRoot"), coreUrl: raw.coreUrl } : {}),
    clients: { codex: client("codex", 8096), "claude-code": client("claude-code", 8097) } };
  if (config.clients.codex.port === config.clients["claude-code"].port) throw new Error("Clients need distinct proxy ports");
  if (config.assetRunRoot && (!config.coreUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.coreUrl))) throw new Error("Frozen assets require a loopback Core URL");
  if (config.baselineRoot === config.v4Root) throw new Error("Baseline and V4 need distinct source directories");
  return config;
}
export function clientStagePaths(config: DualClientConfig, client: Final5Client, variant: "server_team" | "V4") {
  const root = resolve(config.outputRoot, client, variant);
  return { root, receipt: resolve(root, "execution.json"), workspaceRoot: resolve(root, "workspaces") };
}
