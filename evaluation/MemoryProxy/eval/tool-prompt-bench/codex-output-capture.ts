import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { CodexProcessExecutionInput, CodexProcessExecutionResult } from "./codex-runner.js";
import { parseCodexJsonlEvents } from "./codex-runner.js";
import { createActivityTracker } from './attempt-policy.js';

export function inspectCodexLifecycle(stdout: string) {
  const records = parseCodexJsonlEvents(stdout);
  const malformedLines = records.filter((row) => row.event === null).map((row) => row.lineNumber);
  const completedTurns = records.filter((row) => row.event?.type === "turn.completed").length;
  const failedTurns = records.filter((row) => row.event?.type === "turn.failed").length;
  const errorEvents = records.filter((row) => row.event?.type === "error").length;
  const lastEventType = records.at(-1)?.event?.type ?? null;
  return {
    eventCount: records.length, malformedLines, completedTurns, failedTurns, errorEvents,
    completed: malformedLines.length === 0 && completedTurns === 1 && failedTurns === 0
      && lastEventType === "turn.completed",
  };
}

/** Persist raw streams before interpreting events; never replace existing evidence. */
export async function executeWithRawCapture(
  input: CodexProcessExecutionInput,
  directory: string,
  execute: (input: CodexProcessExecutionInput) => Promise<CodexProcessExecutionResult>,
): Promise<CodexProcessExecutionResult> {
  const stdoutFd = openSync(join(directory, "codex-events.jsonl"), "wx");
  let stderrFd: number | undefined;
  let statusFd: number | undefined;
  const captured = { stdout: "", stderr: "" };
  const activity = createActivityTracker('codex');
  let streamed = false;
  const executionStart=performance.now();
  let active = true;
  try {
    stderrFd = openSync(join(directory, "codex-stderr.log"), "wx");
    statusFd = openSync(join(directory, "capture-status.json"), "wx");
    const append = (stream: "stdout" | "stderr", chunk: string): void => {
      if (!active) throw new Error("Codex output arrived after executor completion");
      const bytes = Buffer.from(chunk, "utf8");
      const fd = stream === "stdout" ? stdoutFd : stderrFd!;
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written === 0) throw new Error("Codex raw output write made no progress");
        offset += written;
      }
      captured[stream] += chunk;
    };
    const result = await execute({ ...input, onOutput: (stream, chunk) => {
      append(stream, chunk);
      if(stream==='stdout'){streamed=true;activity.append(chunk);}
      input.onOutput?.(stream, chunk);
    } });
    for (const stream of ["stdout", "stderr"] as const) {
      // Return-only adapters are useful for offline integration, but once a
      // stream is emitted it must agree byte-for-byte with the final result.
      if (captured[stream].length === 0) append(stream, result[stream]);
      if (captured[stream] !== result[stream]) {
        throw new Error(`Codex ${stream} capture mismatch`);
      }
    }
    writeSync(statusFd, JSON.stringify({
      schemaVersion: "task1.raw-capture/v1", status: "captured",
      stdoutBytes: Buffer.byteLength(captured.stdout), stderrBytes: Buffer.byteLength(captured.stderr),
      exitCode: result.exitCode, timedOut: result.timedOut,
      timeoutMs: input.timeoutMs, executionDurationMs: performance.now()-executionStart,
      lifecycle: inspectCodexLifecycle(result.stdout),
      ...(streamed ? {activity:activity.finish()} : {}),
    }) + "\n");
    return result;
  } catch (error) {
    if (statusFd !== undefined) {
      // No exception message: adapters may include secrets in error text.
      // A failed status never promotes surviving partial bytes to a full run.
      try {
        writeSync(statusFd, JSON.stringify({
          schemaVersion: "task1.raw-capture/v1", status: "failed",
          stdoutBytes: Buffer.byteLength(captured.stdout), stderrBytes: Buffer.byteLength(captured.stderr),
        }) + "\n");
      } catch { /* Preserve the original capture failure, including disk-full errors. */ }
    }
    throw error;
  } finally {
    active = false;
    closeSync(stdoutFd);
    if (stderrFd !== undefined) closeSync(stderrFd);
    if (statusFd !== undefined) closeSync(statusFd);
  }
}
