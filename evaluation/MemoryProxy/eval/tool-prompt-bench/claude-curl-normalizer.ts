import { TOOL_PROMPT_ENDPOINTS } from "./mock-bridge.js";
import { parseCurlCommand } from "./protocol-harness.js";
import type { TdaiAttempt } from "./evaluator.js";
import type { EvalFamily } from "./schema.js";
import { extractClaudeCommandObservations } from "./claude-code-event-parser.js";

const BRIDGE_HINT = /(?:memory-bridge|skill-bridge|\/tools\/(?:list|call)|knowledge)/iu;

export function looksLikeTdaiBridgeCommand(command: string): boolean {
  return BRIDGE_HINT.test(command);
}

export function normalizeClaudeCommand(rawCommand: string): TdaiAttempt {
  const command = rawCommand.trim();
  if (!looksLikeTdaiBridgeCommand(command)) {
    return malformed("command does not target a TDAI Memory/Skill/Knowledge endpoint", command);
  }
  try {
    if (isPowerShellCommand(command)) {
      return toAttempt(parsePowerShellBridgeCommand(command), command);
    }
    return toAttempt(parseEvalCurlCommand(canonicalizeCurlExecutable(command)), command);
  } catch (error) {
    return malformed(error instanceof Error ? error.message : String(error), command);
  }
}

export function normalizeClaudeToolEvents(eventsJsonl: string): TdaiAttempt[] {
  return extractClaudeCommandObservations(eventsJsonl)
    .filter((observation) => looksLikeTdaiBridgeCommand(observation.command))
    .map((observation) => normalizeClaudeCommand(observation.command));
}

interface ParsedBridgeRequest {
  method: string;
  url: string;
  pathname: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function parseEvalCurlCommand(rawCommand: string): ParsedBridgeRequest {
  const url = findHttpUrl(rawCommand);
  if (!url) throw new Error("curl URL is required");
  const parsed = parseCurlCommand(rawCommand, url.origin);
  return fromUrl(parsed.method, parsed.url, parsed.headers, parsed.body);
}

function parsePowerShellBridgeCommand(rawCommand: string): ParsedBridgeRequest {
  const command = flattenPowerShellContinuations(rawCommand).trim();
  const withoutQuotes = command.replace(/'[^']*'|"[^"\\]*(?:\\.[^"\\]*)*"/g, "");
  if (/[;&]/.test(withoutQuotes)) {
    throw new Error("PowerShell command chaining is not allowed");
  }
  const tokens = tokenizePowerShell(command);
  if (tokens.shift()?.toLowerCase() !== "invoke-restmethod") {
    throw new Error("PowerShell bridge command must start with Invoke-RestMethod");
  }
  let method = "GET";
  let target = "";
  let data: string | undefined;
  const headers: Record<string, string> = {};
  while (tokens.length > 0) {
    const token = tokens.shift()!;
    const flag = token.toLowerCase();
    if (flag === "-uri" || flag === "-url") {
      target = requireToken(tokens, token);
    } else if (flag === "-method") {
      method = requireToken(tokens, token).toUpperCase();
    } else if (flag === "-contenttype") {
      headers["content-type"] = requireToken(tokens, token);
    } else if (flag === "-headers") {
      Object.assign(headers, parsePowerShellHashtable(requireToken(tokens, token)));
    } else if (flag === "-body") {
      data = requireToken(tokens, token);
    } else if (flag.startsWith("-")) {
      throw new Error(`unsupported PowerShell option ${token}`);
    } else {
      throw new Error(`unexpected PowerShell argument ${token}`);
    }
  }
  if (method !== "POST") throw new Error("only POST bridge intents are allowed");
  if (!target) throw new Error("Invoke-RestMethod -Uri is required");
  if (data === undefined) throw new Error("Invoke-RestMethod -Body is required");
  return fromUrl("POST", target, headers, parsePowerShellBody(data));
}

function fromUrl(
  method: string,
  rawUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): ParsedBridgeRequest {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("bridge URL is not absolute");
  }
  if (!(url.pathname in TOOL_PROMPT_ENDPOINTS)) {
    throw new Error(`curl endpoint ${url.pathname} is not allowed`);
  }
  if (method.toUpperCase() !== "POST") throw new Error("only POST curl intents are allowed");
  return {
    method: "POST",
    url: url.toString(),
    pathname: url.pathname,
    headers: normalizeHeaderNames(headers),
    body,
  };
}

function toAttempt(parsed: ParsedBridgeRequest, rawCommand: string): TdaiAttempt {
  const mapped = TOOL_PROMPT_ENDPOINTS[parsed.pathname];
  if (!mapped) {
    return malformed(`curl endpoint ${parsed.pathname} is not allowed`, rawCommand);
  }
  return {
    tool: mapped.tool,
    family: mapped.family as EvalFamily,
    endpoint: parsed.pathname,
    method: "POST",
    body: parsed.body,
    headers: parsed.headers,
  };
}

function malformed(reason: string, _rawCommand: string): TdaiAttempt {
  return {
    tool: "unknown",
    family: "memory",
    endpoint: "",
    method: "POST",
    malformedReason: reason,
  };
}

function isPowerShellCommand(command: string): boolean {
  return /invoke-restmethod/i.test(command);
}

function canonicalizeCurlExecutable(command: string): string {
  return command.replace(/^\s*curl\.exe\b/i, "curl");
}

function flattenPowerShellContinuations(command: string): string {
  return command.replace(/`\r?\n/g, " ");
}

function findHttpUrl(command: string): URL | null {
  const match = command.match(/https?:\/\/[^\s"'\\]+/i);
  if (!match) return null;
  try {
    return new URL(match[0]);
  } catch {
    return null;
  }
}

function normalizeHeaderNames(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function requireToken(tokens: string[], option: string): string {
  const value = tokens.shift();
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function tokenizePowerShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let depth = 0;
  const push = (): void => {
    if (current.length > 0) tokens.push(current);
    current = "";
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "`" && index + 1 < command.length) current += command[++index];
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "{" || char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === "}" || char === ")") {
      if (depth === 0) throw new Error("unbalanced PowerShell grouping");
      depth -= 1;
      current += char;
      continue;
    }
    if (depth === 0 && /\s/.test(char)) {
      push();
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("unterminated PowerShell quote");
  if (depth !== 0) throw new Error("unbalanced PowerShell grouping");
  push();
  return tokens;
}

function parsePowerShellBody(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("$") && !trimmed.includes("ConvertTo-Json")) {
    throw new Error("PowerShell -Body variable is not inlined");
  }
  const converted = trimmed.match(/^\(?\s*(@?\{[\s\S]*\})\s*\|\s*ConvertTo-Json\s*\)?$/i);
  if (converted) return parsePowerShellHashtable(converted[1]!);
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return parseJsonObject(trimmed);
    } catch {
      return parsePowerShellHashtable(trimmed);
    }
  }
  return parseJsonObject(trimmed);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("curl body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === "curl body must be a JSON object") throw error;
    throw new Error("curl body must be valid JSON");
  }
}

function parsePowerShellHashtable(raw: string): Record<string, string | unknown> {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("@") && !(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    throw new Error("PowerShell hashtable is required");
  }
  const inner = trimmed.startsWith("@")
    ? unwrapWrapping(trimmed.slice(1), "{", "}")
    : unwrapWrapping(trimmed, "{", "}");
  const entries: Record<string, unknown> = {};
  for (const item of splitHashtableEntries(inner)) {
    const match = item.match(/^(?:([A-Za-z_][\w-]*)|'([^']*)'|"([^"]*)")\s*=\s*([\s\S]+)$/);
    if (!match) throw new Error("PowerShell hashtable entry is malformed");
    const key = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!key) throw new Error("PowerShell hashtable key is empty");
    entries[key.toLowerCase()] = parseHashtableValue(match[4]!.trim());
  }
  return entries;
}

function parseHashtableValue(raw: string): unknown {
  if (raw === "$true") return true;
  if (raw === "$false") return false;
  if (raw === "$null") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith("@{") || raw.startsWith("{")) return parsePowerShellHashtable(raw);
  return raw;
}

function splitHashtableEntries(inner: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let depth = 0;
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index]!;
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "{" || char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === "}" || char === ")") {
      depth -= 1;
      current += char;
      continue;
    }
    if (depth === 0 && (char === ";" || char === ",")) {
      if (current.trim()) entries.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}

function unwrapWrapping(value: string, open: string, close: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) {
    throw new Error("PowerShell grouping is malformed");
  }
  return trimmed.slice(open.length, -close.length);
}
