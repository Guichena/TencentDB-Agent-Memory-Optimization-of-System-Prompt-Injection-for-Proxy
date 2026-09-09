/** Formal V2 identity-aware visibility resolver. */
import type {
  BusinessAgent,
  FormalWorldContract,
  KnowledgeAsset,
  L0Conversation,
  L1Memory,
  L2Scene,
  L3Profile,
  RuntimeIdentity,
  SkillAsset,
} from "./formal-schema.js";

export type FormalMemoryAsset = L0Conversation | L1Memory | L2Scene | L3Profile;

/** The resolver has no need for a client label or session id. */
export type FormalSessionSelection = Pick<RuntimeIdentity, "spaceId" | "teamId" | "userId" | "agentId" | "taskId">;

/** The provider-relevant asset set for one selected Team/Agent/Task. */
export interface ResolvedVisibleSnapshot {
  identity: FormalSessionSelection;
  /** Current Agent first, followed by stable imported Memory owners. */
  memoryOwnerAgentIds: string[];
  l0Conversations: L0Conversation[];
  l1Memories: L1Memory[];
  l2Scenes: L2Scene[];
  l3Profiles: L3Profile[];
  memories: FormalMemoryAsset[];
  /** Frozen `/listing` result: current Agent's explicitly listed own Skills. */
  listedSkills: SkillAsset[];
  /** Meta visibility A: same-Team Skills whose visibility is `team`. */
  teamVisibleSkills: SkillAsset[];
  /** Core-list B: every current-Agent owned Skill, including private Skills. */
  currentAgentOwnSkills: SkillAsset[];
  /** Search whitelist A ∪ B. */
  teamSearchSkills: SkillAsset[];
  /** All visible Skill assets; aliases the search whitelist, not the listing. */
  skills: SkillAsset[];
  /** Only Knowledge fixed to the current Agent. */
  knowledge: KnowledgeAsset[];
}

function fail(message: string): never {
  throw new Error(`Formal visibility: ${message}`);
}

function uniqueIds(ids: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) fail(`${label} contains an empty id`);
    if (seen.has(id)) fail(`${label} contains duplicate id ${id}`);
    seen.add(id);
  }
  return [...ids];
}

function sortedByAssetId<T extends { assetId: string }>(assets: readonly T[]): T[] {
  return [...assets].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function ownedByVisibleMemoryAgent<T extends { ownerAgentId: string; assetId: string }>(
  assets: readonly T[],
  owners: ReadonlySet<string>,
): T[] {
  return sortedByAssetId(assets.filter((asset) => owners.has(asset.ownerAgentId)));
}

function teamOf(assetOwnerId: string, agents: ReadonlyMap<string, BusinessAgent>): string | undefined {
  return agents.get(assetOwnerId)?.teamId;
}

function assertSameTeamAssets<T extends { assetId: string; ownerAgentId: string }>(
  assets: readonly T[], teamId: string, agents: ReadonlyMap<string, BusinessAgent>,
): void {
  for (const asset of assets) {
    if (teamOf(asset.ownerAgentId, agents) !== teamId) {
      fail(`asset ${asset.assetId} is not owned by selected Team ${teamId}`);
    }
  }
}

/**
 * Resolves exactly what production may inject or retrieve for one session init.
 * Team B assets are never a candidate set; a foreign import or binding fails
 * closed instead of becoming an invalid "distractor".
 */
export function resolveVisibleSnapshot(
  contract: FormalWorldContract,
  identity: FormalSessionSelection,
): ResolvedVisibleSnapshot {
  if (contract.world.spaceId !== identity.spaceId) {
    fail(`World belongs to Space ${contract.world.spaceId}, not selected Space ${identity.spaceId}`);
  }
  if (!contract.teams.some((team) => team.teamId === identity.teamId)) {
    fail(`selected Team ${identity.teamId} is absent from this World`);
  }
  if (!identity.userId) fail("selected userId is required for Session registration and Skill ACLs");
  const agent = contract.businessAgents.find((candidate) =>
    candidate.agentId === identity.agentId && candidate.teamId === identity.teamId,
  );
  if (!agent) fail(`selected Business Agent ${identity.agentId} is not in selected Team`);
  const task = contract.tasks.find((candidate) => candidate.taskId === identity.taskId);
  if (!task || task.teamId !== identity.teamId || !task.eligibleAgentIds.includes(identity.agentId)) {
    fail(`selected Task ${identity.taskId} is not eligible for selected Team/Business Agent`);
  }

  const agentsById = new Map(contract.businessAgents.map((candidate) => [candidate.agentId, candidate]));
  const imported = uniqueIds(agent.importedMemoryAgentIds, "imported Memory agents");
  if (imported.length > 2) fail("a Business Agent may import Memory from at most two Agents");
  for (const importedAgentId of imported) {
    if (importedAgentId === identity.agentId) fail("a Business Agent may not import its own Memory");
    if (teamOf(importedAgentId, agentsById) !== identity.teamId) {
      fail(`imported Memory Agent ${importedAgentId} is not in selected Team`);
    }
  }

  const memoryOwnerAgentIds = [identity.agentId, ...imported.sort()];
  const memoryOwners = new Set(memoryOwnerAgentIds);
  const l0Conversations = ownedByVisibleMemoryAgent(contract.assets.l0Conversations, memoryOwners);
  const l1Memories = ownedByVisibleMemoryAgent(contract.assets.l1Memories, memoryOwners);
  const l2Scenes = ownedByVisibleMemoryAgent(contract.assets.l2Scenes, memoryOwners);
  const l3Profiles = ownedByVisibleMemoryAgent(contract.assets.l3Profiles, memoryOwners);
  const memories = sortedByAssetId([...l0Conversations, ...l1Memories, ...l2Scenes, ...l3Profiles]);

  const skillById = new Map(contract.assets.skills.map((skill) => [skill.assetId, skill]));
  const listedSkillIds = uniqueIds(agent.boundSkillIds, "listed Skill ids");
  for (const skillId of listedSkillIds) {
    const skill = skillById.get(skillId);
    if (!skill || skill.ownerAgentId !== identity.agentId) {
      fail(`listed Skill ${skillId} is not owned by current Business Agent`);
    }
  }
  const listedSet = new Set(listedSkillIds);
  const listedSkills = sortedByAssetId(contract.assets.skills.filter((skill) => listedSet.has(skill.assetId)));
  const teamVisibleSkills = sortedByAssetId(contract.assets.skills.filter((skill) =>
    teamOf(skill.ownerAgentId, agentsById) === identity.teamId && skill.visibility === "team",
  ));
  const currentAgentOwnSkills = sortedByAssetId(contract.assets.skills.filter((skill) =>
    skill.ownerAgentId === identity.agentId,
  ));
  const teamSearchSkills = sortedByAssetId(
    [...new Map([...teamVisibleSkills, ...currentAgentOwnSkills].map((skill) => [skill.assetId, skill])).values()],
  );
  const skills = teamSearchSkills;

  const fixedKnowledgeIds = new Set(uniqueIds(agent.fixedKnowledgeIds, "fixed Knowledge ids"));
  const knowledge = sortedByAssetId(contract.assets.knowledge.filter((item) =>
    teamOf(item.ownerAgentId, agentsById) === identity.teamId
    && fixedKnowledgeIds.has(item.assetId)
    && item.bindings.some((binding) => binding.agentId === identity.agentId && binding.visibility === "fixed"),
  ));

  assertSameTeamAssets(memories, identity.teamId, agentsById);
  assertSameTeamAssets(skills, identity.teamId, agentsById);
  assertSameTeamAssets(knowledge, identity.teamId, agentsById);
  return {
    identity: { ...identity }, memoryOwnerAgentIds,
    l0Conversations, l1Memories, l2Scenes, l3Profiles, memories,
    listedSkills, teamVisibleSkills, currentAgentOwnSkills, teamSearchSkills, skills, knowledge,
  };
}

export const resolveFormalVisibleSnapshot = resolveVisibleSnapshot;
