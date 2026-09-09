import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const FORMAL_DATA_TAG = "task1-data-formal-v2.1" as const;
export const FORMAL_DATA_TAG_OBJECT = "6dcb766b0d9d831fe06cd45176da4d8d59cd0a78" as const;
export const FORMAL_DATA_COMMIT = "a8ae02e376f07ea7baa6a13f66aa4fb560b95ce6" as const;
export const FORMAL_STATUS_TAG_BLOB = "7a262b13836fd843637e74312ca5b6c9b7e43396" as const;
export const FORMAL_STATUS_FILE_SHA256 = "acd98947d3892047c9479287325bb502a0a892c2710c5e248c86968c0dcf22cc" as const;

const STATUS_REPOSITORY_PATH = "MemoryProxy/eval/tool-prompt-bench/formal-dataset/DATASET-BUILD-STATUS.json";

export interface FormalDataFreeze {
  readonly tag: typeof FORMAL_DATA_TAG;
  readonly tagObject: typeof FORMAL_DATA_TAG_OBJECT;
  readonly commit: typeof FORMAL_DATA_COMMIT;
  readonly objectType: "tag";
  readonly statusTagBlob: typeof FORMAL_STATUS_TAG_BLOB;
  readonly statusFileSha256: typeof FORMAL_STATUS_FILE_SHA256;
  readonly repositoryRoot: string;
  readonly datasetRoot: string;
  readonly formalMetricEligible: false;
}

export interface ResolveFormalDataFreezeInput {
  repositoryRoot: string;
  tag?: string;
}

function git(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitBytes(repositoryRoot: string, args: readonly string[]): Buffer {
  return execFileSync("git", ["-C", repositoryRoot, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function normalizedTextSha256(value: Buffer): string {
  return createHash("sha256")
    .update(value.toString("utf8").replace(/\r\n/gu, "\n"), "utf8")
    .digest("hex");
}

/**
 * Resolve the sole data revision accepted by R02 and fail closed on tag drift.
 * This is the Git identity seam; callers never infer a revision from a branch.
 */
export function resolveFormalDataFreeze(input: ResolveFormalDataFreezeInput): FormalDataFreeze {
  const tag = input.tag ?? FORMAL_DATA_TAG;
  if (tag !== FORMAL_DATA_TAG) {
    throw new Error(`rejected formal data tag: ${tag}`);
  }

  const repositoryRoot = git(input.repositoryRoot, ["rev-parse", "--show-toplevel"]);
  const objectType = git(repositoryRoot, ["cat-file", "-t", tag]);
  if (objectType !== "tag") {
    throw new Error(`${tag}: expected annotated tag object, got ${objectType}`);
  }

  const tagObject = git(repositoryRoot, ["rev-parse", tag]);
  const commit = git(repositoryRoot, ["rev-parse", `${tag}^{commit}`]);
  if (tagObject !== FORMAL_DATA_TAG_OBJECT) {
    throw new Error(`${tag}: tag object drift ${tagObject}`);
  }
  if (commit !== FORMAL_DATA_COMMIT) {
    throw new Error(`${tag}: commit drift ${commit}`);
  }

  const statusTagBlob = git(repositoryRoot, ["rev-parse", `${tag}:${STATUS_REPOSITORY_PATH}`]);
  const statusFileSha256 = normalizedTextSha256(gitBytes(
    repositoryRoot,
    ["show", `${tag}:${STATUS_REPOSITORY_PATH}`],
  ));
  if (statusTagBlob !== FORMAL_STATUS_TAG_BLOB) {
    throw new Error(`${tag}: status blob drift ${statusTagBlob}`);
  }
  if (statusFileSha256 !== FORMAL_STATUS_FILE_SHA256) {
    throw new Error(`${tag}: status file hash drift ${statusFileSha256}`);
  }

  return Object.freeze({
    tag: FORMAL_DATA_TAG,
    tagObject: FORMAL_DATA_TAG_OBJECT,
    commit: FORMAL_DATA_COMMIT,
    objectType: "tag",
    statusTagBlob: FORMAL_STATUS_TAG_BLOB,
    statusFileSha256: FORMAL_STATUS_FILE_SHA256,
    repositoryRoot,
    datasetRoot: resolve(
      repositoryRoot,
      "MemoryProxy/eval/tool-prompt-bench/formal-dataset",
    ),
    formalMetricEligible: false,
  });
}
