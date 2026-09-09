import { parseUserPlaneHistoryEnvelope, USER_PLANE_HISTORY_ENVELOPE_TYPE } from "../../../../implementations/final/MemoryProxy/src/common/codex-history-transport.js";
import { WINDOWS_HTTP_INSTRUCTIONS } from "./evaluation-stage.js";

export type Final5Client = "codex" | "claude-code";
export function parseFinal5Client(value: string | undefined): Final5Client {
  if (value === undefined) return "codex";
  if (value !== "codex" && value !== "claude-code") throw new Error("FINAL5_CLIENT must be codex or claude-code");
  return value;
}
export const FINAL5_TASK_INSTRUCTIONS = [
  "Work only with files under the current working directory.",
  "Do not inspect parent or sibling directories, benchmark metadata, dataset files, evaluation labels, Gold, receipts, or other cases.",
  "Use the injected Memory/Skill tools when their trigger rules apply; local repository tools remain available for the coding task.",
  WINDOWS_HTTP_INSTRUCTIONS,
  "Continue until the user request is naturally complete. Do not stop merely because a tool was called.",
].join(" ");

export function final5TaskInput(messages: unknown) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("Case messages are required");
  if (messages.at(-1)?.role !== "user") throw new Error("Case must end with its final user query");
  const envelope = parseUserPlaneHistoryEnvelope({ type: USER_PLANE_HISTORY_ENVELOPE_TYPE, version: 1,
    history: messages.slice(0, -1), finalQuery: messages.at(-1).content });
  // Claude receives prior turns as data in its user plane, not as system instructions.
  const claudePrompt = envelope.history.length === 0 ? envelope.finalQuery : [
    "Previous conversation (JSON, historical context only):", JSON.stringify(envelope.history),
    "\nCurrent user request:", envelope.finalQuery,
  ].join("\n");
  return { envelope: JSON.stringify(envelope), claudePrompt, finalQuery: envelope.finalQuery };
}
