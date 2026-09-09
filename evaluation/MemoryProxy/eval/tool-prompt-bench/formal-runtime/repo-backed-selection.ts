import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FormalReadText } from "./provider-loader.js";

export const ARCHIVED_NO_WORKSPACE_TEAMS = Object.freeze([
  "T05",
  "T06",
  "T13",
  "T14",
] as const);

const archivedTeams = new Set<string>(ARCHIVED_NO_WORKSPACE_TEAMS);

export const REPO_BACKED_DATASET_REVISION = "formal-v2.1-repo-backed-640" as const;

export const REPO_BACKED_COUNTS = Object.freeze({
  total: 640,
  dev: 320,
  hiddenTest: 320,
} as const);

export const REPO_BACKED_PAIR_COUNTS = Object.freeze({
  total: 240,
  dev: 120,
  hiddenTest: 120,
} as const);

export type RepoBackedFileId =
  | "provider-dev"
  | "provider-hidden"
  | "gold-dev"
  | "gold-hidden"
  | "pairs-dev"
  | "pairs-hidden"
  | "case-bindings";

export interface RepoBackedSelection {
  readonly schemaVersion: "task1.repo-backed-selection.v2";
  readonly activeDataset: "task1-data-formal-v2.1-repo-backed-640";
  readonly counts: {
    readonly cases: typeof REPO_BACKED_COUNTS;
    readonly pairs: typeof REPO_BACKED_PAIR_COUNTS;
  };
  readonly files: Readonly<Record<RepoBackedFileId, {
    readonly active: number;
    readonly activeFileSha256: string;
  }>>;
}

const SHA256 = /^[a-f0-9]{64}$/u;

export function loadRepoBackedSelection(input: {
  readonly datasetRoot: string;
  readonly readText?: FormalReadText;
}): RepoBackedSelection {
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const path = resolve(input.datasetRoot, "repo-backed-v2.1", "SELECTION.json");
  const value = JSON.parse(readText(path)) as RepoBackedSelection;
  if (value.schemaVersion !== "task1.repo-backed-selection.v2"
    || value.activeDataset !== "task1-data-formal-v2.1-repo-backed-640") {
    throw new Error("repo-backed selection identity is invalid");
  }
  if (value.counts.cases.total !== REPO_BACKED_COUNTS.total
    || value.counts.cases.dev !== REPO_BACKED_COUNTS.dev
    || value.counts.cases.hiddenTest !== REPO_BACKED_COUNTS.hiddenTest
    || value.counts.pairs.total !== REPO_BACKED_PAIR_COUNTS.total
    || value.counts.pairs.dev !== REPO_BACKED_PAIR_COUNTS.dev
    || value.counts.pairs.hiddenTest !== REPO_BACKED_PAIR_COUNTS.hiddenTest) {
    throw new Error("repo-backed selection counts are invalid");
  }
  for (const [fileId, file] of Object.entries(value.files)) {
    if (!Number.isSafeInteger(file.active) || file.active < 0 || !SHA256.test(file.activeFileSha256)) {
      throw new Error(`repo-backed selection file metadata is invalid: ${fileId}`);
    }
  }
  return Object.freeze(value);
}

export function repoBackedFilePath(
  datasetRoot: string,
  fileId: RepoBackedFileId,
): string {
  const relative: Record<RepoBackedFileId, readonly string[]> = {
    "provider-dev": ["provider", "dev.jsonl"],
    "provider-hidden": ["provider", "hidden.sealed.jsonl"],
    "gold-dev": ["private", "gold", "dev.private.jsonl"],
    "gold-hidden": ["private", "gold", "hidden.private.jsonl"],
    "pairs-dev": ["private", "pairs", "dev.private.jsonl"],
    "pairs-hidden": ["private", "pairs", "hidden.private.jsonl"],
    "case-bindings": ["runtime", "case-bindings.jsonl"],
  };
  return resolve(datasetRoot, "repo-backed-v2.1", ...relative[fileId]);
}

export function isRepoBackedTeam(teamId: string): boolean {
  return !archivedTeams.has(teamId);
}
