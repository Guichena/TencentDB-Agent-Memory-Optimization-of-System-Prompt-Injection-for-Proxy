/** Deterministic Formal V2 snapshot and fairness-policy helpers. */
import { createHash } from "node:crypto";
import type { RuntimePolicy } from "./formal-schema.js";
import type { ResolvedVisibleSnapshot } from "./formal-visibility.js";

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

/** Formal runs are read-only and must start from a restored state. */
export interface FormalRuntimePolicy extends RuntimePolicy {
  freshSessionPerCase: true;
  /**
   * Frozen field name retained for data/tag compatibility. In Task 1 runtime
   * this resets only the case-local Session/local overlay namespace; the
   * persisted Memory/Skill/Knowledge asset database is restored once per
   * campaign and is never restored between cases.
   */
  resetSnapshotBeforeCase: true;
}

export const FORMAL_READ_ONLY_RUNTIME_POLICY: Readonly<FormalRuntimePolicy> = Object.freeze({
  allowLlmWrite: false,
  extraction: Object.freeze({ enabled: false, extractors: Object.freeze([]) as readonly [] }),
  assetReflection: false,
  writeL0: false,
  archiveWriteBack: false,
  freshSessionPerCase: true,
  resetSnapshotBeforeCase: true,
});

export interface FormalWorldSnapshotInput {
  snapshotId: string;
  sourcePackHash: string;
  visibleAssets: ResolvedVisibleSnapshot;
  workspace: CanonicalValue;
  overlay?: CanonicalValue;
  /** Bytes/content hash emitted by the sole production injection pipeline. */
  injection?: CanonicalValue;
  runtimePolicy?: FormalRuntimePolicy;
  /** A declarative reset recipe/version, never an executable command. */
  resetRecipe: CanonicalValue;
}

export interface FrozenWorldSnapshot {
  snapshotId: string;
  sourcePackHash: string;
  visibleAssets: ResolvedVisibleSnapshot;
  workspace: CanonicalValue;
  overlay: CanonicalValue | null;
  injection: CanonicalValue | null;
  runtimePolicy: FormalRuntimePolicy;
  resetRecipe: CanonicalValue;
  visibleAssetsSha256: string;
  workspaceSha256: string;
  overlaySha256: string;
  injectionSha256: string;
  runtimePolicySha256: string;
  snapshotSha256: string;
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON rejects non-finite numbers");
      return JSON.stringify(value);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(`canonical JSON rejects ${typeof value}`);
    case "object":
      break;
    default:
      throw new TypeError(`unsupported canonical JSON value ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError("canonical JSON rejects cyclic values");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry, ancestors)).join(",")}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("canonical JSON accepts only plain objects and arrays");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Stable JSON representation: object keys are lexical; array order is semantic. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Rejects any policy that could mutate or derive assets during a formal run. */
export function assertFormalReadOnlyRuntimePolicy(policy: FormalRuntimePolicy): void {
  if (policy.allowLlmWrite !== false) throw new Error("Formal snapshot policy requires allowLlmWrite=false");
  if (policy.extraction?.enabled !== false || !Array.isArray(policy.extraction?.extractors) || policy.extraction.extractors.length !== 0) {
    throw new Error("Formal snapshot policy requires extraction.enabled=false and extraction.extractors=[]");
  }
  if (policy.assetReflection !== false) throw new Error("Formal snapshot policy requires assetReflection=false");
  if (policy.writeL0 !== false) throw new Error("Formal snapshot policy requires writeL0=false");
  if (policy.archiveWriteBack !== false) throw new Error("Formal snapshot policy requires archiveWriteBack=false");
  if (policy.freshSessionPerCase !== true) throw new Error("Formal snapshot policy requires freshSessionPerCase=true");
  // Legacy frozen name: this is a case-local overlay reset, not a persisted
  // asset database restore. Do not reinterpret it as per-case R05 restore.
  if (policy.resetSnapshotBeforeCase !== true) throw new Error("Formal snapshot policy requires resetSnapshotBeforeCase=true");
}

/**
 * Materialize a hash-addressed snapshot.  No Date, random value, map iteration,
 * or mutable runtime state enters this object, making case/variant comparisons
 * independently reproducible.
 */
export function freezeWorldSnapshot(input: FormalWorldSnapshotInput): FrozenWorldSnapshot {
  const runtimePolicy = { ...(input.runtimePolicy ?? FORMAL_READ_ONLY_RUNTIME_POLICY) } as FormalRuntimePolicy;
  assertFormalReadOnlyRuntimePolicy(runtimePolicy);
  const overlay = input.overlay ?? null;
  const injection = input.injection ?? null;
  const visibleAssetsSha256 = canonicalSha256(input.visibleAssets);
  const workspaceSha256 = canonicalSha256(input.workspace);
  const overlaySha256 = canonicalSha256(overlay);
  const injectionSha256 = canonicalSha256(injection);
  const runtimePolicySha256 = canonicalSha256(runtimePolicy);
  const snapshotCore = {
    snapshotId: input.snapshotId,
    sourcePackHash: input.sourcePackHash,
    visibleAssetsSha256,
    workspaceSha256,
    overlaySha256,
    injectionSha256,
    runtimePolicySha256,
    resetRecipe: input.resetRecipe,
  };
  return {
    snapshotId: input.snapshotId,
    sourcePackHash: input.sourcePackHash,
    visibleAssets: input.visibleAssets,
    workspace: input.workspace,
    overlay,
    injection,
    runtimePolicy,
    resetRecipe: input.resetRecipe,
    visibleAssetsSha256,
    workspaceSha256,
    overlaySha256,
    injectionSha256,
    runtimePolicySha256,
    snapshotSha256: canonicalSha256(snapshotCore),
  };
}

/** Executes a deterministic builder twice and fails on any snapshot/hash drift. */
export function assertSnapshotDeterminism(build: () => FrozenWorldSnapshot): FrozenWorldSnapshot {
  const first = build();
  const second = build();
  const firstCanonical = canonicalJson(first);
  const secondCanonical = canonicalJson(second);
  if (firstCanonical !== secondCanonical || first.snapshotSha256 !== second.snapshotSha256) {
    throw new Error("Formal snapshot is not deterministic across identical rebuilds");
  }
  return first;
}
