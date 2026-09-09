import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { EvalFixture } from "./schema.js";
import {
  createToolPromptMockBridge,
  TOOL_PROMPT_ENDPOINTS,
  type ToolPromptMockBridge,
} from "./mock-bridge.js";

export interface ParsedCurlCommand {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ProtocolIntentTrace {
  intentId: string;
  runId: string;
  sessionId: string;
  timestamp: string;
  rawCommand: string;
  parsed?: ParsedCurlCommand;
  error?: string;
}

export interface CurlExecutionOptions {
  allowedBaseUrl: string;
  runId: string;
  sessionId: string;
  timeoutMs?: number;
}

export interface CurlExecutionResult {
  intent: ProtocolIntentTrace;
  response?: {
    status: number;
    body: unknown;
  };
}

export interface RunningToolPromptMockServer {
  baseUrl: string;
  bridge: ToolPromptMockBridge;
  close(): Promise<void>;
}

function stripFence(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^```(?:bash|sh|shell)?\s*([\s\S]*?)\s*```$/i);
  return (match?.[1] ?? trimmed).trim();
}

function rejectShellOperators(command: string): void {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === "\\") index++;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "`" || char === ";" || char === "|" || char === "&" || char === ">" || char === "<") {
      throw new Error(`shell operator ${JSON.stringify(char)} is not allowed`);
    }
    if (char === "$" && command[index + 1] === "(") {
      throw new Error("shell operator $(...) is not allowed");
    }
  }
  if (quote) throw new Error("unterminated shell quote");
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  const push = (): void => {
    if (current.length > 0) words.push(current);
    current = "";
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && index + 1 < command.length) current += command[++index];
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\" && (command[index + 1] === "\n" || command[index + 1] === "\r")) {
      if (command[index + 1] === "\r" && command[index + 2] === "\n") index++;
      index++;
    } else if (/\s/.test(char)) {
      push();
    } else {
      current += char;
    }
  }
  push();
  return words;
}

/** Parse the tiny curl subset advertised by the V0 prompt. No shell is invoked. */
export function parseCurlCommand(rawCommand: string, allowedBaseUrl: string): ParsedCurlCommand {
  const command = stripFence(rawCommand);
  rejectShellOperators(command);
  const words = shellWords(command);
  if (words.shift()?.toLowerCase() !== "curl") throw new Error("command must start with curl");

  let method = "GET";
  let target = "";
  let data: string | undefined;
  const headers: Record<string, string> = {};
  const take = (option: string): string => {
    const value = words.shift();
    if (!value) throw new Error(`${option} requires a value`);
    return value;
  };

  while (words.length > 0) {
    const word = words.shift()!;
    if (/^-[sfSk]+$/.test(word)) continue;
    if (word === "-X" || word === "--request") {
      method = take(word).toUpperCase();
    } else if (/^-X.+/.test(word)) {
      method = word.slice(2).toUpperCase();
    } else if (word === "-H" || word === "--header") {
      const header = take(word);
      const colon = header.indexOf(":");
      if (colon <= 0) throw new Error("curl header must contain a name and value");
      headers[header.slice(0, colon).trim().toLowerCase()] = header.slice(colon + 1).trim();
    } else if (["-d", "--data", "--data-raw", "--data-binary"].includes(word)) {
      if (data !== undefined) throw new Error("curl may contain only one JSON body");
      data = take(word);
    } else if (word === "--url") {
      if (target) throw new Error("curl may contain only one URL");
      target = take(word);
    } else if (word.startsWith("-")) {
      throw new Error(`unsupported curl option ${word}`);
    } else if (!target) {
      target = word;
    } else {
      throw new Error(`unexpected curl argument ${word}`);
    }
  }

  if (method !== "POST") throw new Error("only POST curl intents are allowed");
  if (!target) throw new Error("curl URL is required");
  const allowed = new URL(allowedBaseUrl);
  const url = new URL(target);
  if (url.origin !== allowed.origin) throw new Error(`curl origin ${url.origin} is not allowed`);
  if (!(url.pathname in TOOL_PROMPT_ENDPOINTS)) throw new Error(`curl endpoint ${url.pathname} is not allowed`);
  if (data === undefined) throw new Error("curl JSON body is required");

  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    throw new Error("curl body must be valid JSON");
  }
  if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("curl body must be a JSON object");
  return { method: "POST", url: url.toString(), headers, body: body as Record<string, unknown> };
}

export async function executeCurlCommand(
  rawCommand: string,
  options: CurlExecutionOptions,
): Promise<CurlExecutionResult> {
  const intent: ProtocolIntentTrace = {
    intentId: randomUUID(),
    runId: options.runId,
    sessionId: options.sessionId,
    timestamp: new Date().toISOString(),
    rawCommand,
  };
  let parsed: ParsedCurlCommand;
  try {
    parsed = parseCurlCommand(rawCommand, options.allowedBaseUrl);
    intent.parsed = parsed;
  } catch (error) {
    intent.error = error instanceof Error ? error.message : String(error);
    return { intent };
  }

  try {
    const response = await fetch(parsed.url, {
      method: parsed.method,
      headers: {
        ...parsed.headers,
        "x-tdai-eval-intent-id": intent.intentId,
        "x-tdai-eval-run-id": options.runId,
        "x-tdai-eval-session-id": options.sessionId,
      },
      body: JSON.stringify(parsed.body),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* retain text */ }
    return { intent, response: { status: response.status, body } };
  } catch (error) {
    intent.error = error instanceof Error ? error.message : String(error);
    return { intent };
  }
}

export async function startToolPromptMockServer(
  fixture: EvalFixture,
  context: { runId: string; sessionId: string },
): Promise<RunningToolPromptMockServer> {
  const bridge = createToolPromptMockBridge(fixture, context);
  let server: ServerType;
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    try {
      server = serve({ fetch: bridge.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => resolve({ port: info.port }));
      server.once("error", reject);
    } catch (error) {
      reject(error);
    }
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    bridge,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
