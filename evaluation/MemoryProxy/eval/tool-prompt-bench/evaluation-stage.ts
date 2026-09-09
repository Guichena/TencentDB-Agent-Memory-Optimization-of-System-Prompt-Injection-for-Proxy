export type EvaluationVariant = "server_team" | "V4";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function evaluationStage(variant: string, baseUrl = "http://127.0.0.1:8096") {
  if (variant !== "server_team" && variant !== "V4") throw new Error("Variant must be server_team or V4");
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Proxy URL must be an HTTP(S) origin without credentials");
  }
  return { variant, proxyBaseUrl: url.origin, profile: variant === "V4" ? "v4-compact" : "legacy" } as const;
}

export async function verifyEvaluationStage(stage: ReturnType<typeof evaluationStage>, request: typeof fetch = fetch) {
  const response = await request(`${stage.proxyBaseUrl}/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Proxy health failed: HTTP ${response.status}`);
  const health = await response.json() as { toolPromptProfile?: string; serverInstanceId?: string };
  if (health.toolPromptProfile !== stage.profile) throw new Error(`Proxy profile mismatch: expected ${stage.profile}, got ${health.toolPromptProfile}`);
  return health;
}

export const WINDOWS_HTTP_INSTRUCTIONS = "On Windows PowerShell, call the injected bridge URLs with Invoke-RestMethod, a hashtable for -Headers, ConvertTo-Json for -Body, and -TimeoutSec 30. Never use the curl alias or Bash-style backslash escaping. If using curl.exe, send UTF-8 JSON via a file with --data-binary @file and --connect-timeout 5 --max-time 30. Do not invent or change bridge ports.";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--print-windows-http-instructions")) console.log(WINDOWS_HTTP_INSTRUCTIONS);
