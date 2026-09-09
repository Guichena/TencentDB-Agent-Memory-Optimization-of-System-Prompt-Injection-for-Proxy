import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProviderUsage, PROVIDER_USAGE_FIELDS, type ProviderUsageField } from "./measurement-v2/provider-usage.js";
import type { TdaiAttempt } from "./evaluator.js";
import type { ClaudeLifecycleInspection } from "./claude-code-event-parser.js";

export interface ClaudeCodeReceiptIdentity {
  spaceId: string;
  sessionId: string;
  teamId: string;
  agentId: string;
  taskId?: string;
}

export const CLAUDE_CODE_RECEIPT_SCHEMA = "task1.claude-code-execution-receipt.v1" as const;
export const CLAUDE_CODE_RECEIPT_FILE = "claude-code-receipt.json";

export type ClaudeCodeUsageFieldState = "reported" | "derived" | "unavailable" | "unsupported";

export interface ClaudeCodeUsageFieldRecord {
  state: ClaudeCodeUsageFieldState;
  value: number | null;
  source: "claude-cli-jsonl" | "proxy-provider-trace" | "unavailable";
  reason?: string;
}

export interface ClaudeCodeReceiptLifecycle extends ClaudeLifecycleInspection {
  exitCode: number | null;
  timedOut: boolean;
  stoppedByEvaluation: boolean;
  evaluationStopReason?: string;
  infrastructureError: string | null;
}

export interface ClaudeCodeReceipt {
  schemaVersion: typeof CLAUDE_CODE_RECEIPT_SCHEMA;
  runner: "claude-code";
  agent: "claude-code";
  caseId: string;
  model: string;
  proxy: string;
  workspace: string;
  identity: ClaudeCodeReceiptIdentity;
  lifecycle: ClaudeCodeReceiptLifecycle;
  toolEvents: TdaiAttempt[];
  usage: {
    source: "claude-cli-jsonl" | "proxy-provider-trace" | "mixed" | "unavailable";
    reason?: string;
    fields: Record<string, ClaudeCodeUsageFieldRecord>;
  };
  rawOutputPaths: {
    events: string;
    stderr: string;
    captureStatus: string;
    proxyTrace?: string;
  };
  reproductionCommand: string;
}

export interface BuildClaudeCodeReceiptInput {
  caseId: string;
  model: string;
  proxy: string;
  workspace: string;
  identity: ClaudeCodeReceiptIdentity;
  lifecycle: ClaudeCodeReceiptLifecycle;
  toolEvents: TdaiAttempt[];
  usage: ClaudeCodeReceipt["usage"];
  rawOutputPaths: ClaudeCodeReceipt["rawOutputPaths"];
  reproductionCommand: string;
}

export function buildClaudeCodeReceipt(input: BuildClaudeCodeReceiptInput): ClaudeCodeReceipt {
  return {
    schemaVersion: CLAUDE_CODE_RECEIPT_SCHEMA,
    runner: "claude-code",
    agent: "claude-code",
    caseId: input.caseId,
    model: input.model,
    proxy: input.proxy,
    workspace: input.workspace,
    identity: {
      spaceId: input.identity.spaceId,
      sessionId: input.identity.sessionId,
      teamId: input.identity.teamId,
      agentId: input.identity.agentId,
      ...(input.identity.taskId ? { taskId: input.identity.taskId } : {}),
    },
    lifecycle: input.lifecycle,
    toolEvents: input.toolEvents,
    usage: input.usage,
    rawOutputPaths: input.rawOutputPaths,
    reproductionCommand: input.reproductionCommand,
  };
}

export function mergeClaudeUsageSources(input: {
  cliUsage: Record<string, unknown> | null;
  proxyUsage: unknown;
}): ClaudeCodeReceipt["usage"] {
  const cliFields = fieldsFromCli(input.cliUsage);
  const proxyFields = fieldsFromProxy(input.proxyUsage);
  const fields: Record<string, ClaudeCodeUsageFieldRecord> = {};
  let usedCli = false;
  let usedProxy = false;
  for (const name of PROVIDER_USAGE_FIELDS) {
    const cli = cliFields[name];
    const proxy = proxyFields[name];
    if (cli?.state === "reported" || cli?.state === "derived") {
      fields[name] = cli;
      usedCli = true;
      continue;
    }
    if (proxy?.state === "reported" || proxy?.state === "derived") {
      fields[name] = proxy;
      usedProxy = true;
      continue;
    }
    if (name === "reasoningOrThinkingTokens") {
      fields[name] = {
        state: "unsupported",
        value: null,
        source: "unavailable",
        reason: "Claude CLI and Proxy provider trace did not report reasoning or thinking tokens",
      };
      continue;
    }
    fields[name] = {
      state: "unavailable",
      value: null,
      source: "unavailable",
      reason: cli?.reason ?? proxy?.reason ?? "usage field was not reported",
    };
  }
  const source = usedCli && usedProxy ? "mixed" : usedCli ? "claude-cli-jsonl" : usedProxy ? "proxy-provider-trace" : "unavailable";
  return {
    source,
    ...(source === "unavailable" ? { reason: "Claude CLI JSONL and Proxy provider trace did not contain usable usage" } : {}),
    fields,
  };
}

export function writeClaudeCodeReceipt(directory: string, receipt: ClaudeCodeReceipt): string {
  const path = join(directory, CLAUDE_CODE_RECEIPT_FILE);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}

function fieldsFromCli(usage: Record<string, unknown> | null): Record<string, ClaudeCodeUsageFieldRecord> {
  const mapping: Record<ProviderUsageField, string[]> = {
    ordinaryInputTokens: ["input_tokens", "ordinaryInputTokens"],
    cacheReadInputTokens: ["cache_read_input_tokens", "cacheReadInputTokens"],
    cacheWriteInputTokens: ["cache_creation_input_tokens", "cacheWriteInputTokens"],
    outputTokens: ["output_tokens", "outputTokens"],
    providerTotalInputTokens: ["providerTotalInputTokens"],
    reasoningOrThinkingTokens: ["reasoningOrThinkingTokens"],
  };
  const fields = Object.fromEntries(PROVIDER_USAGE_FIELDS.map((name) => {
    const key = usage ? mapping[name].find((candidate) => isNonNegativeInteger(usage[candidate])) : undefined;
    if (key && usage) {
      return [name, {
        state: "reported" as const,
        value: usage[key] as number,
        source: "claude-cli-jsonl" as const,
      }];
    }
    return [name, {
      state: "unavailable" as const,
      value: null,
      source: "unavailable" as const,
      reason: "Claude CLI JSONL did not contain this usage field",
    }];
  })) as Record<string, ClaudeCodeUsageFieldRecord>;
  const ordinary = fields.ordinaryInputTokens?.value;
  const read = fields.cacheReadInputTokens?.value;
  const write = fields.cacheWriteInputTokens?.value;
  if (
    fields.providerTotalInputTokens?.state !== "reported"
    && ordinary !== null && ordinary !== undefined
    && read !== null && read !== undefined
    && write !== null && write !== undefined
  ) {
    fields.providerTotalInputTokens = {
      state: "derived",
      value: ordinary + read + write,
      source: "claude-cli-jsonl",
    };
  }
  return fields;
}

function fieldsFromProxy(rawUsage: unknown): Record<string, ClaudeCodeUsageFieldRecord> {
  if (rawUsage === undefined || rawUsage === null) {
    return Object.fromEntries(PROVIDER_USAGE_FIELDS.map((name) => [name, {
      state: "unavailable" as const,
      value: null,
      source: "unavailable" as const,
      reason: "Proxy provider trace usage was not supplied",
    }]));
  }
  const normalized = normalizeProviderUsage({
    provider: "anthropic",
    schema: "anthropic.messages",
    apiVersion: "messages",
    adapterVersion: "claude-code-eval-adapter",
    requiredFields: ["ordinaryInputTokens", "outputTokens"],
    unsupportedFields: ["reasoningOrThinkingTokens"],
    rawUsage,
  });
  return Object.fromEntries(PROVIDER_USAGE_FIELDS.map((name) => {
    const state = normalized.fieldStates[name];
    if ((state === "reported" || state === "derived") && normalized.usage) {
      return [name, {
        state,
        value: normalized.usage[name],
        source: "proxy-provider-trace" as const,
      }];
    }
    if (state === "unsupported") {
      return [name, {
        state: "unsupported" as const,
        value: null,
        source: "proxy-provider-trace" as const,
        reason: "Proxy Anthropic usage contract does not report this field",
      }];
    }
    return [name, {
      state: "unavailable" as const,
      value: null,
      source: "unavailable" as const,
      reason: `Proxy provider trace marked ${name} as ${state}`,
    }];
  }));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
