import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PinnedFormalExecutionPreflightReceipt } from "./formal-execution-preflight.js";
import {
  executePreparedFormalRun,
  FORMAL_PROMPT_FREEZE_COMMIT,
  FORMAL_PROMPT_FREEZE_TAG,
  FORMAL_PROMPT_FREEZE_TAG_OBJECT,
  type FormalCodeFreezeReceipt,
} from "./formal-execution-runner.js";
import type { PreparedFormalRun } from "./formal-prepare-runner.js";

export interface FormalExecutionCliOptions {
  readonly runDirectory: string;
  readonly preflightReceiptPath: string;
  readonly knowledgeHealthUrl: string;
  readonly expectedKnowledgeInstanceId: string;
  readonly repositoryRoot: string;
  readonly timeoutMs?: number;
}

export interface GitCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<GitCommandResult>;

export function parseFormalExecutionCliArguments(
  argv: readonly string[],
): FormalExecutionCliOptions {
  const supported = new Set([
    "--run-dir",
    "--preflight-receipt",
    "--knowledge-health-url",
    "--knowledge-instance-id",
    "--repo-root",
    "--timeout-ms",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!supported.has(flag)) throw new Error(`unsupported formal execution argument: ${flag}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (values.has(flag)) throw new Error(`duplicate formal execution argument: ${flag}`);
    values.set(flag, value);
  }
  const timeoutRaw = values.get("--timeout-ms");
  const timeoutMs = timeoutRaw === undefined ? undefined : Number(timeoutRaw);
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  return {
    runDirectory: resolve(required(values, "--run-dir")),
    preflightReceiptPath: resolve(required(values, "--preflight-receipt")),
    knowledgeHealthUrl: absoluteHttpUrl(
      "--knowledge-health-url",
      required(values, "--knowledge-health-url"),
    ),
    expectedKnowledgeInstanceId: required(values, "--knowledge-instance-id"),
    repositoryRoot: resolve(required(values, "--repo-root")),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export async function loadPreparedFormalRunDirectory(
  directory: string,
): Promise<PreparedFormalRun> {
  const resolved = resolve(directory);
  const [manifest, command] = await Promise.all([
    readJson(resolve(resolved, "run-manifest.json"), "run manifest"),
    readJson(resolve(resolved, "prepare-command.json"), "prepare command"),
  ]);
  if (record(manifest, "run manifest").schemaVersion !== "task1.formal-prepare-run-manifest.v1") {
    throw new Error("run manifest schemaVersion mismatch");
  }
  if (record(command, "prepare command").schemaVersion !== "task1.formal-prepare-command.v1") {
    throw new Error("prepare command schemaVersion mismatch");
  }
  return Object.freeze({
    directory: resolved,
    manifest,
    command,
  } as unknown as PreparedFormalRun);
}

export async function inspectFormalCodeFreeze(
  repositoryRoot: string,
  run: PreparedFormalRun,
  runGit: GitCommandRunner = runGitCommand,
): Promise<FormalCodeFreezeReceipt> {
  const cwd = resolve(repositoryRoot);
  const headResult = await runGit(["rev-parse", "HEAD"], cwd);
  if (headResult.exitCode !== 0) {
    throw new Error(`unable to resolve execution HEAD: ${headResult.stderr.trim()}`);
  }
  const executionCodeCommit = headResult.stdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(executionCodeCommit)) {
    throw new Error("execution HEAD is not a 40-character Git commit");
  }
  const statusResult = await runGit(["status", "--porcelain=v1"], cwd);
  if (statusResult.exitCode !== 0) {
    throw new Error(`unable to inspect execution worktree: ${statusResult.stderr.trim()}`);
  }
  if (statusResult.stdout.trim()) {
    throw new Error("formal execution worktree is not clean");
  }
  const promptFreezeCommit = run.manifest.prompt_freeze_commit;
  const promptTagTypeResult = await runGit([
    "cat-file",
    "-t",
    `refs/tags/${FORMAL_PROMPT_FREEZE_TAG}`,
  ], cwd);
  if (promptTagTypeResult.exitCode !== 0 || promptTagTypeResult.stdout.trim() !== "tag") {
    throw new Error(`${FORMAL_PROMPT_FREEZE_TAG}: expected annotated tag object`);
  }
  const promptTagObjectResult = await runGit([
    "rev-parse",
    `refs/tags/${FORMAL_PROMPT_FREEZE_TAG}`,
  ], cwd);
  if (promptTagObjectResult.exitCode !== 0) {
    throw new Error(`unable to resolve ${FORMAL_PROMPT_FREEZE_TAG} tag object: ${promptTagObjectResult.stderr.trim()}`);
  }
  const promptTagObject = promptTagObjectResult.stdout.trim().toLowerCase();
  if (promptTagObject !== FORMAL_PROMPT_FREEZE_TAG_OBJECT) {
    throw new Error(`Prompt freeze tag object drift: ${promptTagObject}`);
  }
  const frozenPromptResult = await runGit([
    "rev-parse",
    `${FORMAL_PROMPT_FREEZE_TAG}^{commit}`,
  ], cwd);
  if (frozenPromptResult.exitCode !== 0) {
    throw new Error(`unable to resolve ${FORMAL_PROMPT_FREEZE_TAG}: ${frozenPromptResult.stderr.trim()}`);
  }
  const frozenPromptCommit = frozenPromptResult.stdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(frozenPromptCommit)) {
    throw new Error(`${FORMAL_PROMPT_FREEZE_TAG} does not resolve to a 40-character Git commit`);
  }
  if (frozenPromptCommit !== FORMAL_PROMPT_FREEZE_COMMIT) {
    throw new Error(`Prompt freeze commit drift: ${frozenPromptCommit}`);
  }
  if (promptFreezeCommit !== frozenPromptCommit) {
    throw new Error(`prepared run does not use ${FORMAL_PROMPT_FREEZE_TAG}`);
  }
  const ancestorResult = await runGit([
    "merge-base",
    "--is-ancestor",
    promptFreezeCommit,
    executionCodeCommit,
  ], cwd);
  if (ancestorResult.exitCode !== 0 && ancestorResult.exitCode !== 1) {
    throw new Error(`unable to verify prompt freeze ancestry: ${ancestorResult.stderr.trim()}`);
  }
  return Object.freeze({
    executionCodeCommit,
    promptFreezeTagObject: FORMAL_PROMPT_FREEZE_TAG_OBJECT,
    promptFreezeCommit,
    promptFreezeIsAncestor: ancestorResult.exitCode === 0,
    workingTreeClean: true as const,
  });
}

export async function runFormalExecutionCli(
  options: FormalExecutionCliOptions,
): Promise<void> {
  const run = await loadPreparedFormalRunDirectory(options.runDirectory);
  const preflightReceipt = await readJson(
    options.preflightReceiptPath,
    "formal execution preflight receipt",
  ) as unknown as PinnedFormalExecutionPreflightReceipt;
  const codeFreeze = await inspectFormalCodeFreeze(options.repositoryRoot, run);
  const receipt = await executePreparedFormalRun({
    run,
    environmentSource: process.env,
    preflightReceipt,
    knowledgeHealthUrl: options.knowledgeHealthUrl,
    expectedKnowledgeInstanceId: options.expectedKnowledgeInstanceId,
    codeFreeze,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function runGitCommand(
  args: readonly string[],
  cwd: string,
): Promise<GitCommandResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn("git", [...args], { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveCommand({ exitCode, stdout, stderr }));
  });
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is not readable valid JSON: ${path}`, { cause: error });
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function absoluteHttpUrl(label: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return url.toString().replace(/\/$/u, "");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runFormalExecutionCli(parseFormalExecutionCliArguments(process.argv.slice(2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
