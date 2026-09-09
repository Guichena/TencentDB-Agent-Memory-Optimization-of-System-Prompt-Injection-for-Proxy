import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkspaceRef } from "../worlds/formal-schema.js";
import { canonicalSha256, exactUtf8Sha256 } from "./canonical.js";
import type {
  FormalBindingSplit,
  FormalCaseBinding,
  FormalRuntimeIdentitySeed,
} from "./build-case-bindings.js";
import type { FormalDataFreeze } from "./freeze.js";
import type { FormalReadText } from "./provider-loader.js";
import {
  loadRepoBackedSelection,
  repoBackedFilePath,
  REPO_BACKED_COUNTS,
} from "./repo-backed-selection.js";

export interface LoadFormalCaseBindingsInput {
  readonly freeze: FormalDataFreeze;
  readonly split: FormalBindingSplit;
  readonly allowHiddenTest?: true;
  readonly readText?: FormalReadText;
  readonly projection?: "repo-backed-v2.1";
}

export interface FormalCaseBindingSplitData {
  readonly split: FormalBindingSplit;
  readonly count: number;
  readonly totalCount: number;
  readonly rows: readonly FormalCaseBinding[];
  readonly fileSha256: string;
  readonly canonicalSha256: string;
  readonly formalMetricEligible: false;
}

const ROW_KEYS = new Set([
  "caseId",
  "identity",
  "snapshotId",
  "split",
  "visibleAssetSetSha256",
  "workspace",
]);
const IDENTITY_KEYS = new Set([
  "agentId",
  "agentSource",
  "sessionSeed",
  "spaceId",
  "taskId",
  "teamId",
  "userId",
]);
const WORKSPACE_REQUIRED_KEYS = new Set([
  "baseCommit",
  "contentHash",
  "fileManifestSha256",
  "repoSlug",
  "repoUrl",
  "sourceRepoLicense",
  "state",
  "treeSha256",
  "workspaceId",
]);
const WORKSPACE_ALLOWED_KEYS = new Set([...WORKSPACE_REQUIRED_KEYS, "overlayPatchSha256"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unexpected key: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} is missing key: ${key}`);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function hash(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (!SHA256.test(result)) throw new Error(`${label} must be a sha256`);
  return result;
}

function parseIdentity(value: unknown, label: string): FormalRuntimeIdentitySeed {
  const identity = record(value, label);
  exactKeys(identity, IDENTITY_KEYS, IDENTITY_KEYS, label);
  if (identity.agentSource !== "codex") throw new Error(`${label}.agentSource must be codex`);
  const taskId = nonEmpty(identity.taskId, `${label}.taskId`);
  const sessionSeed = nonEmpty(identity.sessionSeed, `${label}.sessionSeed`);
  if (!/^task-[a-f0-9]{32}$/u.test(taskId)) throw new Error(`${label}.taskId must be opaque`);
  if (!/^session-[a-f0-9]{32}$/u.test(sessionSeed)) throw new Error(`${label}.sessionSeed must be opaque`);
  return Object.freeze({
    spaceId: nonEmpty(identity.spaceId, `${label}.spaceId`),
    teamId: nonEmpty(identity.teamId, `${label}.teamId`),
    userId: nonEmpty(identity.userId, `${label}.userId`),
    agentId: nonEmpty(identity.agentId, `${label}.agentId`),
    taskId,
    sessionSeed,
    agentSource: "codex",
  });
}

function parseWorkspace(value: unknown, label: string): WorkspaceRef {
  const workspace = record(value, label);
  exactKeys(workspace, WORKSPACE_ALLOWED_KEYS, WORKSPACE_REQUIRED_KEYS, label);
  const overlay = workspace.overlayPatchSha256 === undefined
    ? {}
    : { overlayPatchSha256: hash(workspace.overlayPatchSha256, `${label}.overlayPatchSha256`) };
  if (workspace.state !== "clean" && workspace.state !== "dirty") {
    throw new Error(`${label}.state must be clean or dirty`);
  }
  const baseCommit = nonEmpty(workspace.baseCommit, `${label}.baseCommit`);
  if (!COMMIT.test(baseCommit)) throw new Error(`${label}.baseCommit must be a git commit`);
  return Object.freeze({
    workspaceId: nonEmpty(workspace.workspaceId, `${label}.workspaceId`),
    repoSlug: nonEmpty(workspace.repoSlug, `${label}.repoSlug`),
    repoUrl: nonEmpty(workspace.repoUrl, `${label}.repoUrl`),
    baseCommit,
    sourceRepoLicense: nonEmpty(workspace.sourceRepoLicense, `${label}.sourceRepoLicense`),
    treeSha256: hash(workspace.treeSha256, `${label}.treeSha256`),
    fileManifestSha256: hash(workspace.fileManifestSha256, `${label}.fileManifestSha256`),
    state: workspace.state,
    ...overlay,
    contentHash: hash(workspace.contentHash, `${label}.contentHash`),
  });
}

function parseBinding(value: unknown, line: number): FormalCaseBinding {
  const label = `case binding row ${line}`;
  const row = record(value, label);
  exactKeys(row, ROW_KEYS, ROW_KEYS, label);
  if (row.split !== "dev" && row.split !== "hidden_test") throw new Error(`${label}.split is invalid`);
  return Object.freeze({
    caseId: nonEmpty(row.caseId, `${label}.caseId`),
    split: row.split,
    identity: parseIdentity(row.identity, `${label}.identity`),
    snapshotId: nonEmpty(row.snapshotId, `${label}.snapshotId`),
    workspace: parseWorkspace(row.workspace, `${label}.workspace`),
    visibleAssetSetSha256: hash(row.visibleAssetSetSha256, `${label}.visibleAssetSetSha256`),
  });
}

/** Runtime-safe loader. It has no import or filesystem path to the private Measurement overlay. */
export function loadFormalCaseBindings(input: LoadFormalCaseBindingsInput): FormalCaseBindingSplitData {
  if (input.split === "hidden_test" && input.allowHiddenTest !== true) {
    throw new Error("hidden_test binding access is not authorized");
  }
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const path = input.projection === "repo-backed-v2.1"
    ? repoBackedFilePath(input.freeze.datasetRoot, "case-bindings")
    : resolve(input.freeze.datasetRoot, "..", "formal-runtime", "frozen", "case-bindings.jsonl");
  const rawText = readText(path);
  const allRows = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return parseBinding(JSON.parse(line) as unknown, index + 1);
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`case binding row ${index + 1} is invalid JSON`, { cause: error });
        throw error;
      }
    });
  const caseIds = allRows.map((row) => row.caseId);
  if (new Set(caseIds).size !== caseIds.length) throw new Error("case bindings contain duplicate caseIds");
  if (JSON.stringify(caseIds) !== JSON.stringify([...caseIds].sort())) {
    throw new Error("case bindings must be sorted by caseId");
  }
  const devCount = allRows.filter((row) => row.split === "dev").length;
  const hiddenCount = allRows.filter((row) => row.split === "hidden_test").length;
  const expected = input.projection === "repo-backed-v2.1"
    ? REPO_BACKED_COUNTS
    : { total: 800, dev: 320, hiddenTest: 480 };
  if (allRows.length !== expected.total || devCount !== expected.dev || hiddenCount !== expected.hiddenTest) {
    throw new Error(
      `case binding counts must be ${expected.total}/${expected.dev}/${expected.hiddenTest}, got ${allRows.length}/${devCount}/${hiddenCount}`,
    );
  }
  const fileSha256 = exactUtf8Sha256(rawText);
  if (input.projection === "repo-backed-v2.1") {
    const selection = loadRepoBackedSelection({ datasetRoot: input.freeze.datasetRoot, readText });
    if (fileSha256 !== selection.files["case-bindings"].activeFileSha256) {
      throw new Error("case-bindings does not match the repo-backed selection");
    }
  }
  const rows = Object.freeze(allRows.filter((row) => row.split === input.split));
  return Object.freeze({
    split: input.split,
    count: rows.length,
    totalCount: expected.total,
    rows,
    fileSha256,
    canonicalSha256: canonicalSha256(allRows),
    formalMetricEligible: false as const,
  });
}
