import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { CodexProcessExecutionInput, CodexProcessExecutionResult } from "./codex-runner.js";
import { inspectClaudeLifecycle } from "./claude-code-event-parser.js";

export const CLAUDE_CODE_EVENTS_FILE = "claude-code-events.jsonl";
export const CLAUDE_CODE_STDERR_FILE = "claude-code-stderr.log";
export const CLAUDE_CODE_CAPTURE_STATUS_FILE = "capture-status.json";

export async function executeClaudeWithRawCapture(
  input: CodexProcessExecutionInput,
  directory: string,
  execute: (input: CodexProcessExecutionInput) => Promise<CodexProcessExecutionResult>,
): Promise<CodexProcessExecutionResult> {
  const stdoutFd = openSync(join(directory, CLAUDE_CODE_EVENTS_FILE), "wx");
  let stderrFd: number | undefined;
  let statusFd: number | undefined;
  const captured = { stdout: "", stderr: "" };
  let active = true;
  try {
    stderrFd = openSync(join(directory, CLAUDE_CODE_STDERR_FILE), "wx");
    statusFd = openSync(join(directory, CLAUDE_CODE_CAPTURE_STATUS_FILE), "wx");
    const append = (stream: "stdout" | "stderr", chunk: string): void => {
      if (!active) throw new Error("Claude Code output arrived after executor completion");
      const bytes = Buffer.from(chunk, "utf8");
      const fd = stream === "stdout" ? stdoutFd : stderrFd!;
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written === 0) throw new Error("Claude Code raw output write made no progress");
        offset += written;
      }
      captured[stream] += chunk;
    };
    const result = await execute({
      ...input,
      onOutput: (stream, chunk) => {
        append(stream, chunk);
        input.onOutput?.(stream, chunk);
      },
    });
    for (const stream of ["stdout", "stderr"] as const) {
      if (captured[stream].length === 0) append(stream, result[stream]);
      if (captured[stream] !== result[stream]) {
        throw new Error(`Claude Code ${stream} capture mismatch`);
      }
    }
    writeSync(statusFd, `${JSON.stringify({
      schemaVersion: "task1.claude-code-raw-capture/v1",
      status: "captured",
      stdoutBytes: Buffer.byteLength(captured.stdout),
      stderrBytes: Buffer.byteLength(captured.stderr),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      lifecycle: inspectClaudeLifecycle(result.stdout),
    })}\n`);
    return result;
  } catch (error) {
    if (statusFd !== undefined) {
      try {
        writeSync(statusFd, `${JSON.stringify({
          schemaVersion: "task1.claude-code-raw-capture/v1",
          status: "failed",
          stdoutBytes: Buffer.byteLength(captured.stdout),
          stderrBytes: Buffer.byteLength(captured.stderr),
        })}\n`);
      } catch { /* Preserve the original capture failure. */ }
    }
    throw error;
  } finally {
    active = false;
    closeSync(stdoutFd);
    if (stderrFd !== undefined) closeSync(stderrFd);
    if (statusFd !== undefined) closeSync(statusFd);
  }
}
