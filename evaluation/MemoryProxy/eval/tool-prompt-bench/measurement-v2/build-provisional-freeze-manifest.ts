import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "./canonical-json.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../../../..");
const DEFAULT_OUTPUT_PATH =
  "MemoryProxy/eval/tool-prompt-bench/measurement-v2/PROVISIONAL-FREEZE-MANIFEST.json";
const SELECTION_CONTRACT_PATH =
  "MemoryProxy/eval/tool-prompt-bench/measurement-v2/SELECTION-CONTRACT.json";

export interface AnnotatedTagIdentity {
  readonly tag: string;
  readonly tagObject: string;
  readonly peeledCommit: string;
}

export const TASK1_CANDIDATE_BASE_TAGS = Object.freeze({
  data: {
    tag: "task1-data-formal-v2.1",
    tagObject: "6dcb766b0d9d831fe06cd45176da4d8d59cd0a78",
    peeledCommit: "a8ae02e376f07ea7baa6a13f66aa4fb560b95ce6",
  },
  prompt: {
    tag: "task1-code-freeze",
    tagObject: "edbf18309fbf100cdf5b26d64c0fbb6f12c8f3a5",
    peeledCommit: "d0996809ed63f6cfc67504ad180db0d48ac70475",
  },
} as const);

export const TASK1_CANDIDATE_BASE_EXECUTION_COHORT = Object.freeze({
  model: "gpt-5.6-luna",
  reasoningEffort: "high",
  verbosity: "medium",
  provider: "openai",
  apiProtocol: "responses-v1",
  adapterVersion: "memory-proxy-provider-observer-v1",
  nodeMajor: 22,
  codexCliVersion: null,
} as const);

export const TASK1_CANDIDATE_BASE_TOKENIZER = Object.freeze({
  id: "o200k_base",
  version: "tiktoken-1.0.22",
} as const);

// Updated only when the frozen Selection Contract is intentionally changed.
export const TASK1_CANDIDATE_BASE_SELECTION_CONTRACT_SHA256 =
  "5dca2bf5df8cf0f1d6de1284934ed6c754ba4ff980ce7d59fc9ec576f25314f9";

export interface Task1CandidateBaseManifestV1 {
  readonly schemaVersion: "task1.candidate-base.v1";
  readonly status: "awaiting-r05";
  readonly formalData: AnnotatedTagIdentity;
  readonly promptBaseline: AnnotatedTagIdentity;
  readonly selectionContract: {
    readonly path: typeof SELECTION_CONTRACT_PATH;
    readonly canonicalSha256: string;
  };
  readonly executionCohort: typeof TASK1_CANDIDATE_BASE_EXECUTION_COHORT;
  readonly tokenizer: typeof TASK1_CANDIDATE_BASE_TOKENIZER;
  readonly r05: {
    readonly status: "pending";
    readonly receiptSha256: null;
    readonly runtimeConfigFileSha256: null;
  };
  readonly modelRunsAtFreeze: 0;
  readonly canonicalSha256: string;
}

interface SelectionContractProjection {
  readonly formalData: AnnotatedTagIdentity;
  readonly executionCohort: {
    readonly model: string;
    readonly reasoningEffort: string;
    readonly verbosity: string;
    readonly provider: string;
    readonly usageSchema: string;
    readonly apiVersion: string;
    readonly adapterVersion: string;
    readonly nodeMajor: number;
  };
  readonly tokenSelection: {
    readonly tokenizer: string;
  };
  readonly modelRunsAtFreeze: number;
}

function gitText(repositoryRoot: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

export function assertAnnotatedTagIdentity(
  repositoryRoot: string,
  expected: AnnotatedTagIdentity,
): void {
  if (gitText(repositoryRoot, "cat-file", "-t", expected.tag) !== "tag") {
    throw new Error(`${expected.tag} must be an annotated tag`);
  }
  const actualTagObject = gitText(repositoryRoot, "rev-parse", expected.tag);
  const actualPeeledCommit = gitText(
    repositoryRoot,
    "rev-parse",
    `${expected.tag}^{}`,
  );
  if (
    actualTagObject !== expected.tagObject
    || actualPeeledCommit !== expected.peeledCommit
  ) {
    throw new Error(
      `${expected.tag} drift: expected ${expected.tagObject} -> `
      + `${expected.peeledCommit}; got ${actualTagObject} -> ${actualPeeledCommit}`,
    );
  }
}

function assertSelectionContractProjection(
  contract: SelectionContractProjection,
): void {
  const cohort = contract.executionCohort;
  if (
    contract.formalData.tag !== TASK1_CANDIDATE_BASE_TAGS.data.tag
    || contract.formalData.tagObject !== TASK1_CANDIDATE_BASE_TAGS.data.tagObject
    || contract.formalData.peeledCommit
      !== TASK1_CANDIDATE_BASE_TAGS.data.peeledCommit
    || cohort.model !== TASK1_CANDIDATE_BASE_EXECUTION_COHORT.model
    || cohort.reasoningEffort
      !== TASK1_CANDIDATE_BASE_EXECUTION_COHORT.reasoningEffort
    || cohort.verbosity !== TASK1_CANDIDATE_BASE_EXECUTION_COHORT.verbosity
    || cohort.provider !== TASK1_CANDIDATE_BASE_EXECUTION_COHORT.provider
    || cohort.usageSchema !== "openai.responses"
    || cohort.apiVersion !== "v1"
    || cohort.adapterVersion
      !== TASK1_CANDIDATE_BASE_EXECUTION_COHORT.adapterVersion
    || cohort.nodeMajor !== TASK1_CANDIDATE_BASE_EXECUTION_COHORT.nodeMajor
    || contract.tokenSelection.tokenizer !== TASK1_CANDIDATE_BASE_TOKENIZER.id
    || contract.modelRunsAtFreeze !== 0
  ) {
    throw new Error(
      "Selection Contract does not match the frozen Task 1 candidate-base configuration",
    );
  }
}

export function readSelectionContractCanonicalSha256(
  repositoryRoot: string,
  expectedSha256 = TASK1_CANDIDATE_BASE_SELECTION_CONTRACT_SHA256,
): string {
  const contract = JSON.parse(
    readFileSync(resolve(repositoryRoot, SELECTION_CONTRACT_PATH), "utf8"),
  ) as SelectionContractProjection;
  assertSelectionContractProjection(contract);
  const actualSha256 = canonicalSha256(contract);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Selection Contract canonical hash drift: expected ${expectedSha256}; `
      + `got ${actualSha256}`,
    );
  }
  return actualSha256;
}

export function buildTask1CandidateBaseManifest(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): Task1CandidateBaseManifestV1 {
  assertAnnotatedTagIdentity(repositoryRoot, TASK1_CANDIDATE_BASE_TAGS.data);
  assertAnnotatedTagIdentity(repositoryRoot, TASK1_CANDIDATE_BASE_TAGS.prompt);
  const selectionContractSha256 = readSelectionContractCanonicalSha256(
    repositoryRoot,
  );
  const unsignedManifest = {
    schemaVersion: "task1.candidate-base.v1" as const,
    status: "awaiting-r05" as const,
    formalData: TASK1_CANDIDATE_BASE_TAGS.data,
    promptBaseline: TASK1_CANDIDATE_BASE_TAGS.prompt,
    selectionContract: {
      path: SELECTION_CONTRACT_PATH,
      canonicalSha256: selectionContractSha256,
    } as const,
    executionCohort: TASK1_CANDIDATE_BASE_EXECUTION_COHORT,
    tokenizer: TASK1_CANDIDATE_BASE_TOKENIZER,
    r05: {
      status: "pending" as const,
      receiptSha256: null,
      runtimeConfigFileSha256: null,
    },
    modelRunsAtFreeze: 0 as const,
  };
  return {
    ...unsignedManifest,
    canonicalSha256: canonicalSha256(unsignedManifest),
  };
}

export function serializeTask1CandidateBaseManifest(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): string {
  return `${JSON.stringify(buildTask1CandidateBaseManifest(repositoryRoot), null, 2)}\n`;
}

export function writeTask1CandidateBaseManifest(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  outputPath = DEFAULT_OUTPUT_PATH,
): void {
  writeFileSync(
    resolve(repositoryRoot, outputPath),
    serializeTask1CandidateBaseManifest(repositoryRoot),
    "utf8",
  );
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.length !== 2) {
    throw new Error("build-provisional-freeze-manifest does not accept arguments");
  }
  writeTask1CandidateBaseManifest();
  console.log(`captured ${DEFAULT_OUTPUT_PATH}`);
}
