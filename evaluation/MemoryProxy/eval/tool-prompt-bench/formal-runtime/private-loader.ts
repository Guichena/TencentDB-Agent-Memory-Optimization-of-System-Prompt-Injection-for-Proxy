import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  OverlayPairContractV2,
  OverlayPrivateGoldV2,
  OverlayToolFamily,
} from "../formal-dataset/scripts/measurement-v2-overlay-schema.js";
import { canonicalSha256, utf8Sha256 } from "./canonical.js";
import type { FormalDataFreeze } from "./freeze.js";
import type { FormalReadText } from "./provider-loader.js";
import { loadFormalDatasetMetadata } from "./public-metadata.js";
import {
  loadRepoBackedSelection,
  repoBackedFilePath,
  REPO_BACKED_COUNTS,
  REPO_BACKED_PAIR_COUNTS,
} from "./repo-backed-selection.js";

export interface MeasurementRuntimeContract {
  readonly contractId: string;
  readonly family: OverlayToolFamily;
  readonly tool: string;
  readonly endpoint: string;
  readonly method: string;
  readonly operation:
    | { readonly kind: "none" }
    | { readonly kind: "argument"; readonly path: string; readonly value: string };
  readonly acceptedStatusCodes: readonly number[];
}

export interface LoadPrivateMeasurementSplitInput {
  readonly freeze: FormalDataFreeze;
  readonly split: "dev" | "hidden_test";
  readonly allowHiddenTest?: true;
  readonly readText?: FormalReadText;
  readonly projection?: "repo-backed-v2.1";
}

export interface PrivateMeasurementSplitData {
  readonly split: "dev" | "hidden_test";
  readonly goldCount: number;
  readonly pairCount: number;
  readonly runtimeContractCount: 22;
  readonly gold: readonly OverlayPrivateGoldV2[];
  readonly pairs: readonly OverlayPairContractV2[];
  readonly runtimeContracts: readonly MeasurementRuntimeContract[];
  readonly hashes: {
    readonly manifestCanonicalSha256: string;
    readonly goldCanonicalSha256: string;
    readonly pairCanonicalSha256: string;
    readonly runtimeContractsCanonicalSha256: string;
  };
  readonly formalMetricEligible: false;
}

const GOLD_KEYS = new Set([
  "allowedSequences",
  "attemptBudget",
  "caseId",
  "evaluationSchemaVersion",
  "expectation",
]);
const PAIR_KEYS = new Set([
  "allowedChangedPointers",
  "causalFactorId",
  "changedPointerCount",
  "independenceKey",
  "invariantFieldsSha256",
  "invariantProjectionSchemaVersion",
  "minimalityReviewStatus",
  "negativeCaseId",
  "pairId",
  "positiveCaseId",
  "schemaVersion",
  "split",
]);
const RUNTIME_KEYS = new Set([
  "acceptedStatusCodes",
  "contractId",
  "endpoint",
  "family",
  "method",
  "operation",
  "tool",
]);
const SHA256 = /^[a-f0-9]{64}$/u;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unexpected key: ${key}`);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} is missing key: ${key}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label);
  if (!SHA256.test(result)) throw new Error(`${label} must be a sha256`);
  return result;
}

function readJsonl(readText: FormalReadText, path: string, label: string): unknown[] {
  return readText(path)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`${label} row ${index + 1} is invalid JSON`, { cause: error });
      }
    });
}

function parseGold(value: unknown, index: number): OverlayPrivateGoldV2 {
  const label = `private Gold row ${index + 1}`;
  const row = record(value, label);
  exactKeys(row, GOLD_KEYS, label);
  if (row.evaluationSchemaVersion !== 2) throw new Error(`${label}.evaluationSchemaVersion must be 2`);
  if (row.expectation !== "tool" && row.expectation !== "no-tool") throw new Error(`${label}.expectation is invalid`);
  if (!Number.isInteger(row.attemptBudget) || (row.attemptBudget as number) < 0) throw new Error(`${label}.attemptBudget is invalid`);
  if (!Array.isArray(row.allowedSequences)) throw new Error(`${label}.allowedSequences must be an array`);
  text(row.caseId, `${label}.caseId`);
  return deepFreeze(structuredClone(row) as unknown as OverlayPrivateGoldV2);
}

function parsePair(value: unknown, index: number, split: "dev" | "hidden_test"): OverlayPairContractV2 {
  const label = `private Pair row ${index + 1}`;
  const row = record(value, label);
  exactKeys(row, PAIR_KEYS, label);
  const overlaySplit = split === "dev" ? "dev" : "hidden";
  if (row.schemaVersion !== "2" || row.split !== overlaySplit) throw new Error(`${label} has invalid schema or split`);
  if (row.minimalityReviewStatus !== "approved") throw new Error(`${label} is not minimality approved`);
  ["pairId", "positiveCaseId", "negativeCaseId", "causalFactorId", "independenceKey"].forEach((key) => text(row[key], `${label}.${key}`));
  hash(row.invariantFieldsSha256, `${label}.invariantFieldsSha256`);
  if (!Array.isArray(row.allowedChangedPointers) || row.allowedChangedPointers.length === 0) {
    throw new Error(`${label}.allowedChangedPointers must be non-empty`);
  }
  return deepFreeze(structuredClone(row) as unknown as OverlayPairContractV2);
}

function parseRuntimeContract(value: unknown, index: number): MeasurementRuntimeContract {
  const label = `runtime contract ${index + 1}`;
  const row = record(value, label);
  exactKeys(row, RUNTIME_KEYS, label);
  if (row.family !== "memory" && row.family !== "skill" && row.family !== "knowledge") throw new Error(`${label}.family is invalid`);
  const operation = record(row.operation, `${label}.operation`);
  if (operation.kind === "none") exactKeys(operation, new Set(["kind"]), `${label}.operation`);
  else if (operation.kind === "argument") {
    exactKeys(operation, new Set(["kind", "path", "value"]), `${label}.operation`);
    text(operation.path, `${label}.operation.path`);
    text(operation.value, `${label}.operation.value`);
  } else throw new Error(`${label}.operation.kind is invalid`);
  if (!Array.isArray(row.acceptedStatusCodes)
    || row.acceptedStatusCodes.length === 0
    || row.acceptedStatusCodes.some((status) => !Number.isInteger(status))) {
    throw new Error(`${label}.acceptedStatusCodes is invalid`);
  }
  ["contractId", "tool", "endpoint", "method"].forEach((key) => text(row[key], `${label}.${key}`));
  return deepFreeze(structuredClone(row) as unknown as MeasurementRuntimeContract);
}

function manifestArtifact(manifest: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  let current = manifest;
  for (const part of path) current = record(current[part], `private manifest.${path.join(".")}`);
  return current;
}

function validateArtifact(
  rawText: string,
  rows: readonly unknown[],
  expected: Record<string, unknown>,
  expectedCount: number,
  label: string,
): string {
  if (expected.count !== expectedCount || rows.length !== expectedCount) {
    throw new Error(`${label} count mismatch`);
  }
  const normalizedFileSha256 = utf8Sha256(rawText.replace(/\r\n/gu, "\n"));
  if (normalizedFileSha256 !== hash(expected.fileSha256, `${label}.fileSha256`)) {
    throw new Error(`${label} file hash mismatch`);
  }
  const actualCanonicalSha256 = canonicalSha256(rows);
  if (actualCanonicalSha256 !== hash(expected.canonicalSha256, `${label}.canonicalSha256`)) {
    throw new Error(`${label} canonical hash mismatch`);
  }
  return actualCanonicalSha256;
}

function validateProjectedArtifact(
  rawText: string,
  rows: readonly unknown[],
  expectedFileSha256: string,
  expectedCount: number,
  label: string,
): string {
  if (rows.length !== expectedCount) throw new Error(`${label} count mismatch`);
  const normalizedFileSha256 = utf8Sha256(rawText.replace(/\r\n/gu, "\n"));
  if (normalizedFileSha256 !== expectedFileSha256) {
    throw new Error(`${label} does not match the repo-backed selection`);
  }
  return canonicalSha256(rows);
}

/** Private-only import path. Deliberately absent from formal-runtime/index.ts. */
export function loadPrivateMeasurementSplit(input: LoadPrivateMeasurementSplitInput): PrivateMeasurementSplitData {
  if (input.split === "hidden_test" && input.allowHiddenTest !== true) {
    throw new Error("hidden_test private Measurement access is not authorized");
  }
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  loadFormalDatasetMetadata({ freeze: input.freeze, readText });
  const privateRoot = resolve(input.freeze.datasetRoot, "measurement-v2", "private");
  const selection = input.projection === "repo-backed-v2.1"
    ? loadRepoBackedSelection({ datasetRoot: input.freeze.datasetRoot, readText })
    : undefined;
  const manifest = record(JSON.parse(readText(resolve(privateRoot, "manifest.private.json"))) as unknown, "private manifest");
  if (manifest.visibility !== "private_never_provider_visible" || manifest.formalMetricEligible !== false) {
    throw new Error("private manifest visibility/eligibility contract is invalid");
  }
  const manifestCanonicalSha256 = canonicalSha256(manifest);
  const dev = input.split === "dev";
  const goldFileId = dev ? "gold-dev" : "gold-hidden";
  const pairFileId = dev ? "pairs-dev" : "pairs-hidden";
  const goldPath = selection
    ? repoBackedFilePath(input.freeze.datasetRoot, goldFileId)
    : resolve(privateRoot, "gold", dev ? "dev.private.jsonl" : "hidden.private.jsonl");
  const pairPath = selection
    ? repoBackedFilePath(input.freeze.datasetRoot, pairFileId)
    : resolve(privateRoot, "pairs", dev ? "dev.private.jsonl" : "hidden.private.jsonl");
  const runtimePath = resolve(privateRoot, "runtime-contracts.private.json");
  const goldText = readText(goldPath);
  const pairText = readText(pairPath);
  const runtimeText = readText(runtimePath);
  const gold = readJsonl(() => goldText, goldPath, "private Gold").map(parseGold);
  const pairs = readJsonl(() => pairText, pairPath, "private Pair")
    .map((row, index) => parsePair(row, index, input.split));
  const runtimeValue = JSON.parse(runtimeText) as unknown;
  if (!Array.isArray(runtimeValue)) throw new Error("runtime contracts must be an array");
  const runtimeContracts = runtimeValue.map(parseRuntimeContract);
  const goldExpected = selection
    ? REPO_BACKED_COUNTS[dev ? "dev" : "hiddenTest"]
    : dev ? 320 : 480;
  const pairExpected = selection
    ? REPO_BACKED_PAIR_COUNTS[dev ? "dev" : "hiddenTest"]
    : dev ? 120 : 180;
  const goldCanonicalSha256 = selection
    ? validateProjectedArtifact(
      goldText,
      gold,
      selection.files[goldFileId].activeFileSha256,
      goldExpected,
      "private Gold",
    )
    : validateArtifact(
      goldText,
      gold,
      manifestArtifact(manifest, ["overlays", dev ? "goldDev" : "goldHidden"]),
      goldExpected,
      "private Gold",
    );
  const pairCanonicalSha256 = selection
    ? validateProjectedArtifact(
      pairText,
      pairs,
      selection.files[pairFileId].activeFileSha256,
      pairExpected,
      "private Pair",
    )
    : validateArtifact(
      pairText,
      pairs,
      manifestArtifact(manifest, ["overlays", dev ? "pairDev" : "pairHidden"]),
      pairExpected,
      "private Pair",
    );
  const runtimeContractsCanonicalSha256 = validateArtifact(
    runtimeText,
    runtimeContracts,
    manifestArtifact(manifest, ["overlays", "runtimeContracts"]),
    22,
    "runtime contracts",
  );
  const goldIds = new Set(gold.map((item) => item.caseId));
  if (goldIds.size !== gold.length) throw new Error("private Gold contains duplicate caseIds");
  const pairIds = new Set(pairs.map((item) => item.pairId));
  if (pairIds.size !== pairs.length) throw new Error("private Pair contains duplicate pairIds");
  for (const pair of pairs) {
    if (!goldIds.has(pair.positiveCaseId) || !goldIds.has(pair.negativeCaseId)) {
      throw new Error(`${pair.pairId}: Pair cases are absent from private Gold`);
    }
  }
  if (new Set(runtimeContracts.map((item) => item.contractId)).size !== 22) {
    throw new Error("runtime contract ids must be 22 unique values");
  }
  return Object.freeze({
    split: input.split,
    goldCount: gold.length,
    pairCount: pairs.length,
    runtimeContractCount: 22 as const,
    gold: Object.freeze(gold),
    pairs: Object.freeze(pairs),
    runtimeContracts: Object.freeze(runtimeContracts),
    hashes: Object.freeze({
      manifestCanonicalSha256,
      goldCanonicalSha256,
      pairCanonicalSha256,
      runtimeContractsCanonicalSha256,
    }),
    formalMetricEligible: false as const,
  });
}
