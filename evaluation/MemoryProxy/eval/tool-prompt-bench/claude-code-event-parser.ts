export interface ParsedClaudeJsonlRecord {
  lineNumber: number;
  raw: string;
  event: Record<string, unknown> | null;
  parseError?: string;
}

export type ClaudeLifecycleEventKind =
  | "assistant"
  | "tool"
  | "command"
  | "result"
  | "usage"
  | "error"
  | "termination"
  | "other";

export interface ClaudeCommandObservation {
  lineNumber: number;
  toolName: string;
  command: string;
}

export interface ClaudeLifecycleInspection {
  eventCount: number;
  malformedLines: number[];
  assistantEvents: number;
  toolEvents: number;
  commandEvents: number;
  resultEvents: number;
  errorEvents: number;
  lastEventType: string | null;
  completed: boolean;
  failed: boolean;
}

export function parseClaudeJsonlEvents(eventsJsonl: string): ParsedClaudeJsonlRecord[] {
  const records: ParsedClaudeJsonlRecord[] = [];
  eventsJsonl.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        records.push({
          lineNumber: index + 1,
          raw,
          event: null,
          parseError: "Claude JSONL event must be an object",
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

export function classifyClaudeEvent(event: Record<string, unknown> | null): ClaudeLifecycleEventKind {
  if (!event) return "other";
  const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
  if (type === "error" || event.is_error === true) return "error";
  if (type === "result") return "result";
  if (type === "assistant") return "assistant";
  if (type === "tool_use" || type === "tool" || type === "tool_progress") return "tool";
  if (type === "command" || type === "command_execution" || type === "bash" || type === "shell") return "command";
  if (type === "usage") return "usage";
  if (type === "system" && event.subtype === "init") return "other";
  if (extractCommandTexts(event).length > 0) return "command";
  return "other";
}

export function inspectClaudeLifecycle(stdout: string): ClaudeLifecycleInspection {
  const records = parseClaudeJsonlEvents(stdout);
  const malformedLines = records.filter((row) => row.event === null).map((row) => row.lineNumber);
  let assistantEvents = 0;
  let toolEvents = 0;
  let commandEvents = 0;
  let resultEvents = 0;
  let errorEvents = 0;
  for (const record of records) {
    const kind = classifyClaudeEvent(record.event);
    if (kind === "assistant") assistantEvents += 1;
    if (kind === "tool") toolEvents += 1;
    if (kind === "command") commandEvents += 1;
    if (kind === "result") resultEvents += 1;
    if (kind === "error") errorEvents += 1;
  }
  const last = records.at(-1)?.event ?? null;
  const lastEventType = typeof last?.type === "string" ? last.type : null;
  const lastFailed = last !== null && (
    last.type === "error"
    || last.is_error === true
    || (last.type === "result" && (last.subtype === "error" || last.is_error === true))
  );
  const lastResultOk = last?.type === "result"
    && last.is_error !== true
    && last.subtype !== "error";
  return {
    eventCount: records.length,
    malformedLines,
    assistantEvents,
    toolEvents,
    commandEvents,
    resultEvents,
    errorEvents,
    lastEventType,
    completed: malformedLines.length === 0 && lastResultOk === true && resultEvents >= 1,
    failed: lastFailed === true,
  };
}

export function extractClaudeCommandObservations(eventsJsonl: string): ClaudeCommandObservation[] {
  const observations: ClaudeCommandObservation[] = [];
  for (const record of parseClaudeJsonlEvents(eventsJsonl)) {
    if (!record.event) continue;
    const commands = extractCommandTexts(record.event);
    if (commands.length === 0) continue;
    const toolName = extractToolName(record.event) ?? "unknown";
    for (const command of commands) {
      observations.push({
        lineNumber: record.lineNumber,
        toolName,
        command,
      });
    }
  }
  return observations;
}

export function extractClaudeCliUsage(eventsJsonl: string): Record<string, unknown> | null {
  const records = parseClaudeJsonlEvents(eventsJsonl);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const usage = findUsageRecord(records[index]?.event ?? null);
    if (usage) return usage;
  }
  return null;
}

function findUsageRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.usage && typeof record.usage === "object" && !Array.isArray(record.usage)) {
    return record.usage as Record<string, unknown>;
  }
  for (const key of ["message", "event", "data"]) {
    const nested = findUsageRecord(record[key]);
    if (nested) return nested;
  }
  return null;
}

function extractToolName(event: Record<string, unknown>): string | null {
  if (typeof event.name === "string" && event.name.trim()) return event.name;
  const toolUse = event.tool_use;
  if (toolUse && typeof toolUse === "object" && !Array.isArray(toolUse) && typeof (toolUse as Record<string, unknown>).name === "string") {
    return (toolUse as Record<string, unknown>).name as string;
  }
  const message = event.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        const row = part as Record<string, unknown>;
        if (row.type === "tool_use" && typeof row.name === "string") return row.name;
      }
    }
  }
  return typeof event.type === "string" ? event.type : null;
}

function extractCommandTexts(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (typeof value === "string") return [];
  if (Array.isArray(value)) return value.flatMap((item) => extractCommandTexts(item, depth + 1));
  if (typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const commands: string[] = [];
  for (const key of ["command", "cmd", "shell_command"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) commands.push(candidate);
  }
  const input = record.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    commands.push(...extractCommandTexts(input, depth + 1));
  }
  if (record.message) commands.push(...extractCommandTexts(record.message, depth + 1));
  if (record.content) commands.push(...extractCommandTexts(record.content, depth + 1));
  if (record.tool_use) commands.push(...extractCommandTexts(record.tool_use, depth + 1));
  if (record.item) commands.push(...extractCommandTexts(record.item, depth + 1));
  return commands;
}
