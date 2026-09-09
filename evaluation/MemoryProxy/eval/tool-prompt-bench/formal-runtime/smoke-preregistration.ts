import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalSha256, exactUtf8Sha256 } from "./canonical.js";
import type {
  FormalSmokeCoverageContract,
  FormalSmokePreregistration,
  FormalSmokeSelectionContract,
  FormalSmokeTeamRule,
} from "./build-smoke-preregistration.js";
import type { FormalDataFreeze } from "./freeze.js";
import type { FormalReadText } from "./provider-loader.js";
import { loadFormalRuntimeFreezeManifest } from "./runtime-freeze.js";

export interface LoadFormalSmokePreregistrationInput {
  readonly freeze: FormalDataFreeze;
  readonly readText?: FormalReadText;
}
const ROOT_KEYS = new Set(["caseIds", "selectionContract", "sha256"]);
const CONTRACT_KEYS = new Set([
  "casesPerTeam",
  "coverage",
  "naturalNoToolSelection",
  "ordering",
  "pairedNoToolSelection",
  "positiveFamilies",
  "positiveSelection",
  "schemaVersion",
  "split",
  "teamRules",
  "totalCases",
]);
const RULE_KEYS = new Set(["pairedNegativeFamily", "teamId"]);
const COVERAGE_KEYS = new Set([
  "counterfactualKind",
  "knowledge",
  "memory",
  "naturalNegative",
  "pairedNegative",
  "skill",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new Error(`${label} has unexpected key: ${key}`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label} is missing key: ${key}`);
}

function parseRule(value: unknown, index: number): FormalSmokeTeamRule {
  const row = record(value, `smoke team rule ${index + 1}`);
  exactKeys(row, RULE_KEYS, `smoke team rule ${index + 1}`);
  if (typeof row.teamId !== "string" || !/^T[0-9]{2}$/u.test(row.teamId)) throw new Error("smoke team rule teamId is invalid");
  if (row.pairedNegativeFamily !== "memory"
    && row.pairedNegativeFamily !== "skill"
    && row.pairedNegativeFamily !== "knowledge") {
    throw new Error("smoke team rule pairedNegativeFamily is invalid");
  }
  return Object.freeze({
    teamId: row.teamId,
    pairedNegativeFamily: row.pairedNegativeFamily,
  });
}

function parseCoverage(value: unknown): FormalSmokeCoverageContract {
  const row = record(value, "smoke coverage contract");
  exactKeys(row, COVERAGE_KEYS, "smoke coverage contract");
  if (row.memory !== "all_six_operations_and_single_plus_multi_step"
    || row.skill !== "direct_view_search_to_view_and_view_to_files_read"
    || row.knowledge !== "list_to_call_all_available_smoke_operations_and_four_resources"
    || row.pairedNegative !== "three_memory_three_skill_two_knowledge_frozen_counterparts"
    || row.counterfactualKind !== "answer_in_current_context"
    || row.naturalNegative !== "one_real_coding_negative_per_team") {
    throw new Error("smoke coverage contract is invalid");
  }
  return Object.freeze(row) as unknown as FormalSmokeCoverageContract;
}

function parseContract(value: unknown): FormalSmokeSelectionContract {
  const row = record(value, "smoke selection contract");
  exactKeys(row, CONTRACT_KEYS, "smoke selection contract");
  if (row.schemaVersion !== "task1.formal-dev-smoke-preregistration.v2"
    || row.split !== "dev"
    || row.totalCases !== 40
    || row.casesPerTeam !== 5
    || row.positiveSelection !== "deterministic_constraint_search"
    || row.pairedNoToolSelection !== "frozen_pair_v2_counterpart_of_selected_positive"
    || row.naturalNoToolSelection !== "most_context_rich_then_query_length_then_case_id"
    || row.ordering !== "team_rule_order_memory_skill_knowledge_paired_natural"
    || !Array.isArray(row.positiveFamilies)
    || JSON.stringify(row.positiveFamilies) !== JSON.stringify(["memory", "skill", "knowledge"])
    || !Array.isArray(row.teamRules)
    || row.teamRules.length !== 8) {
    throw new Error("smoke selection contract is invalid");
  }
  const teamRules = Object.freeze(row.teamRules.map(parseRule));
  if (new Set(teamRules.map((rule) => rule.teamId)).size !== 8) throw new Error("smoke Team ids must be unique");
  const familyCounts = new Map<string, number>();
  for (const rule of teamRules) familyCounts.set(rule.pairedNegativeFamily, (familyCounts.get(rule.pairedNegativeFamily) ?? 0) + 1);
  if (familyCounts.get("memory") !== 3 || familyCounts.get("skill") !== 3 || familyCounts.get("knowledge") !== 2) {
    throw new Error("smoke paired negative family allocation must be 3/3/2");
  }
  return Object.freeze({
    schemaVersion: row.schemaVersion,
    split: row.split,
    totalCases: row.totalCases,
    casesPerTeam: row.casesPerTeam,
    teamRules,
    positiveFamilies: Object.freeze(["memory", "skill", "knowledge"] as const),
    positiveSelection: row.positiveSelection,
    pairedNoToolSelection: row.pairedNoToolSelection,
    naturalNoToolSelection: row.naturalNoToolSelection,
    coverage: parseCoverage(row.coverage),
    ordering: row.ordering,
  });
}

/** Public smoke loader. Its dependency graph contains no private Measurement import. */
export function loadFormalSmokePreregistration(
  input: LoadFormalSmokePreregistrationInput,
): FormalSmokePreregistration {
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const manifest = loadFormalRuntimeFreezeManifest({ freeze: input.freeze, readText });
  const path = resolve(input.freeze.datasetRoot, "..", "formal-runtime", "frozen", "dev-smoke-preregistration.json");
  const rawText = readText(path);
  if (exactUtf8Sha256(rawText) !== manifest.artifacts.devSmokePreregistration.fileSha256) {
    throw new Error("smoke preregistration file hash does not match runtime freeze manifest");
  }
  const root = record(JSON.parse(rawText) as unknown, "smoke preregistration");
  exactKeys(root, ROOT_KEYS, "smoke preregistration");
  if (!Array.isArray(root.caseIds)
    || root.caseIds.length !== 40
    || root.caseIds.some((caseId) => typeof caseId !== "string" || caseId.length === 0)
    || new Set(root.caseIds).size !== 40) {
    throw new Error("smoke preregistration caseIds must be 40 unique strings");
  }
  if (typeof root.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(root.sha256)) {
    throw new Error("smoke preregistration sha256 is invalid");
  }
  const caseIds = Object.freeze([...root.caseIds] as string[]);
  const selectionContract = parseContract(root.selectionContract);
  const expectedSha256 = canonicalSha256({ caseIds, selectionContract });
  if (root.sha256 !== expectedSha256) throw new Error("smoke preregistration hash mismatch");
  if (root.sha256 !== manifest.artifacts.devSmokePreregistration.selectionCanonicalSha256) {
    throw new Error("smoke preregistration selection hash does not match runtime freeze manifest");
  }
  return Object.freeze({
    caseIds,
    selectionContract,
    sha256: root.sha256,
    formalMetricEligible: false as const,
  });
}
