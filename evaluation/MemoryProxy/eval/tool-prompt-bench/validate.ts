import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalFixture, ToolPromptEvalCase } from "./schema.js";

const root = dirname(fileURLToPath(import.meta.url));

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON: ${String(error)}`);
      }
    });
}

const cases = [
  ...readJsonl<ToolPromptEvalCase>(resolve(root, "cases", "dev.jsonl")),
  ...readJsonl<ToolPromptEvalCase>(resolve(root, "cases", "test.jsonl")),
];
const fixtures = readJsonl<EvalFixture>(resolve(root, "fixtures", "fixtures.jsonl"));
const manifest = JSON.parse(readFileSync(resolve(root, "sources", "manifest.json"), "utf8")) as {
  sources: Array<{ id: string; revision: string; license: string }>;
};
const datasetManifest = JSON.parse(readFileSync(resolve(root, "dataset-manifest.json"), "utf8")) as {
  schemaVersion: string;
  files: Record<string, { sha256: string; bytes: number }>;
};

const errors: string[] = [];
const seenCaseIds = new Set<string>();
const seenFixtureIds = new Set<string>();
const sourceIds = new Set(manifest.sources.map((source) => source.id));
const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
const normalizedQueries = new Map<string, string>();
const groupSplits = new Map<string, string>();

const expectedSourceUsage = new Map<string, ToolPromptEvalCase["source"]["usage"]>([
  ["human-eval", "adapted"],
  ["longmemeval-cleaned", "adapted"],
  ["skillsbench", "adapted"],
  ["bfcl", "structural-template"],
  ["crosscodeeval", "structural-template"],
  ["metatool", "structural-template"],
  ["project-authored", "project-authored"],
]);

const expected = {
  dev: { memory_positive: 15, skill_positive: 15, knowledge_positive: 10, noTool: 20, total: 60 },
  test: { memory_positive: 10, skill_positive: 10, knowledge_positive: 6, noTool: 14, total: 40 },
};
const expectedSourceCounts: Record<string, number> = {
  bfcl: 10,
  crosscodeeval: 9,
  "human-eval": 15,
  "longmemeval-cleaned": 11,
  metatool: 8,
  "project-authored": 22,
  skillsbench: 25,
};
const expectedCategoryCounts: Record<string, number> = {
  memory_positive: 25,
  skill_positive: 25,
  knowledge_positive: 16,
  self_contained_coding: 15,
  answer_already_available: 7,
  superficial_overlap: 8,
  wrong_tool_hard_negative: 4,
};

const endpointByTool = new Map<string, string>([
  ["tdai_memory_search", "/memory-bridge/v3/atomic/search"],
  ["tdai_atomic_query", "/memory-bridge/v3/atomic/query"],
  ["tdai_conversation_search", "/memory-bridge/v3/conversation/search"],
  ["tdai_conversation_query", "/memory-bridge/v3/conversation/query"],
  ["tdai_scenario_ls", "/memory-bridge/v3/scenario/ls"],
  ["tdai_read_scene", "/memory-bridge/v3/scenario/read"],
  ["skill_search", "/skill-bridge/v3/skill/search"],
  ["skill_view", "/skill-bridge/v3/skill/get-by-name"],
  ["skill_files_read", "/skill-bridge/v3/skill/files/read"],
  ["knowledge_tools_list", "/tools/list"],
  ["knowledge_tools_call", "/tools/call"],
]);
const familyByTool = new Map<string, "memory" | "skill" | "knowledge">([
  ["tdai_memory_search", "memory"],
  ["tdai_atomic_query", "memory"],
  ["tdai_conversation_search", "memory"],
  ["tdai_conversation_query", "memory"],
  ["tdai_scenario_ls", "memory"],
  ["tdai_read_scene", "memory"],
  ["skill_search", "skill"],
  ["skill_view", "skill"],
  ["skill_files_read", "skill"],
  ["knowledge_tools_list", "knowledge"],
  ["knowledge_tools_call", "knowledge"],
]);
const fixtureById = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture]));
const fixtureReferenceCounts = new Map<string, number>();
const knowledgeIdPattern = /^(?:cg|wiki)-[0-9a-z]{8}$/;
const explicitSkillCuePattern = /\b(?:skill_search|skill_view|skill_files_read|available_skills|listed skill|search the team library|open the listed)\b/i;

if (fixtures.length !== 100) errors.push(`expected 100 fixtures, got ${fixtures.length}`);
for (const fixture of fixtures) {
  if (seenFixtureIds.has(fixture.fixtureId)) errors.push(`${fixture.fixtureId}: duplicate fixtureId`);
  seenFixtureIds.add(fixture.fixtureId);
}

for (const item of cases) {
  if (seenCaseIds.has(item.caseId)) errors.push(`${item.caseId}: duplicate caseId`);
  seenCaseIds.add(item.caseId);

  if (!item.query.trim()) errors.push(`${item.caseId}: empty query`);
  if (!item.capabilities.chatMemory || !item.capabilities.skill || !item.capabilities.llmWiki || !item.capabilities.codeGraph) {
    errors.push(`${item.caseId}: primary benchmark requires all three read-only TDAI families to be visible`);
  }
  if (item.capabilities.allowLlmWrite || !item.capabilities.allowLlmExtract) {
    errors.push(`${item.caseId}: primary V0 benchmark disables writes but preserves the currently exposed manual-extract tool`);
  }
  if (item.category === "skill_positive" && explicitSkillCuePattern.test(item.query)) {
    errors.push(`${item.caseId}: query leaks the Skill tool or listing action`);
  }
  if (!item.annotationReason.trim()) errors.push(`${item.caseId}: missing annotationReason`);
  if (!sourceIds.has(item.source.dataset)) errors.push(`${item.caseId}: unknown source ${item.source.dataset}`);
  if (expectedSourceUsage.get(item.source.dataset) !== item.source.usage) {
    errors.push(`${item.caseId}: source usage does not match the dataset selection policy`);
  }
  const sourceMeta = sourceById.get(item.source.dataset);
  if (sourceMeta && sourceMeta.revision !== item.source.revision) errors.push(`${item.caseId}: source revision does not match manifest`);
  if (sourceMeta && sourceMeta.license !== item.source.license) errors.push(`${item.caseId}: source license does not match manifest`);
  if (item.fixtureIds.length !== 1) errors.push(`${item.caseId}: expected exactly one isolated fixture`);
  for (const fixtureId of item.fixtureIds) {
    if (!seenFixtureIds.has(fixtureId)) errors.push(`${item.caseId}: missing fixture ${fixtureId}`);
    fixtureReferenceCounts.set(fixtureId, (fixtureReferenceCounts.get(fixtureId) ?? 0) + 1);
  }

  const normalized = item.query.toLowerCase().replace(/\s+/g, " ").trim();
  const duplicate = normalizedQueries.get(normalized);
  if (duplicate) errors.push(`${item.caseId}: duplicate query with ${duplicate}`);
  normalizedQueries.set(normalized, item.caseId);

  const priorSplit = groupSplits.get(item.groupId);
  if (priorSplit && priorSplit !== item.split) errors.push(`${item.caseId}: group ${item.groupId} leaks across splits`);
  groupSplits.set(item.groupId, item.split);

  const isPositive = item.category.endsWith("_positive");
  if (isPositive) {
    if (!item.gold.needTdaiTool || item.gold.family === null) errors.push(`${item.caseId}: positive case lacks family`);
    if (item.gold.allowedFirstActions.length === 0) errors.push(`${item.caseId}: positive case lacks first action`);
    if (item.gold.allowedSequences.length === 0) errors.push(`${item.caseId}: positive case lacks sequence`);
    for (const first of item.gold.allowedFirstActions) {
      if (endpointByTool.get(first.tool) !== first.endpoint) errors.push(`${item.caseId}: endpoint mismatch for ${first.tool}`);
      if (familyByTool.get(first.tool) !== item.gold.family) errors.push(`${item.caseId}: ${first.tool} does not belong to ${item.gold.family}`);
      const required = new Set(first.argumentRules?.requiredFields ?? []);
      const forbidden = new Set(first.argumentRules?.forbiddenFields ?? []);
      for (const field of required) {
        if (forbidden.has(field)) errors.push(`${item.caseId}: argument ${field} is both required and forbidden`);
      }
    }
    for (const sequence of item.gold.allowedSequences) {
      if (sequence.length === 0) errors.push(`${item.caseId}: positive case has an empty sequence`);
      if (!item.gold.allowedFirstActions.some((first) => first.tool === sequence[0])) {
        errors.push(`${item.caseId}: sequence does not begin with an allowed first action`);
      }
      if (sequence.length > item.gold.maxTdaiCalls) errors.push(`${item.caseId}: sequence exceeds maxTdaiCalls`);
      for (const tool of sequence) {
        if (familyByTool.get(tool) !== item.gold.family) errors.push(`${item.caseId}: sequence tool ${tool} has wrong family`);
      }
    }
    if (item.gold.family !== "knowledge") {
      const sequence = item.gold.allowedSequences[0] ?? [];
      const followups = item.gold.expectedFollowupActions ?? [];
      if (followups.length !== Math.max(0, sequence.length - 1)) {
        errors.push(`${item.caseId}: follow-up action count does not match the Gold sequence`);
      }
      followups.forEach((followup, index) => {
        if (followup.tool !== sequence[index + 1]) {
          errors.push(`${item.caseId}: follow-up ${index + 1} does not match the Gold sequence`);
        }
        if (endpointByTool.get(followup.tool) !== followup.endpoint) {
          errors.push(`${item.caseId}: endpoint mismatch for follow-up ${followup.tool}`);
        }
        const required = new Set(followup.argumentRules?.requiredFields ?? []);
        const forbidden = new Set(followup.argumentRules?.forbiddenFields ?? []);
        for (const field of required) {
          if (forbidden.has(field)) errors.push(`${item.caseId}: follow-up argument ${field} is both required and forbidden`);
        }
      });
    } else if (item.gold.expectedFollowupActions?.length) {
      errors.push(`${item.caseId}: Knowledge case must use expectedKnowledgeCalls for nested call bodies`);
    }
    const longestSequence = Math.max(...item.gold.allowedSequences.map((sequence) => sequence.length));
    if (item.gold.maxTdaiCalls !== longestSequence) {
      errors.push(`${item.caseId}: maxTdaiCalls must equal the longest allowed sequence`);
    }
    if (item.gold.family === "knowledge") {
      const expectedCalls = item.gold.expectedKnowledgeCalls ?? [];
      const callCount = item.gold.allowedSequences[0]?.filter((tool) => tool === "knowledge_tools_call").length ?? 0;
      if (expectedCalls.length !== callCount) {
        errors.push(`${item.caseId}: expectedKnowledgeCalls does not match /tools/call count`);
      }
      for (const expectedCall of expectedCalls) {
        const required = new Set(expectedCall.paramRules.requiredFields ?? []);
        const forbidden = new Set(expectedCall.paramRules.forbiddenFields ?? []);
        for (const field of required) {
          if (forbidden.has(field)) errors.push(`${item.caseId}: Knowledge param ${field} is both required and forbidden`);
        }
      }
    } else if (item.gold.expectedKnowledgeCalls?.length) {
      errors.push(`${item.caseId}: non-Knowledge case declares Knowledge sub-tools`);
    }
  } else {
    if (item.gold.needTdaiTool || item.gold.family !== null) errors.push(`${item.caseId}: no-tool case has a tool family`);
    if (item.gold.allowedFirstActions.length > 0) errors.push(`${item.caseId}: no-tool case allows a first action`);
    if (item.gold.allowedSequences.length > 0) errors.push(`${item.caseId}: no-tool case allows a sequence`);
    if (item.gold.maxTdaiCalls !== 0) errors.push(`${item.caseId}: no-tool maxTdaiCalls must be zero`);
  }

  const fixture = fixtureById.get(item.fixtureIds[0]);
  if (fixture) {
    if (item.gold.family === "memory") {
      const hasMemoryAsset = Boolean(
        fixture.assets.atomicMemories?.length
        || fixture.assets.conversations?.length
        || fixture.assets.sceneIndex?.length
        || fixture.assets.scenes?.length,
      );
      if (!hasMemoryAsset) errors.push(`${item.caseId}: memory positive has no Memory fixture data`);

      const first = item.gold.allowedFirstActions[0];
      const exact = first?.argumentRules?.exactValues ?? {};
      if (first?.tool === "tdai_conversation_query") {
        const session = fixture.assets.conversations?.find((entry) => entry.session_id === exact.session_id);
        const messages = Array.isArray(session?.messages) ? session.messages : [];
        const offset = typeof exact.offset === "number" ? exact.offset : 0;
        if (messages.length <= offset) errors.push(`${item.caseId}: conversation fixture cannot satisfy offset ${offset}`);
      }
      if (first?.tool === "tdai_atomic_query") {
        const matching = (fixture.assets.atomicMemories ?? []).filter((memory) => {
          if (typeof exact.type === "string" && memory.type !== exact.type) return false;
          const timestamp = typeof memory.timestamp === "string" ? memory.timestamp : undefined;
          if (typeof exact.time_start === "string" && (!timestamp || timestamp < exact.time_start)) return false;
          if (typeof exact.time_end === "string" && (!timestamp || timestamp >= exact.time_end)) return false;
          return true;
        });
        const offset = typeof exact.offset === "number" ? exact.offset : 0;
        if (matching.length <= offset) errors.push(`${item.caseId}: atomic fixture cannot satisfy filters and offset ${offset}`);
      }
      if (first?.tool === "tdai_scenario_ls") {
        const prefix = typeof exact.path_prefix === "string" ? exact.path_prefix : "";
        if (!fixture.assets.scenes?.some((scene) => typeof scene.path === "string" && scene.path.startsWith(prefix))) {
          errors.push(`${item.caseId}: no scene can be discovered under prefix ${prefix}`);
        }
      }
      if (first?.tool === "tdai_read_scene") {
        const expectedPath = typeof exact.path === "string" ? exact.path : undefined;
        const indexedPaths = new Set((fixture.assets.sceneIndex ?? []).map((entry) => entry.path));
        const scenePaths = new Set((fixture.assets.scenes ?? []).map((entry) => entry.path));
        if (expectedPath && (!indexedPaths.has(expectedPath) || !scenePaths.has(expectedPath))) {
          errors.push(`${item.caseId}: exact scene path is not present in both index and scene data`);
        }
        if (!expectedPath && first.argumentRules?.pathFromFixture) {
          const sharedPath = [...indexedPaths].some((path) => scenePaths.has(path));
          if (!sharedPath) errors.push(`${item.caseId}: no injected scene path resolves to fixture content`);
        }
      }
      for (const followup of item.gold.expectedFollowupActions ?? []) {
        if (followup.tool !== "tdai_read_scene") continue;
        const path = followup.argumentRules?.exactValues?.path;
        const scenePaths = new Set((fixture.assets.scenes ?? []).map((entry) => entry.path));
        if (typeof path !== "string" || !scenePaths.has(path)) {
          errors.push(`${item.caseId}: scenario discovery follow-up has no resolvable path`);
        }
        if (!followup.argumentRules?.valueFromPreviousStep) {
          errors.push(`${item.caseId}: discovered scene path is not bound to the previous response`);
        }
      }
    }
    if (item.gold.family === "skill") {
      const skills = fixture.assets.skills;
      if (!skills || skills.listed.length + skills.teamLibrary.length === 0) errors.push(`${item.caseId}: skill positive has no Skill fixture data`);
      const goldSkills = skills?.teamLibrary.filter((skill) => skill.gold_asset === true) ?? [];
      if (goldSkills.length !== 1) errors.push(`${item.caseId}: expected exactly one marked Gold Skill`);
      const goldSkill = goldSkills[0];
      const listedNames = skills?.listed.map((skill) => skill.name) ?? [];
      if (goldSkill) {
        const isListed = listedNames.includes(goldSkill.name);
        if (item.preconditions.goldSkillInListing !== isListed) errors.push(`${item.caseId}: Gold Skill listing precondition is false`);
        const firstTool = item.gold.allowedFirstActions[0]?.tool;
        if (firstTool === "skill_view" && !isListed) errors.push(`${item.caseId}: direct view Gold Skill is not listed`);
        if (firstTool === "skill_search" && isListed) errors.push(`${item.caseId}: search is redundant because Gold Skill is listed`);
        if (item.gold.allowedSequences.some((sequence) => sequence.includes("skill_files_read"))) {
          const manifest = Array.isArray(goldSkill.manifest) ? goldSkill.manifest : [];
          const files = goldSkill.files && typeof goldSkill.files === "object" ? goldSkill.files as Record<string, unknown> : {};
          if (manifest.length === 0) errors.push(`${item.caseId}: files_read sequence has no manifest resource`);
          for (const resource of manifest) {
            if (!resource || typeof resource !== "object") continue;
            const path = (resource as Record<string, unknown>).path;
            if (typeof path !== "string" || !(path in files)) errors.push(`${item.caseId}: manifest resource has no fixture file content`);
          }
        }
        for (const followup of item.gold.expectedFollowupActions ?? []) {
          if (followup.tool === "skill_view") {
            if (followup.argumentRules?.exactValues?.skill_name !== goldSkill.name || !followup.argumentRules?.valueFromPreviousStep) {
              errors.push(`${item.caseId}: searched Skill is not bound to the search result`);
            }
          }
          if (followup.tool === "skill_files_read") {
            const exact = followup.argumentRules?.exactValues ?? {};
            const manifestPaths = new Set((Array.isArray(goldSkill.manifest) ? goldSkill.manifest : []).map((entry) => entry?.path));
            if (exact.skill_id !== goldSkill.skill_id || !manifestPaths.has(exact.path) || !followup.argumentRules?.valueFromPreviousStep) {
              errors.push(`${item.caseId}: Skill file read is not bound to the viewed manifest`);
            }
          }
        }
      }
      const expectedName = item.gold.allowedFirstActions[0]?.argumentRules?.exactValues?.skill_name;
      if (typeof expectedName === "string" && skills) {
        const teamNames = skills.teamLibrary.map((skill) => skill.name);
        if (item.preconditions.goldSkillInListing && !listedNames.includes(expectedName)) {
          errors.push(`${item.caseId}: Gold Skill ${expectedName} is not in listing`);
        }
        if (!item.preconditions.goldSkillInListing && !teamNames.includes(expectedName)) {
          errors.push(`${item.caseId}: Gold Skill ${expectedName} is not in team library`);
        }
      }
    }
    if (item.gold.family === "knowledge" && !fixture.assets.knowledge?.length) {
      errors.push(`${item.caseId}: knowledge positive has no Knowledge fixture data`);
    }
    if (item.gold.family === "knowledge") {
      const expectedId = item.gold.allowedFirstActions[0]?.argumentRules?.exactValues?.knowledge_id;
      const resource = fixture.assets.knowledge?.find((candidate) => candidate.knowledge_id === expectedId);
      if (!resource) {
        errors.push(`${item.caseId}: Gold Knowledge resource ${String(expectedId)} is absent`);
      } else {
        if (typeof resource.knowledge_id !== "string" || !knowledgeIdPattern.test(resource.knowledge_id)) {
          errors.push(`${item.caseId}: Knowledge id does not match the service contract`);
        }
        if (typeof resource.service_url !== "string" || !resource.service_url) errors.push(`${item.caseId}: Knowledge resource has no service_url`);
        if (resource.type === "code-graph" && resource.repo_slug !== "TencentCloud/TencentDB-Agent-Memory") {
          errors.push(`${item.caseId}: code-graph does not match the benchmark workspace`);
        }
        const toolNames = Array.isArray(resource.tools)
          ? resource.tools.map((tool) => typeof tool === "string" ? tool : tool?.name).filter(Boolean)
          : [];
        for (const expectedCall of item.gold.expectedKnowledgeCalls ?? []) {
          if (!toolNames.includes(expectedCall.toolName)) {
            errors.push(`${item.caseId}: Knowledge fixture does not expose Gold sub-tool ${expectedCall.toolName}`);
          }
          const tool = Array.isArray(resource.tools)
            ? resource.tools.find((candidate) => candidate && typeof candidate === "object" && candidate.name === expectedCall.toolName)
            : undefined;
          const params = tool && typeof tool === "object" && tool.params && typeof tool.params === "object"
            ? tool.params as Record<string, unknown>
            : {};
          for (const field of expectedCall.paramRules.requiredFields ?? []) {
            if (!(field in params)) errors.push(`${item.caseId}: Gold parameter ${field} is not exposed by ${expectedCall.toolName}`);
          }
        }
        if (resource.type === "wiki") {
          if (!String(resource.knowledge_id).startsWith("wiki-")) errors.push(`${item.caseId}: wiki resource has a code-graph id`);
          if ((item.gold.expectedKnowledgeCalls ?? []).map((call) => call.toolName).join(">") !== "search>read_page") {
            errors.push(`${item.caseId}: wiki lookup must use search then read_page`);
          }
        }
        if (resource.type === "code-graph" && !String(resource.knowledge_id).startsWith("cg-")) {
          errors.push(`${item.caseId}: code-graph resource has a wiki id`);
        }
      }
    }
    if (item.gold.allowedFirstActions[0]?.tool === "tdai_read_scene" && item.preconditions.scenePathInjected) {
      if (!fixture.assets.sceneIndex?.length) errors.push(`${item.caseId}: read_scene path is not injected`);
    }
    if (!item.gold.needTdaiTool) {
      const hasDistractor = Boolean(
        fixture.assets.atomicMemories?.length
        || fixture.assets.skills?.listed.length
        || fixture.assets.knowledge?.length,
      );
      if (!hasDistractor) errors.push(`${item.caseId}: no-tool case has no TDAI distractor asset`);
    }
  }
}

for (const split of ["dev", "test"] as const) {
  const splitCases = cases.filter((item) => item.split === split);
  const noTool = splitCases.filter((item) => !item.category.endsWith("_positive")).length;
  const actual = {
    memory_positive: splitCases.filter((item) => item.category === "memory_positive").length,
    skill_positive: splitCases.filter((item) => item.category === "skill_positive").length,
    knowledge_positive: splitCases.filter((item) => item.category === "knowledge_positive").length,
    noTool,
    total: splitCases.length,
  };
  for (const [key, value] of Object.entries(expected[split])) {
    if (actual[key as keyof typeof actual] !== value) {
      errors.push(`${split}: expected ${key}=${value}, got ${actual[key as keyof typeof actual]}`);
    }
  }
}

const fixtureSplit = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture.split]));
for (const item of cases) {
  for (const fixtureId of item.fixtureIds) {
    if (fixtureSplit.get(fixtureId) !== item.split) errors.push(`${item.caseId}: fixture ${fixtureId} crosses split`);
  }
}

for (const fixture of fixtures) {
  const references = fixtureReferenceCounts.get(fixture.fixtureId) ?? 0;
  if (references !== 1) errors.push(`${fixture.fixtureId}: expected one case reference, got ${references}`);
  for (const resource of fixture.assets.knowledge ?? []) {
    if (typeof resource.knowledge_id !== "string" || !knowledgeIdPattern.test(resource.knowledge_id)) {
      errors.push(`${fixture.fixtureId}: invalid Knowledge fixture id ${String(resource.knowledge_id)}`);
    }
  }
}

const countBy = (field: "source" | "category", value: string): number => cases.filter((item) => (
  field === "source" ? item.source.dataset === value : item.category === value
)).length;
for (const [sourceId, expectedCount] of Object.entries(expectedSourceCounts)) {
  const actual = countBy("source", sourceId);
  if (actual !== expectedCount) errors.push(`source ${sourceId}: expected ${expectedCount}, got ${actual}`);
}
for (const [category, expectedCount] of Object.entries(expectedCategoryCounts)) {
  const actual = countBy("category", category);
  if (actual !== expectedCount) errors.push(`category ${category}: expected ${expectedCount}, got ${actual}`);
}
const languageCounts = Object.fromEntries(["zh", "en", "mixed"].map((language) => [
  language,
  cases.filter((item) => item.language === language).length,
]));
if (languageCounts.zh !== 60 || languageCounts.en !== 40 || languageCounts.mixed !== 0) {
  errors.push(`language distribution changed: ${JSON.stringify(languageCounts)}`);
}
const multiTurnCount = cases.filter((item) => item.contextMessages?.length).length;
if (multiTurnCount !== 14) errors.push(`expected 14 multi-turn cases, got ${multiTurnCount}`);

for (const [relativePath, expectedFile] of Object.entries(datasetManifest.files)) {
  const content = readFileSync(resolve(root, relativePath));
  const actualHash = createHash("sha256").update(content).digest("hex");
  if (actualHash !== expectedFile.sha256) errors.push(`${relativePath}: dataset hash mismatch`);
  if (content.byteLength !== expectedFile.bytes) errors.push(`${relativePath}: dataset byte count mismatch`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const byCategory = Object.fromEntries(
    [...new Set(cases.map((item) => item.category))]
      .sort()
      .map((category) => [category, cases.filter((item) => item.category === category).length]),
  );
  const bySource = Object.fromEntries(
    [...new Set(cases.map((item) => item.source.dataset))]
      .sort()
      .map((dataset) => [dataset, cases.filter((item) => item.source.dataset === dataset).length]),
  );
  console.log("TDAI-ToolPromptBench dataset is valid");
  console.log(JSON.stringify({ cases: cases.length, fixtures: fixtures.length, expected, byCategory, bySource }, null, 2));
}
