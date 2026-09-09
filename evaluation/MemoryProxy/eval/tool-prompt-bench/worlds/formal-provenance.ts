/**
 * Deterministic provenance graph and split-leakage gate for Formal V2 cases.
 *
 * Near-duplicate grouping is deliberately upstream work: this module consumes
 * the supplied group key as ordinary provenance and never embeds a vector model.
 */
import { canonicalSha256 } from "./formal-snapshot.js";
import type { FormalSplit } from "./formal-schema.js";

export const PROVENANCE_CONFLICT_KINDS = [
  "repoForkFamily",
  "sourceTask",
  "trajectory",
  "patchHash",
  "skillBodyFamily",
  "skillBodyHash",
  "wikiDocument",
  "codegraphCommit",
  "nearDuplicateQueryGroup",
] as const;

export type ProvenanceConflictKind = (typeof PROVENANCE_CONFLICT_KINDS)[number];

/** All values are precomputed, stable identifiers; empty arrays mean “not applicable”. */
export type ProvenanceConflictKeys = Record<ProvenanceConflictKind, string[]>;

/** One public evaluation case, its World split, and the provenance keys it may conflict on. */
export interface FormalCaseProvenance {
  worldId: string;
  caseId: string;
  split: FormalSplit;
  conflictKeys: ProvenanceConflictKeys;
}

export interface ProvenanceComponent {
  componentId: string;
  caseIds: string[];
  splits: FormalSplit[];
  conflictKeys: string[];
}

export interface ProvenanceSplitGateResult {
  valid: boolean;
  errors: string[];
  components: ProvenanceComponent[];
  graphSha256: string;
}

interface NormalizedCaseProvenance {
  nodeId: string;
  worldId: string;
  caseId: string;
  split: FormalSplit;
  keys: string[];
}

class UnionFind {
  private readonly parents: number[];

  public constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  public find(index: number): number {
    if (this.parents[index] !== index) this.parents[index] = this.find(this.parents[index]);
    return this.parents[index];
  }

  public union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  }
}

function caseLabel(input: Pick<FormalCaseProvenance, "worldId" | "caseId">): string {
  return `${input.worldId || "<missing-world>"}/${input.caseId || "<missing-case>"}`;
}

function normalizeKeyValues(
  input: FormalCaseProvenance,
  kind: ProvenanceConflictKind,
  errors: string[],
): string[] {
  const values = input.conflictKeys?.[kind];
  const label = caseLabel(input);
  if (!Array.isArray(values)) {
    errors.push(`${label}: conflict key ${kind} must be an array`);
    return [];
  }
  const normalized = values.map((value) => typeof value === "string" ? value.trim() : "");
  if (normalized.some((value) => !value)) errors.push(`${label}: conflict key ${kind} contains an empty value`);
  if (new Set(normalized).size !== normalized.length) errors.push(`${label}: conflict key ${kind} repeats a value`);
  return [...new Set(normalized.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeCases(inputs: readonly FormalCaseProvenance[], errors: string[]): NormalizedCaseProvenance[] {
  const seenCaseIds = new Set<string>();
  const normalized: NormalizedCaseProvenance[] = [];
  const sorted = [...inputs].sort((left, right) =>
    caseLabel(left).localeCompare(caseLabel(right)) || left.split.localeCompare(right.split),
  );
  for (const input of sorted) {
    const label = caseLabel(input);
    if (!input.worldId.trim()) errors.push(`${label}: worldId is required`);
    if (!input.caseId.trim()) errors.push(`${label}: caseId is required`);
    if (input.split !== "dev" && input.split !== "hidden_test") errors.push(`${label}: split must be dev or hidden_test`);
    if (seenCaseIds.has(input.caseId)) {
      errors.push(`${label}: duplicate caseId ${input.caseId}`);
      continue;
    }
    seenCaseIds.add(input.caseId);
    const valuesByKind = new Map(PROVENANCE_CONFLICT_KINDS.map((kind) => [kind, normalizeKeyValues(input, kind, errors)]));
    const sourceTask = valuesByKind.get("sourceTask") ?? [];
    const trajectory = valuesByKind.get("trajectory") ?? [];
    if (sourceTask.length === 0 && trajectory.length === 0) {
      errors.push(`${label}: source keys are missing; provide sourceTask and/or trajectory`);
    }
    const keys = PROVENANCE_CONFLICT_KINDS.flatMap((kind) =>
      (valuesByKind.get(kind) ?? []).map((value) => `${kind}:${value}`),
    ).sort((left, right) => left.localeCompare(right));
    normalized.push({ nodeId: `${input.worldId}/${input.caseId}`, worldId: input.worldId, caseId: input.caseId, split: input.split, keys });
  }
  return normalized;
}

function buildComponents(cases: readonly NormalizedCaseProvenance[]): ProvenanceComponent[] {
  const unionFind = new UnionFind(cases.length);
  const firstCaseByKey = new Map<string, number>();
  for (const [index, item] of cases.entries()) {
    for (const key of item.keys) {
      const first = firstCaseByKey.get(key);
      if (first === undefined) firstCaseByKey.set(key, index);
      else unionFind.union(first, index);
    }
  }
  const membersByRoot = new Map<number, number[]>();
  for (const [index] of cases.entries()) {
    const root = unionFind.find(index);
    const members = membersByRoot.get(root) ?? [];
    members.push(index);
    membersByRoot.set(root, members);
  }
  return [...membersByRoot.values()].map((memberIndexes) => {
    const members = memberIndexes.map((index) => cases[index]);
    const caseIds = members.map((item) => item.nodeId).sort((left, right) => left.localeCompare(right));
    const splits = [...new Set(members.map((item) => item.split))].sort();
    const conflictKeys = [...new Set(members.flatMap((item) => item.keys))].sort((left, right) => left.localeCompare(right));
    return {
      componentId: canonicalSha256({ caseIds, conflictKeys }),
      caseIds,
      splits,
      conflictKeys,
    };
  }).sort((left, right) => left.caseIds[0].localeCompare(right.caseIds[0]));
}

/**
 * Builds the transitive graph induced by shared provenance keys and rejects
 * every component that joins a dev case to a hidden-test case.
 */
export function validateFormalProvenanceSplit(
  inputs: readonly FormalCaseProvenance[],
): ProvenanceSplitGateResult {
  const errors: string[] = [];
  const normalized = normalizeCases(inputs, errors);
  const components = buildComponents(normalized);
  for (const component of components) {
    if (component.splits.includes("dev") && component.splits.includes("hidden_test")) {
      errors.push(`split leakage in component ${component.componentId}: dev and hidden_test are connected by ${component.conflictKeys.join(", ")}`);
    }
  }
  const graphSha256 = canonicalSha256({
    cases: normalized.map(({ nodeId, worldId, caseId, split, keys }) => ({ nodeId, worldId, caseId, split, keys })),
    components,
  });
  return { valid: errors.length === 0, errors, components, graphSha256 };
}

export function assertFormalProvenanceSplit(inputs: readonly FormalCaseProvenance[]): ProvenanceSplitGateResult {
  const result = validateFormalProvenanceSplit(inputs);
  if (!result.valid) throw new Error(result.errors.join("\n"));
  return result;
}
