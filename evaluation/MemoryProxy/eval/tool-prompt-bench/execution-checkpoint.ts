import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class EvaluationExecutionError extends Error {
  constructor(message: string, readonly evidence?: unknown) { super(message); }
}
export class RetryableEvaluationError extends EvaluationExecutionError {}

export function executionHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
    return item;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export interface RecordedAttempt {
  evidenceDirectory?: string;
  attempt: number;
  status: "completed" | "failed";
  startedAt: string;
  durationMs: number;
  retryable: boolean;
  trace?: unknown;
  error?: string;
}

export interface RecordedResult { attempts: RecordedAttempt[]; resumed: boolean; }

/** One lock per client/stage; immutable completed attempts survive a runner crash. */
export async function withExecutionCheckpoint<T>(options: {
  directory: string;
  config: unknown;
  resume: boolean;
  maxRetries: number;
}, run: (execute: (key: unknown, fn: (attempt: number) => Promise<unknown>) => Promise<RecordedResult>) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 5) throw new Error("Retry budget must be an integer from 0 to 5");
  mkdirSync(options.directory, { recursive: true });
  const lock = join(options.directory, "runner.lock");
  const token = randomUUID();
  if (existsSync(lock) && options.resume) {
    const previous = JSON.parse(readFileSync(lock, "utf8")) as { pid: number };
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error("Invalid checkpoint lock");
    try { process.kill(previous.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(lock);
      else throw error;
    }
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
  try {
    const metadataPath = join(options.directory, "config.json");
    const configHash = executionHash({ config: options.config, maxRetries: options.maxRetries });
    if (existsSync(metadataPath)) {
      if (!options.resume) throw new Error("Checkpoint exists; pass resume explicitly");
      if (JSON.parse(readFileSync(metadataPath, "utf8")).configHash !== configHash) throw new Error("Checkpoint configuration changed; use a new output directory");
    } else {
      writeFileSync(metadataPath, JSON.stringify({ schemaVersion: 1, configHash }), { flag: "wx" });
    }
    return await run(async (key, fn) => {
      const path = join(options.directory, executionHash(key) + ".json");
      const saved = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
      if (saved && (executionHash(saved.key) !== executionHash(key) || saved.configHash !== configHash || executionHash(saved.attempts) !== saved.attemptsHash)) throw new Error("Checkpoint evidence mismatch");
      const attempts: RecordedAttempt[] = saved?.attempts ?? [];
      const resumed = attempts.length > 0;
      if (!Array.isArray(attempts) || attempts.some((a, i) => a.attempt !== i || !["completed", "failed"].includes(a.status))) throw new Error("Invalid checkpoint attempts");
      while (attempts.length <= options.maxRetries) {
        const last = attempts.at(-1);
        if (last && (last.status === "completed" || !last.retryable)) break;
        if (last?.retryable) {
          const jitterMs = Number.parseInt(executionHash(key).slice(0, 4), 16) % 2000;
          await new Promise((resolve) => setTimeout(resolve, attempts.length * 1000 + jitterMs));
        }
        const startedAt = new Date().toISOString();
        const start = performance.now();
        let result: RecordedAttempt;
        try {
          const trace = await fn(attempts.length);
          result = { attempt: attempts.length, status: "completed", startedAt, durationMs: performance.now() - start, retryable: false, trace };
        } catch (error) {
          result = { attempt: attempts.length, status: "failed", startedAt, durationMs: performance.now() - start, retryable: error instanceof RetryableEvaluationError, error: String(error), ...(error instanceof EvaluationExecutionError ? { trace: error.evidence } : {}) };
        }
        attempts.push(result);
        const temporary = path + "." + token + ".tmp";
        writeFileSync(temporary, JSON.stringify({ key, configHash, attempts, attemptsHash: executionHash(attempts) }), { flag: "wx" });
        renameSync(temporary, path);
      }
      return { attempts, resumed };
    });
  } finally {
    if (existsSync(lock) && JSON.parse(readFileSync(lock, "utf8")).token === token) unlinkSync(lock);
  }
}
