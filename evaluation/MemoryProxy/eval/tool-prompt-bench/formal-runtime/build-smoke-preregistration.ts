import type { OverlayToolFamily } from "../formal-dataset/scripts/measurement-v2-overlay-schema.js";
import { canonicalSha256 } from "./canonical.js";
import { buildFormalCaseBindings } from "./build-case-bindings.js";
import type { FormalDataFreeze } from "./freeze.js";
import { loadPrivateMeasurementSplit } from "./private-loader.js";
import {
  loadFormalProviderSplit,
  type FormalReadText,
} from "./provider-loader.js";

export interface FormalSmokeTeamRule {
  readonly teamId: string;
  readonly pairedNegativeFamily: OverlayToolFamily;
}
export interface FormalSmokeCoverageContract {
  readonly memory: "all_six_operations_and_single_plus_multi_step";
  readonly skill: "direct_view_search_to_view_and_view_to_files_read";
  readonly knowledge: "list_to_call_all_available_smoke_operations_and_four_resources";
  readonly pairedNegative: "three_memory_three_skill_two_knowledge_frozen_counterparts";
  readonly counterfactualKind: "answer_in_current_context";
  readonly naturalNegative: "one_real_coding_negative_per_team";
}

export interface FormalSmokeSelectionContract {
  readonly schemaVersion: "task1.formal-dev-smoke-preregistration.v2";
  readonly split: "dev";
  readonly totalCases: 40;
  readonly casesPerTeam: 5;
  readonly teamRules: readonly FormalSmokeTeamRule[];
  readonly positiveFamilies: readonly ["memory", "skill", "knowledge"];
  readonly positiveSelection: "deterministic_constraint_search";
  readonly pairedNoToolSelection: "frozen_pair_v2_counterpart_of_selected_positive";
  readonly naturalNoToolSelection: "most_context_rich_then_query_length_then_case_id";
  readonly coverage: FormalSmokeCoverageContract;
  readonly ordering: "team_rule_order_memory_skill_knowledge_paired_natural";
}

export interface FormalSmokePreregistration {
  readonly caseIds: readonly string[];
  readonly selectionContract: FormalSmokeSelectionContract;
  readonly sha256: string;
  readonly formalMetricEligible: false;
}

export interface BuildFormalSmokePreregistrationInput {
  readonly freeze: FormalDataFreeze;
  readonly readText?: FormalReadText;
}

type PrivateGold = ReturnType<typeof loadPrivateMeasurementSplit>["gold"][number];

const TEAM_RULES: readonly FormalSmokeTeamRule[] = Object.freeze([
  Object.freeze({ teamId: "T01", pairedNegativeFamily: "memory" }),
  Object.freeze({ teamId: "T02", pairedNegativeFamily: "skill" }),
  Object.freeze({ teamId: "T03", pairedNegativeFamily: "knowledge" }),
  Object.freeze({ teamId: "T04", pairedNegativeFamily: "memory" }),
  Object.freeze({ teamId: "T11", pairedNegativeFamily: "skill" }),
  Object.freeze({ teamId: "T12", pairedNegativeFamily: "knowledge" }),
  Object.freeze({ teamId: "T17", pairedNegativeFamily: "memory" }),
  Object.freeze({ teamId: "T18", pairedNegativeFamily: "skill" }),
]);

const POSITIVE_FAMILIES = Object.freeze(["memory", "skill", "knowledge"] as const);
const MEMORY_TOOLS = Object.freeze([
  "tdai_atomic_query",
  "tdai_conversation_query",
  "tdai_conversation_search",
  "tdai_memory_search",
  "tdai_read_scene",
  "tdai_scenario_ls",
] as const);
const SKILL_ROUTES = Object.freeze([
  "skill_view",
  "skill_search->skill_view_by_id",
  "skill_view->skill_files_read",
] as const);

export const FORMAL_SMOKE_SELECTION_CONTRACT: FormalSmokeSelectionContract = Object.freeze({
  schemaVersion: "task1.formal-dev-smoke-preregistration.v2",
  split: "dev",
  totalCases: 40,
  casesPerTeam: 5,
  teamRules: TEAM_RULES,
  positiveFamilies: POSITIVE_FAMILIES,
  positiveSelection: "deterministic_constraint_search",
  pairedNoToolSelection: "frozen_pair_v2_counterpart_of_selected_positive",
  naturalNoToolSelection: "most_context_rich_then_query_length_then_case_id",
  coverage: Object.freeze({
    memory: "all_six_operations_and_single_plus_multi_step",
    skill: "direct_view_search_to_view_and_view_to_files_read",
    knowledge: "list_to_call_all_available_smoke_operations_and_four_resources",
    pairedNegative: "three_memory_three_skill_two_knowledge_frozen_counterparts",
    counterfactualKind: "answer_in_current_context",
    naturalNegative: "one_real_coding_negative_per_team",
  }),
  ordering: "team_rule_order_memory_skill_knowledge_paired_natural",
});

function goldFamily(gold: PrivateGold): OverlayToolFamily | undefined {
  const families = new Set(gold.allowedSequences.map((sequence) => sequence.steps[0]?.family));
  return families.size === 1 ? [...families][0] : undefined;
}

function featuresForMemory(gold: PrivateGold): ReadonlySet<string> {
  const features = new Set<string>();
  for (const sequence of gold.allowedSequences) {
    features.add(sequence.steps.length > 1 ? "chain:multi" : "chain:single");
    for (const step of sequence.steps) features.add(`tool:${step.tool}`);
  }
  return features;
}

function featuresForSkill(gold: PrivateGold): ReadonlySet<string> {
  return new Set(gold.allowedSequences.map((sequence) => (
    `route:${sequence.steps.map((step) => step.tool).join("->")}`
  )));
}

function exactStringArgument(gold: PrivateGold, path: string): readonly string[] {
  return [...new Set(gold.allowedSequences.flatMap((sequence) => sequence.steps)
    .flatMap((step) => step.arguments?.exact ?? [])
    .filter((item) => item.path === path && typeof item.value === "string")
    .map((item) => item.value as string))];
}

function featuresForKnowledge(gold: PrivateGold): ReadonlySet<string> {
  const features = new Set<string>();
  for (const sequence of gold.allowedSequences) {
    if (sequence.steps.length >= 2
      && sequence.steps[0]?.tool === "knowledge_tools_list"
      && sequence.steps[1]?.tool === "knowledge_tools_call") {
      features.add("route:list-to-call");
    }
    for (const step of sequence.steps) {
      if (step.tool === "knowledge_tools_call" && step.operation.kind === "exact") {
        features.add(`operation:${step.operation.value}`);
      }
    }
  }
  return features;
}

function selectOnePerTeam(
  label: string,
  candidatesByTeam: ReadonlyMap<string, readonly PrivateGold[]>,
  features: (gold: PrivateGold) => ReadonlySet<string>,
  requiredFeatures: ReadonlySet<string>,
  finalAccept: (selected: readonly PrivateGold[]) => boolean = () => true,
): readonly PrivateGold[] {
  const teams = TEAM_RULES.map((rule) => rule.teamId);
  let result: readonly PrivateGold[] | undefined;

  function visit(index: number, selected: readonly PrivateGold[], covered: ReadonlySet<string>): void {
    if (result) return;
    if (index === teams.length) {
      if ([...requiredFeatures].every((feature) => covered.has(feature)) && finalAccept(selected)) {
        result = Object.freeze([...selected]);
      }
      return;
    }

    const possible = new Set(covered);
    for (let remaining = index; remaining < teams.length; remaining += 1) {
      for (const candidate of candidatesByTeam.get(teams[remaining]!) ?? []) {
        for (const feature of features(candidate)) possible.add(feature);
      }
    }
    if ([...requiredFeatures].some((feature) => !possible.has(feature))) return;

    const teamId = teams[index]!;
    const candidates = candidatesByTeam.get(teamId) ?? [];
    if (candidates.length === 0) throw new Error(`${label}: ${teamId} has no candidate`);
    for (const candidate of candidates) {
      const next = new Set(covered);
      for (const feature of features(candidate)) next.add(feature);
      visit(index + 1, [...selected, candidate], next);
    }
  }

  visit(0, [], new Set());
  if (!result) {
    throw new Error(`${label}: deterministic selection cannot satisfy ${[...requiredFeatures].sort().join(", ")}`);
  }
  return result;
}

function candidatesForFamily(
  gold: readonly PrivateGold[],
  teamByCaseId: ReadonlyMap<string, string>,
  family: OverlayToolFamily,
): ReadonlyMap<string, readonly PrivateGold[]> {
  return new Map(TEAM_RULES.map((rule) => [
    rule.teamId,
    Object.freeze(gold
      .filter((item) => item.expectation === "tool"
        && teamByCaseId.get(item.caseId) === rule.teamId
        && goldFamily(item) === family)
      .sort((left, right) => left.caseId.localeCompare(right.caseId))),
  ]));
}

/** Offline selector. Private labels are reduced to a frozen public list of case ids. */
export function buildFormalSmokePreregistration(
  input: BuildFormalSmokePreregistrationInput,
): FormalSmokePreregistration {
  const bindings = buildFormalCaseBindings(input);
  const measurement = loadPrivateMeasurementSplit({
    freeze: input.freeze,
    split: "dev",
    readText: input.readText,
  });
  const provider = loadFormalProviderSplit({
    freeze: input.freeze,
    split: "dev",
    readText: input.readText,
  });
  const bindingById = new Map(bindings.rows.map((binding) => [binding.caseId, binding]));
  const teamByCaseId = new Map(bindings.rows.map((binding) => [binding.caseId, binding.identity.teamId]));
  const goldById = new Map(measurement.gold.map((gold) => [gold.caseId, gold]));
  const providerById = new Map(provider.cases.map((item) => [item.caseId, item]));
  const pairedNegativeIds = new Set(measurement.pairs.map((pair) => pair.negativeCaseId));
  const pairByPositive = new Map(measurement.pairs.map((pair) => [pair.positiveCaseId, pair]));

  const memory = selectOnePerTeam(
    "memory smoke coverage",
    candidatesForFamily(measurement.gold, teamByCaseId, "memory"),
    featuresForMemory,
    new Set([
      ...MEMORY_TOOLS.map((tool) => `tool:${tool}`),
      "chain:single",
      "chain:multi",
    ]),
  );
  const skill = selectOnePerTeam(
    "skill smoke coverage",
    candidatesForFamily(measurement.gold, teamByCaseId, "skill"),
    featuresForSkill,
    new Set(SKILL_ROUTES.map((route) => `route:${route}`)),
  );
  const knowledgeCandidates = candidatesForFamily(measurement.gold, teamByCaseId, "knowledge");
  const availableKnowledgeOperations = new Set<string>();
  for (const candidates of knowledgeCandidates.values()) {
    for (const candidate of candidates) {
      for (const feature of featuresForKnowledge(candidate)) {
        if (feature.startsWith("operation:")) availableKnowledgeOperations.add(feature);
      }
    }
  }
  const knowledge = selectOnePerTeam(
    "knowledge smoke coverage",
    knowledgeCandidates,
    featuresForKnowledge,
    new Set(["route:list-to-call", ...availableKnowledgeOperations]),
    (selected) => new Set(selected.flatMap((item) => exactStringArgument(item, "knowledge_id"))).size >= 4,
  );

  const selectedByTeamFamily = new Map<string, PrivateGold>();
  for (const [family, selected] of [
    ["memory", memory],
    ["skill", skill],
    ["knowledge", knowledge],
  ] as const) {
    selected.forEach((item, index) => selectedByTeamFamily.set(`${TEAM_RULES[index]!.teamId}:${family}`, item));
  }

  const caseIds: string[] = [];
  for (const rule of TEAM_RULES) {
    const memoryCase = selectedByTeamFamily.get(`${rule.teamId}:memory`);
    const skillCase = selectedByTeamFamily.get(`${rule.teamId}:skill`);
    const knowledgeCase = selectedByTeamFamily.get(`${rule.teamId}:knowledge`);
    if (!memoryCase || !skillCase || !knowledgeCase) throw new Error(`${rule.teamId}: missing selected positive`);

    const pairedPositive = selectedByTeamFamily.get(`${rule.teamId}:${rule.pairedNegativeFamily}`);
    const pair = pairedPositive ? pairByPositive.get(pairedPositive.caseId) : undefined;
    if (!pair || pair.causalFactorId !== "task1:answer_in_current_context"
      || goldById.get(pair.negativeCaseId)?.expectation !== "no-tool") {
      throw new Error(`${rule.teamId}: selected ${rule.pairedNegativeFamily} positive lacks its frozen no-tool counterpart`);
    }

    const natural = measurement.gold
      .filter((gold) => gold.expectation === "no-tool"
        && teamByCaseId.get(gold.caseId) === rule.teamId
        && !pairedNegativeIds.has(gold.caseId))
      .sort((left, right) => {
        const leftProvider = providerById.get(left.caseId);
        const rightProvider = providerById.get(right.caseId);
        const byContext = (rightProvider?.contextMessages.length ?? 0) - (leftProvider?.contextMessages.length ?? 0);
        if (byContext !== 0) return byContext;
        const byQuery = (rightProvider?.query.length ?? 0) - (leftProvider?.query.length ?? 0);
        return byQuery !== 0 ? byQuery : left.caseId.localeCompare(right.caseId);
      })[0];
    if (!natural) throw new Error(`${rule.teamId}: no natural coding negative`);

    caseIds.push(memoryCase.caseId, skillCase.caseId, knowledgeCase.caseId, pair.negativeCaseId, natural.caseId);
  }

  if (caseIds.length !== 40 || new Set(caseIds).size !== 40) {
    throw new Error("formal Dev smoke preregistration must contain 40 unique case ids");
  }
  for (const caseId of caseIds) {
    if (!bindingById.has(caseId)) throw new Error(`smoke case has no runtime binding: ${caseId}`);
  }
  const frozenCaseIds = Object.freeze(caseIds);
  const sha256 = canonicalSha256({
    caseIds: frozenCaseIds,
    selectionContract: FORMAL_SMOKE_SELECTION_CONTRACT,
  });
  return Object.freeze({
    caseIds: frozenCaseIds,
    selectionContract: FORMAL_SMOKE_SELECTION_CONTRACT,
    sha256,
    formalMetricEligible: false as const,
  });
}

export function serializeFormalSmokePreregistration(value: FormalSmokePreregistration): string {
  return `${JSON.stringify({
    caseIds: value.caseIds,
    selectionContract: value.selectionContract,
    sha256: value.sha256,
  }, null, 2)}\n`;
}
