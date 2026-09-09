import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FormalRuntimeFreezeManifest } from "./build-runtime-freeze.js";
import { canonicalSha256, exactUtf8Sha256 } from "./canonical.js";
import type { FormalDataFreeze } from "./freeze.js";
import type { FormalReadText } from "./provider-loader.js";

export const FORMAL_RUNTIME_FREEZE_FILE_SHA256 = "69480e56ae6281711c926fda743a38c7ff9d76874f94e19a0e430b5d9a9596e4" as const;
export const FORMAL_RUNTIME_FREEZE_CANONICAL_SHA256 = "64c86aa6743714514b4e27384308bd3afc8e073be93c2fd23c11e1d600317854" as const;

export interface LoadFormalRuntimeFreezeManifestInput {
  readonly freeze: FormalDataFreeze;
  readonly readText?: FormalReadText;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unexpected key: ${key}`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} is missing key: ${key}`);
}

function hash(value: unknown, label: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a sha256`);
}

function hashRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const result = record(value, label);
  exactKeys(result, keys, label);
  for (const key of keys) hash(result[key], `${label}.${key}`);
  return result;
}

/** Public hash-only manifest loader. It never imports or opens private Measurement files. */
export function loadFormalRuntimeFreezeManifest(
  input: LoadFormalRuntimeFreezeManifestInput,
): FormalRuntimeFreezeManifest {
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const path = resolve(input.freeze.datasetRoot, "..", "formal-runtime", "frozen", "formal-runtime-freeze.json");
  const rawText = readText(path);
  if (exactUtf8Sha256(rawText) !== FORMAL_RUNTIME_FREEZE_FILE_SHA256) {
    throw new Error("runtime freeze manifest exact file hash drift");
  }
  const root = record(JSON.parse(rawText) as unknown, "runtime freeze manifest");
  if (canonicalSha256(root) !== FORMAL_RUNTIME_FREEZE_CANONICAL_SHA256) {
    throw new Error("runtime freeze manifest canonical hash drift");
  }
  exactKeys(root, [
    "schemaVersion",
    "datasetContractRevision",
    "dataFreeze",
    "counts",
    "sources",
    "measurementV2",
    "artifacts",
    "formalMetricEligible",
  ], "runtime freeze manifest");
  if (root.schemaVersion !== "task1.formal-runtime-freeze.v1"
    || root.datasetContractRevision !== "formal-v2.1"
    || root.formalMetricEligible !== false) {
    throw new Error("runtime freeze manifest identity/eligibility is invalid");
  }
  const dataFreeze = record(root.dataFreeze, "runtime freeze dataFreeze");
  exactKeys(dataFreeze, ["tag", "tagObject", "commit", "statusTagBlob", "statusFileSha256"], "runtime freeze dataFreeze");
  if (dataFreeze.tag !== input.freeze.tag
    || dataFreeze.tagObject !== input.freeze.tagObject
    || dataFreeze.commit !== input.freeze.commit
    || dataFreeze.statusTagBlob !== input.freeze.statusTagBlob
    || dataFreeze.statusFileSha256 !== input.freeze.statusFileSha256) {
    throw new Error("runtime freeze manifest does not bind the resolved data freeze");
  }
  if (!COMMIT.test(String(dataFreeze.tagObject))
    || !COMMIT.test(String(dataFreeze.commit))
    || !COMMIT.test(String(dataFreeze.statusTagBlob))) {
    throw new Error("runtime freeze Git identity is malformed");
  }
  hash(dataFreeze.statusFileSha256, "runtime freeze dataFreeze.statusFileSha256");

  const counts = record(root.counts, "runtime freeze counts");
  exactKeys(counts, ["total", "dev", "hiddenTest"], "runtime freeze counts");
  if (counts.total !== 800 || counts.dev !== 320 || counts.hiddenTest !== 480) {
    throw new Error("runtime freeze counts must be 800/320/480");
  }
  const sources = record(root.sources, "runtime freeze sources");
  exactKeys(sources, ["contract", "provider", "snapshots"], "runtime freeze sources");
  hashRecord(sources.contract, ["fileSha256", "canonicalSha256"], "runtime freeze contract");
  hashRecord(sources.provider, [
    "devFileSha256", "devCanonicalSha256", "hiddenFileSha256", "hiddenCanonicalSha256",
  ], "runtime freeze provider");
  hashRecord(sources.snapshots, ["devCanonicalSha256", "hiddenCanonicalSha256"], "runtime freeze snapshots");

  const measurement = record(root.measurementV2, "runtime freeze measurementV2");
  exactKeys(measurement, ["manifestCanonicalSha256", "gold", "pairs", "runtimeContractsCanonicalSha256"], "runtime freeze measurementV2");
  hash(measurement.manifestCanonicalSha256, "runtime freeze measurementV2.manifestCanonicalSha256");
  hash(measurement.runtimeContractsCanonicalSha256, "runtime freeze measurementV2.runtimeContractsCanonicalSha256");
  hashRecord(measurement.gold, ["devCanonicalSha256", "hiddenCanonicalSha256", "fullCanonicalSha256"], "runtime freeze Measurement-v2 Gold");
  hashRecord(measurement.pairs, ["devCanonicalSha256", "hiddenCanonicalSha256", "fullCanonicalSha256"], "runtime freeze Measurement-v2 Pair");

  const artifacts = record(root.artifacts, "runtime freeze artifacts");
  exactKeys(artifacts, ["caseBindings", "devSmokePreregistration"], "runtime freeze artifacts");
  const bindings = record(artifacts.caseBindings, "runtime freeze case bindings");
  exactKeys(bindings, [
    "path", "count", "devCount", "hiddenTestCount", "fileSha256", "canonicalSha256",
  ], "runtime freeze case bindings");
  if (bindings.path !== "formal-runtime/frozen/case-bindings.jsonl"
    || bindings.count !== 800
    || bindings.devCount !== 320
    || bindings.hiddenTestCount !== 480) {
    throw new Error("runtime freeze case binding contract is invalid");
  }
  hash(bindings.fileSha256, "runtime freeze caseBindings.fileSha256");
  hash(bindings.canonicalSha256, "runtime freeze caseBindings.canonicalSha256");
  const smoke = record(artifacts.devSmokePreregistration, "runtime freeze smoke");
  exactKeys(smoke, ["path", "count", "fileSha256", "selectionCanonicalSha256"], "runtime freeze smoke");
  if (smoke.path !== "formal-runtime/frozen/dev-smoke-preregistration.json" || smoke.count !== 40) {
    throw new Error("runtime freeze smoke contract is invalid");
  }
  hash(smoke.fileSha256, "runtime freeze smoke.fileSha256");
  hash(smoke.selectionCanonicalSha256, "runtime freeze smoke.selectionCanonicalSha256");
  return deepFreeze(root) as unknown as FormalRuntimeFreezeManifest;
}
