/**
 * Gold-blind R03 asset restore planning.
 *
 * `projectFormalAssetRestoreSource` is the sole offline boundary allowed to
 * inspect a frozen authoring contract. It removes Cases, Gold, pairs, evidence,
 * and run records. Runtime restore code must accept only the plan returned by
 * `compileFormalAssetRestorePlan`, never FormalWorldContract.
 */
import { createHash } from "node:crypto";

import type {
  BusinessAgent,
  FormalAssets,
  FormalSplit,
  FormalTask,
  FormalTeam,
  FormalWorldContract,
  KnowledgeAsset,
  L0Conversation,
  L1Memory,
  L2Scene,
  L3Profile,
  SkillAsset,
  VisibleAssetSet,
  WorkspaceRef,
  WorldSnapshot,
} from "../worlds/formal-schema.js";
import { assertFormalWorldContract } from "../worlds/formal-schema.js";
import { canonicalJson, canonicalSha256 } from "../formal-runtime/canonical.js";
import type { FormalCaseBinding } from "../formal-runtime/build-case-bindings.js";
import type {
  FormalAssetRestorePlan,
  FormalDataRevisionReceipt,
  PlannedRestoreAsset,
  RestorePlanAction,
  RestorePlanRequirement,
  RuntimeValueRef,
} from "./restore-plan-contract.js";

export type {
  FormalAssetRestorePlan,
  FormalDataRevisionReceipt,
  FormalRestoreRuntimePolicy,
  FormalRestoreVisibleAssetSet,
  ParseFormalAssetRestorePlanOptions,
  PlannedRestoreAsset,
  RestorePlanAction,
  RestorePlanRequirement,
  RuntimeValueRef,
} from "./restore-plan-contract.js";

const SELECTION_BRAND: unique symbol = Symbol("formal-asset-restore-selection");

export interface FormalAssetRestoreSelection {
  readonly split: FormalSplit;
  readonly hiddenAuthorized: boolean;
  readonly [SELECTION_BRAND]: true;
}

type SafeWorld = Readonly<{
  worldId: string;
  spaceId: string;
  status: "draft" | "frozen";
  worldAsOf: string;
  snapshotId: string;
  runtimePolicy: FormalWorldContract["world"]["runtimePolicy"];
  contentHash: string;
}>;
type SafeTeam = Omit<FormalTeam, "sourceEvidenceIds">;
type SafeAgent = Omit<BusinessAgent, "sourceEvidenceIds">;
type SafeProjectRef = Omit<FormalTask["projectRef"], "sourceEvidenceIds">;
type SafeTask = Omit<FormalTask, "sourceEvidenceIds" | "projectRef"> & { projectRef: SafeProjectRef };
type SafeMessage = Omit<L0Conversation["messages"][number], "sourceEvidenceIds">;
type SafeL0 = Omit<L0Conversation, "sourceEvidenceIds" | "messages"> & { messages: SafeMessage[] };
type SafeL1 = Omit<L1Memory, "sourceEvidenceIds" | "supportingMessageIds" | "codeEvidenceLocators" | "testEvidenceLocators">;
type SafeL2 = Omit<L2Scene, "sourceEvidenceIds" | "supportingSessionIds">;
type SafeL3 = Omit<L3Profile, "sourceEvidenceIds">;
type SafeSkill = Omit<SkillAsset, "sourceEvidenceIds" | "supportingSessionIds" | "codeEvidenceLocators" | "testEvidenceLocators">;
type SafeKnowledge = Omit<KnowledgeAsset, "sourceEvidenceIds">;

export interface FormalAssetRestoreSource {
  readonly schemaVersion: "task1.formal-asset-restore-source.v1";
  readonly split: FormalSplit;
  readonly revision: FormalDataRevisionReceipt;
  readonly world: SafeWorld;
  readonly snapshot: WorldSnapshot;
  readonly teams: readonly SafeTeam[];
  readonly businessAgents: readonly SafeAgent[];
  readonly tasks: readonly SafeTask[];
  readonly assets: Readonly<{
    l0Conversations: readonly SafeL0[];
    l1Memories: readonly SafeL1[];
    l2Scenes: readonly SafeL2[];
    l3Profiles: readonly SafeL3[];
    skills: readonly SafeSkill[];
    knowledge: readonly SafeKnowledge[];
  }>;
  readonly sourceProjectionSha256: string;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function requireSelection(selection: FormalAssetRestoreSelection): void {
  if (!selection || selection[SELECTION_BRAND] !== true) {
    throw new Error("Formal asset restore: selection must be authorized by this module");
  }
  if (selection.split === "hidden_test" && !selection.hiddenAuthorized) {
    throw new Error("Formal asset restore: hidden_test is not authorized");
  }
}

export function authorizeFormalAssetRestoreSelection(input: {
  split: FormalSplit;
  allowHiddenTest?: true;
}): FormalAssetRestoreSelection {
  if (input.split === "hidden_test" && input.allowHiddenTest !== true) {
    throw new Error("Formal asset restore: hidden_test access must be explicitly authorized");
  }
  return deepFreeze({
    split: input.split,
    hiddenAuthorized: input.split === "hidden_test",
    [SELECTION_BRAND]: true as const,
  });
}

function stripAgent(agent: BusinessAgent): SafeAgent {
  const { sourceEvidenceIds: _omitted, ...safe } = agent;
  return clone(safe);
}

function stripTask(task: FormalTask): SafeTask {
  const { sourceEvidenceIds: _taskEvidence, projectRef, ...safeTask } = task;
  const { sourceEvidenceIds: _projectEvidence, ...safeProject } = projectRef;
  return clone({ ...safeTask, projectRef: safeProject });
}

function stripAssets(assets: FormalAssets, allowedOwners: ReadonlySet<string>): FormalAssetRestoreSource["assets"] {
  const owner = <T extends { ownerAgentId: string }>(asset: T) => allowedOwners.has(asset.ownerAgentId);
  return {
    l0Conversations: assets.l0Conversations.filter(owner).map((asset) => {
      const { sourceEvidenceIds: _assetEvidence, messages, ...safe } = asset;
      return {
        ...safe,
        messages: messages.map((message) => {
          const { sourceEvidenceIds: _messageEvidence, ...safeMessage } = message;
          return safeMessage;
        }),
      };
    }),
    l1Memories: assets.l1Memories.filter(owner).map((asset) => {
      const { sourceEvidenceIds: _a, supportingMessageIds: _b, codeEvidenceLocators: _c, testEvidenceLocators: _d, ...safe } = asset;
      return safe;
    }),
    l2Scenes: assets.l2Scenes.filter(owner).map((asset) => {
      const { sourceEvidenceIds: _a, supportingSessionIds: _b, ...safe } = asset;
      return safe;
    }),
    l3Profiles: assets.l3Profiles.filter(owner).map((asset) => {
      const { sourceEvidenceIds: _a, ...safe } = asset;
      return safe;
    }),
    skills: assets.skills.filter(owner).map((asset) => {
      const { sourceEvidenceIds: _a, supportingSessionIds: _b, codeEvidenceLocators: _c, testEvidenceLocators: _d, ...safe } = asset;
      return safe;
    }),
    knowledge: assets.knowledge.filter(owner).map((asset) => {
      const { sourceEvidenceIds: _a, ...safe } = asset;
      return safe;
    }),
  };
}

export function projectFormalAssetRestoreSource(input: {
  selection: FormalAssetRestoreSelection;
  revision: FormalDataRevisionReceipt;
  contract: FormalWorldContract;
}): FormalAssetRestoreSource {
  requireSelection(input.selection);
  assertFormalWorldContract(input.contract);
  if (canonicalSha256(input.contract) !== input.revision.contractCanonicalSha256) {
    throw new Error("Formal asset restore: contract does not match the public frozen canonical hash");
  }
  if (input.contract.world.status !== "frozen") throw new Error("Formal asset restore: World must be frozen");
  const snapshotId = input.contract.world.snapshotIds[input.selection.split];
  const snapshot = input.contract.snapshots.find((candidate) => candidate.snapshotId === snapshotId);
  if (!snapshot || snapshot.split !== input.selection.split) {
    throw new Error(`Formal asset restore: missing ${input.selection.split} snapshot ${snapshotId}`);
  }
  if (canonicalSha256(snapshot) !== input.revision.snapshotCanonicalSha256) {
    throw new Error("Formal asset restore: split snapshot does not match the public frozen canonical hash");
  }
  const teams = input.contract.teams.filter((team) => team.split === input.selection.split);
  const teamIds = new Set(teams.map((team) => team.teamId));
  const agents = input.contract.businessAgents.filter((agent) => teamIds.has(agent.teamId));
  const agentIds = new Set(agents.map((agent) => agent.agentId));
  const tasks = input.contract.tasks.filter((task) => teamIds.has(task.teamId));
  const safeCore = {
    schemaVersion: "task1.formal-asset-restore-source.v1" as const,
    split: input.selection.split,
    revision: clone(input.revision),
    world: {
      worldId: input.contract.world.worldId,
      spaceId: input.contract.world.spaceId,
      status: input.contract.world.status,
      worldAsOf: input.contract.world.worldAsOf,
      snapshotId,
      runtimePolicy: clone(input.contract.world.runtimePolicy),
      contentHash: input.contract.world.contentHash,
    },
    snapshot: clone(snapshot),
    teams: sorted(teams.map((team) => {
      const { sourceEvidenceIds: _omitted, ...safe } = team;
      return clone(safe);
    }), (team) => team.teamId),
    businessAgents: sorted(agents.map(stripAgent), (agent) => agent.agentId),
    tasks: sorted(tasks.map(stripTask), (task) => task.taskId),
    assets: stripAssets(input.contract.assets, agentIds),
  };
  return deepFreeze({ ...safeCore, sourceProjectionSha256: canonicalSha256(safeCore) });
}

function runtimeRef($runtimeRef: string, logicalId?: string, actionId?: string): RuntimeValueRef {
  return deepFreeze({ $runtimeRef, ...(logicalId ? { logicalId } : {}), ...(actionId ? { actionId } : {}) });
}

function exactTextSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function opaqueTaskId(dataCommit: string, spaceId: string, teamId: string, sourceTaskId: string): string {
  return `task-${canonicalSha256({
    domain: "task1.formal-runtime.task-id.v1",
    dataCommit,
    spaceId,
    teamId,
    sourceTaskId,
  }).slice(0, 32)}`;
}

function actionId(prefix: string, logicalId: string): string {
  return `${prefix}-${canonicalSha256({ prefix, logicalId }).slice(0, 20)}`;
}

function assertSafeScenarioPath(path: string): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  if (!normalized || normalized.includes("\\") || normalized.includes("\0")
    || normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Formal asset restore: L2 path cannot be mapped safely: ${path}`);
  }
  return normalized;
}

type AnySafeAsset = SafeL0 | SafeL1 | SafeL2 | SafeL3 | SafeSkill | SafeKnowledge;
type CatalogEntry = {
  asset: AnySafeAsset;
  family: "memory" | "skill" | "knowledge";
  subtype: PlannedRestoreAsset["subtype"];
};

function assetCatalog(source: FormalAssetRestoreSource): Map<string, CatalogEntry> {
  const result = new Map<string, CatalogEntry>();
  const add = (asset: AnySafeAsset, family: CatalogEntry["family"], subtype: CatalogEntry["subtype"]) => {
    if (result.has(asset.assetId)) throw new Error(`Formal asset restore: duplicate asset ${asset.assetId}`);
    result.set(asset.assetId, { asset, family, subtype });
  };
  source.assets.l0Conversations.forEach((asset) => add(asset, "memory", "l0"));
  source.assets.l1Memories.forEach((asset) => add(asset, "memory", "l1"));
  source.assets.l2Scenes.forEach((asset) => add(asset, "memory", "l2"));
  source.assets.l3Profiles.forEach((asset) => add(asset, "memory", "l3"));
  source.assets.skills.forEach((asset) => add(asset, "skill", "skill"));
  source.assets.knowledge.forEach((asset) => add(asset, "knowledge", asset.type));
  return result;
}

function sameWorkspace(left: WorkspaceRef, right: WorkspaceRef): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function identityFor(source: FormalAssetRestoreSource, userId: string, teamId?: string, agentId?: string) {
  return {
    datasetSpaceId: source.world.spaceId,
    datasetUserId: userId,
    ...(teamId ? { datasetTeamId: teamId } : {}),
    ...(agentId ? { datasetAgentId: agentId } : {}),
  };
}

export function compileFormalAssetRestorePlan(input: {
  selection: FormalAssetRestoreSelection;
  source: FormalAssetRestoreSource;
  bindings: readonly FormalCaseBinding[];
}): FormalAssetRestorePlan {
  requireSelection(input.selection);
  if (input.source.split !== input.selection.split) {
    throw new Error("Formal asset restore: source split does not match authorized selection");
  }
  if (canonicalSha256(input.source.world.runtimePolicy) !== input.source.snapshot.runtimePolicySha256) {
    throw new Error("Formal asset restore: runtime write policy hash does not match the frozen snapshot");
  }
  if (input.bindings.length === 0) throw new Error("Formal asset restore: at least one public binding is required");

  const agentsById = new Map(input.source.businessAgents.map((agent) => [agent.agentId, agent]));
  const teamsById = new Map(input.source.teams.map((team) => [team.teamId, team]));
  const tasksByTransport = new Map<string, SafeTask>();
  for (const task of input.source.tasks) {
    tasksByTransport.set(opaqueTaskId(
      input.source.revision.commit,
      input.source.world.spaceId,
      task.teamId,
      task.taskId,
    ), task);
  }
  const visibleByHash = new Map(input.source.snapshot.visibleAssetSets.map((set) => [set.sha256, set]));
  const selectedSetByHash = new Map<string, VisibleAssetSet>();
  const selectedTasks = new Map<string, { task: SafeTask; transportTaskId: string }>();
  const activeAgents = new Set<string>();
  for (const binding of input.bindings) {
    if (binding.split !== input.selection.split) throw new Error("Formal asset restore: binding split mismatch");
    if (binding.snapshotId !== input.source.snapshot.snapshotId) throw new Error("Formal asset restore: binding snapshot mismatch");
    if (binding.identity.spaceId !== input.source.world.spaceId) throw new Error("Formal asset restore: binding Space mismatch");
    const visible = visibleByHash.get(binding.visibleAssetSetSha256);
    if (!visible || visible.teamId !== binding.identity.teamId
      || visible.userId !== binding.identity.userId || visible.agentId !== binding.identity.agentId) {
      throw new Error("Formal asset restore: binding does not match a frozen visible asset set");
    }
    const task = tasksByTransport.get(binding.identity.taskId);
    if (!task || task.teamId !== binding.identity.teamId
      || !task.eligibleAgentIds.includes(binding.identity.agentId)
      || !sameWorkspace(task.workspace, binding.workspace)) {
      throw new Error(`Formal asset restore: invalid transport Task ${binding.identity.taskId}`);
    }
    selectedSetByHash.set(visible.sha256, visible);
    selectedTasks.set(task.taskId, { task, transportTaskId: binding.identity.taskId });
    activeAgents.add(binding.identity.agentId);
  }

  const selectedVisibleAssetSets = sorted([...selectedSetByHash.values()], (set) => `${set.teamId}\0${set.agentId}`);
  const selectedAssetIds = new Set(selectedVisibleAssetSets.flatMap((set) => set.assetIds));
  const catalog = assetCatalog(input.source);
  const selectedAssets = sorted([...selectedAssetIds].map((assetId) => {
    const entry = catalog.get(assetId);
    if (!entry) throw new Error(`Formal asset restore: visible asset ${assetId} is absent from projected source`);
    return entry;
  }), (entry) => entry.asset.assetId);
  const l3ByOwner = new Map<string, number>();
  for (const entry of selectedAssets.filter((item) => item.subtype === "l3")) {
    const count = (l3ByOwner.get(entry.asset.ownerAgentId) ?? 0) + 1;
    l3ByOwner.set(entry.asset.ownerAgentId, count);
    if (count > 1) {
      throw new Error(`Formal asset restore: multiple L3 profiles would overwrite owner ${entry.asset.ownerAgentId}`);
    }
  }

  const selectedAgentIds = new Set(activeAgents);
  selectedAssets.forEach(({ asset }) => selectedAgentIds.add(asset.ownerAgentId));
  activeAgents.forEach((agentId) => {
    const agent = agentsById.get(agentId);
    if (!agent) throw new Error(`Formal asset restore: active Agent ${agentId} is absent`);
    agent.importedMemoryAgentIds.forEach((id) => selectedAgentIds.add(id));
  });
  const selectedAgents = sorted([...selectedAgentIds].map((id) => {
    const agent = agentsById.get(id);
    if (!agent) throw new Error(`Formal asset restore: required Agent ${id} is absent`);
    return agent;
  }), (agent) => agent.agentId);
  const selectedTeamIds = new Set(selectedAgents.map((agent) => agent.teamId));
  selectedTasks.forEach(({ task }) => selectedTeamIds.add(task.teamId));
  const selectedTeams = sorted([...selectedTeamIds].map((id) => {
    const team = teamsById.get(id);
    if (!team) throw new Error(`Formal asset restore: required Team ${id} is absent`);
    return team;
  }), (team) => team.teamId);
  const userByTeam = new Map<string, string>();
  for (const set of selectedVisibleAssetSets) {
    const previous = userByTeam.get(set.teamId);
    if (previous && previous !== set.userId) throw new Error(`Formal asset restore: Team ${set.teamId} has multiple dataset users`);
    userByTeam.set(set.teamId, set.userId);
  }
  const selectedUsers = [...new Set(userByTeam.values())].sort();
  const requirements: RestorePlanRequirement[] = [{
    requirementId: actionId("require-space-service", input.source.world.spaceId),
    kind: "space_service_mapping",
    blocking: true,
    reason: `Resolve dataset Space ${input.source.world.spaceId} to the actual runtime service id; equality must not be assumed.`,
  }, ...selectedUsers.map<RestorePlanRequirement>((datasetUserId) => ({
    requirementId: actionId("require-auth-user", datasetUserId),
    kind: "auth_user_mapping",
    blocking: true,
    reason: `Resolve dataset user ${datasetUserId} to an authenticated runtime user and verify its Team/Agent/asset visibility.`,
  }))];
  const actions: Array<Omit<RestorePlanAction, "order">> = [];
  const push = (action: Omit<RestorePlanAction, "order">) => actions.push(action);

  for (const team of selectedTeams) {
    const datasetUserId = userByTeam.get(team.teamId);
    if (!datasetUserId) throw new Error(`Formal asset restore: Team ${team.teamId} lacks a selected dataset user`);
    const createId = actionId("team-create", team.teamId);
    push({
      actionId: createId, phase: "identity", serviceBoundary: "memory_core", service: "metadata",
      method: "POST", endpoint: "/v3/meta/team/create", dependsOn: [],
      executionIdentity: identityFor(input.source, datasetUserId, team.teamId),
      body: {
        name: team.name,
        owner_user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
        status: "active",
        metadata_json: canonicalJson({ formalTeamId: team.teamId, contentHash: team.contentHash }),
      },
      captures: { runtimeTeamId: "response.data.team_id" },
    });
    push({
      actionId: actionId("team-owner-membership-verify", team.teamId), phase: "identity",
      serviceBoundary: "memory_core", service: "metadata", method: "POST",
      endpoint: "/v3/meta/team-member/get", dependsOn: [createId],
      executionIdentity: identityFor(input.source, datasetUserId, team.teamId),
      body: {
        team_id: runtimeRef("runtime_team_id", team.teamId, createId),
        user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
      },
      captures: {
        runtimeMemberUserId: "response.data.user_id",
        runtimeMemberRole: "response.data.role",
        runtimeMemberStatus: "response.data.status",
      },
    });
  }

  for (const agent of selectedAgents) {
    const datasetUserId = userByTeam.get(agent.teamId)!;
    const createId = actionId("agent-create", agent.agentId);
    push({
      actionId: createId, phase: "identity", serviceBoundary: "memory_core", service: "metadata",
      method: "POST", endpoint: "/v3/meta/agent/create",
      dependsOn: [actionId("team-create", agent.teamId)],
      executionIdentity: identityFor(input.source, datasetUserId, agent.teamId, agent.agentId),
      body: {
        team_id: runtimeRef("runtime_team_id", agent.teamId, actionId("team-create", agent.teamId)),
        owner_user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
        name: agent.name, description: agent.agentDetail.description, prompt: agent.agentDetail.prompt,
        visibility: "team", status: "active",
        metadata_json: canonicalJson({ formalAgentId: agent.agentId, contentHash: agent.contentHash }),
      },
      captures: { runtimeAgentId: "response.data.agent_id" },
    });
  }

  const selectedTaskRows = sorted([...selectedTasks.values()], ({ task }) => task.taskId);
  for (const { task, transportTaskId } of selectedTaskRows) {
    const datasetUserId = userByTeam.get(task.teamId)!;
    const eligible = task.eligibleAgentIds.filter((id) => activeAgents.has(id)).sort();
    const createId = actionId("task-create", task.taskId);
    push({
      actionId: createId, phase: "identity", serviceBoundary: "memory_core", service: "metadata",
      method: "POST", endpoint: "/v3/meta/task/create",
      dependsOn: [actionId("team-create", task.teamId), ...eligible.map((id) => actionId("agent-create", id))],
      executionIdentity: identityFor(input.source, datasetUserId, task.teamId),
      body: {
        team_id: runtimeRef("runtime_team_id", task.teamId, actionId("team-create", task.teamId)),
        creator_user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
        title: task.title, description: task.description, source_type: "github",
        source_url: task.projectRef.repoUrl, status: "running", auto_assign_floating_assets: false,
        linked_agents: eligible.map((agentId) => ({
          agent_id: runtimeRef("runtime_agent_id", agentId, actionId("agent-create", agentId)),
        })),
        metadata_json: canonicalJson({ formalTaskId: task.taskId, transportTaskId, contentHash: task.contentHash }),
      },
      captures: { runtimeTaskId: "response.data.task_id" },
    });
  }

  const assetActionById = new Map<string, string>();
  const assetBindingReadyById = new Map<string, string>();
  for (const entry of selectedAssets) {
    const asset = entry.asset;
    const owner = agentsById.get(asset.ownerAgentId)!;
    const datasetUserId = userByTeam.get(owner.teamId)!;
    const base = {
      dependsOn: [actionId("agent-create", owner.agentId)],
      executionIdentity: identityFor(input.source, datasetUserId, owner.teamId, owner.agentId),
    };
    if (entry.subtype === "l0") {
      const value = asset as SafeL0;
      if (value.messages.length === 0 || value.messages.length > 100) {
        throw new Error(`Formal asset restore: L0 ${value.assetId} exceeds Formal import batch limits`);
      }
      for (const message of value.messages) {
        if ((message.role !== "user" && message.role !== "assistant")
          || message.content.length === 0 || message.content.length > 8192) {
          throw new Error(`Formal asset restore: L0 message ${message.messageId} is not accepted by production`);
        }
      }
      const id = actionId("memory-l0-add", value.assetId);
      push({
        actionId: id, phase: "memory", serviceBoundary: "memory_core", service: "memory-data",
        method: "POST", endpoint: "/v3/formal-bench/import-memory", ...base,
        body: {
          kind: "l0",
          formal_asset_id: value.assetId,
          expected_asset_content_hash: value.contentHash,
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          agent_id: runtimeRef("runtime_agent_id", owner.agentId, actionId("agent-create", owner.agentId)),
          payload: {
            sessionId: value.sessionId,
            messages: value.messages.map((message) => ({
              id: message.messageId,
              role: message.role,
              content: message.content,
              recordedAt: message.observedAt,
            })),
          },
        },
        captures: { runtimeMessageIds: "response.data.accepted_ids" },
      });
      assetActionById.set(value.assetId, id);
    } else if (entry.subtype === "l1") {
      const value = asset as SafeL1;
      const requirementId = actionId("require-memory-l1-import", value.assetId);
      requirements.push({
        requirementId, kind: "memory_l1_import", blocking: true, formalAssetId: value.assetId,
        logicalLocator: value.assetId,
        dependsOnActions: [
          actionId("team-create", owner.teamId),
          actionId("agent-create", owner.agentId),
        ],
        expectedAssetContentHash: value.contentHash,
        runtimeIsolation: {
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          agent_id: runtimeRef("runtime_agent_id", owner.agentId, actionId("agent-create", owner.agentId)),
        },
        importPayload: {
          id: value.assetId,
          formalType: value.type,
          content: value.content,
          observedAt: value.observedAt,
          validFrom: value.validFrom,
        },
        reason: "MemoryCore exposes no public L1 create/upsert endpoint; /v3/atomic/update returns 404 for a missing record. A hash-verified runtime-store importer is required.",
      });
    } else if (entry.subtype === "l2") {
      const value = asset as SafeL2;
      const requirementId = actionId("require-memory-l2-import", value.assetId);
      requirements.push({
        requirementId, kind: "memory_l2_import", blocking: true, formalAssetId: value.assetId,
        logicalLocator: value.path,
        runtimeLocator: assertSafeScenarioPath(value.path),
        dependsOnActions: [
          actionId("team-create", owner.teamId),
          actionId("agent-create", owner.agentId),
        ],
        expectedAssetContentHash: value.contentHash,
        runtimeIsolation: {
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          agent_id: runtimeRef("runtime_agent_id", owner.agentId, actionId("agent-create", owner.agentId)),
        },
        importPayload: {
          path: assertSafeScenarioPath(value.path),
          content: value.content,
          summary: value.summary,
          observedAt: value.observedAt,
          formalInjected: value.injected,
        },
        reason: `MemoryCore /v3/scenario/write is update-only and returns 404 for a missing path. A hash-verified importer must create ${assertSafeScenarioPath(value.path)} first.`,
      });
    } else if (entry.subtype === "l3") {
      const value = asset as SafeL3;
      const id = actionId("memory-l3-write", value.assetId);
      push({
        actionId: id, phase: "memory", serviceBoundary: "memory_core", service: "memory-data",
        method: "POST", endpoint: "/v3/core/write", ...base,
        body: {
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          agent_id: runtimeRef("runtime_agent_id", owner.agentId, actionId("agent-create", owner.agentId)),
          content: value.content,
        },
        captures: { runtimeVersion: "response.data.version" },
      });
      assetActionById.set(value.assetId, id);
    } else if (entry.subtype === "skill") {
      const value = asset as SafeSkill;
      const id = actionId("skill-create", value.assetId);
      const requirementId = actionId("require-skill-package", value.assetId);
      requirements.push({
        requirementId, kind: "skill_package_bytes", blocking: true, formalAssetId: value.assetId,
        manifest: clone(value.manifest),
        reason: "The contract freezes file hashes, not bytes. Resolve and hash-check every package file before create.",
      });
      push({
        actionId: id, phase: "skill", serviceBoundary: "memory_core", service: "skill-data",
        method: "POST", endpoint: "/v3/skill/create", ...base,
        blockedByRequirements: [requirementId],
        body: {
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          agent_id: runtimeRef("runtime_agent_id", owner.agentId, actionId("agent-create", owner.agentId)),
          name: value.name,
          content: runtimeRef("verified_skill_entry_content", value.assetId, requirementId),
          resources: runtimeRef("verified_skill_resources", value.assetId, requirementId),
          metadata: {
            formalAssetId: value.assetId, version: value.version, description: value.description,
            useWhen: value.useWhen, doNotUseWhen: value.doNotUseWhen,
            repoCommit: value.repoCommit, contentHash: value.contentHash,
          },
        },
        captures: { runtimeAssetId: "response.data.skill_id" },
      });
      assetActionById.set(value.assetId, id);
      assetBindingReadyById.set(value.assetId, id);
      if (value.visibility === "team") {
        const visibilityId = actionId("skill-visibility-update", value.assetId);
        push({
          actionId: visibilityId, phase: "skill", serviceBoundary: "memory_core", service: "metadata",
          method: "POST", endpoint: "/v3/meta/asset/update", dependsOn: [id],
          executionIdentity: base.executionIdentity,
          body: { asset_id: runtimeRef("runtime_asset_id", value.assetId, id), visibility: "team" }, captures: {},
        });
        assetBindingReadyById.set(value.assetId, visibilityId);
      }
    } else {
      const value = asset as SafeKnowledge;
      const shellId = actionId("knowledge-shell-create", value.assetId);
      push({
        actionId: shellId, phase: "knowledge", serviceBoundary: "memory_knowledge", service: "knowledge-resource",
        method: "POST", endpoint: value.type === "wiki" ? "/v3/wiki/create" : "/v3/code-graph/create", ...base,
        correlationHeaders: { "x-tdai-service-id": runtimeRef("runtime_service_id", input.source.world.spaceId) },
        body: {
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          agent_id: runtimeRef("runtime_agent_id", owner.agentId, actionId("agent-create", owner.agentId)),
          ...(value.type === "wiki"
            ? { name: value.name }
            : {
              repo_url: value.repoUrl,
              repo_name: value.name,
              formal_ready: true,
              formal_asset_id: value.assetId,
            }),
        },
        captures: {
          runtimeAssetId: value.type === "wiki" ? "response.data.wiki_id" : "response.data.code_graph_id",
          serviceUrl: "response.data.service_url",
        },
      });
      const coreId = actionId("knowledge-core-create", value.assetId);
      push({
        actionId: coreId, phase: "knowledge", serviceBoundary: "memory_core", service: "knowledge-metadata",
        method: "POST", endpoint: "/v3/knowledge/create", dependsOn: [shellId],
        executionIdentity: base.executionIdentity,
        body: {
          knowledge_id: runtimeRef("runtime_asset_id", value.assetId, shellId),
          type: value.type === "wiki" ? "wiki" : "code-graph",
          service_url: runtimeRef("knowledge_service_url", value.assetId, shellId), name: value.name,
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          ...(value.repoUrl ? { repo_url: value.repoUrl } : {}),
        },
        captures: { runtimeAssetId: "response.data.knowledge_id" },
      });
      const metadataId = actionId("knowledge-asset-register", value.assetId);
      push({
        actionId: metadataId, phase: "knowledge", serviceBoundary: "memory_core", service: "metadata",
        method: "POST", endpoint: "/v3/meta/asset/create", dependsOn: [coreId],
        executionIdentity: base.executionIdentity,
        body: {
          asset_id: runtimeRef("runtime_asset_id", value.assetId, shellId),
          team_id: runtimeRef("runtime_team_id", owner.teamId, actionId("team-create", owner.teamId)),
          asset_type: value.type === "wiki" ? "llm_wiki" : "code_graph", name: value.name,
          owner_user_id: runtimeRef("resolved_auth_user_id", datasetUserId),
          source_type: "formal_restore", source_ref: value.assetId, visibility: "private", status: "approved",
          metadata_json: canonicalJson({ formalAssetId: value.assetId, contentHash: value.contentHash }),
        },
        captures: {},
      });
      assetActionById.set(value.assetId, shellId);
      assetBindingReadyById.set(value.assetId, metadataId);
    }
  }

  for (const activeAgentId of [...activeAgents].sort()) {
    const agent = agentsById.get(activeAgentId)!;
    const datasetUserId = userByTeam.get(agent.teamId)!;
    const fixedBindings: unknown[] = [{
      asset_id: runtimeRef("derived_chat_memory_asset_id", activeAgentId, actionId("agent-create", activeAgentId)),
      asset_type: "chat_memory", created_by: runtimeRef("resolved_auth_user_id", datasetUserId),
    }];
    for (const importedId of [...agent.importedMemoryAgentIds].sort()) fixedBindings.push({
      asset_id: runtimeRef("derived_chat_memory_asset_id", importedId, actionId("agent-create", importedId)),
      asset_type: "chat_memory", created_by: runtimeRef("resolved_auth_user_id", datasetUserId),
    });
    for (const skillId of [...agent.boundSkillIds].sort()) if (selectedAssetIds.has(skillId)) fixedBindings.push({
      asset_id: runtimeRef("runtime_asset_id", skillId, assetActionById.get(skillId)),
      asset_type: "skill", created_by: runtimeRef("resolved_auth_user_id", datasetUserId),
    });
    for (const knowledgeId of [...agent.fixedKnowledgeIds].sort()) if (selectedAssetIds.has(knowledgeId)) {
      const knowledge = input.source.assets.knowledge.find((item) => item.assetId === knowledgeId)!;
      fixedBindings.push({
        asset_id: runtimeRef("runtime_asset_id", knowledgeId, assetActionById.get(knowledgeId)),
        asset_type: knowledge.type === "wiki" ? "llm_wiki" : "code_graph",
        created_by: runtimeRef("resolved_auth_user_id", datasetUserId),
      });
    }
    push({
      actionId: actionId("agent-fixed-assets-set", activeAgentId), phase: "binding",
      serviceBoundary: "memory_core", service: "metadata", method: "POST",
      endpoint: "/v3/meta/agent-fixed-asset/set",
      dependsOn: [...new Set([
        actionId("agent-create", activeAgentId),
        ...agent.importedMemoryAgentIds.map((id) => actionId("agent-create", id)),
        ...agent.boundSkillIds.map((id) => assetBindingReadyById.get(id)).filter((id): id is string => Boolean(id)),
        ...agent.fixedKnowledgeIds.map((id) => assetBindingReadyById.get(id)).filter((id): id is string => Boolean(id)),
      ])].sort(),
      executionIdentity: identityFor(input.source, datasetUserId, agent.teamId, activeAgentId),
      body: {
        agent_id: runtimeRef("runtime_agent_id", activeAgentId, actionId("agent-create", activeAgentId)),
        bindings: fixedBindings,
      },
      captures: {},
    });
  }

  const orderedActions: RestorePlanAction[] = actions.map((action, index) => ({ ...action, order: index + 1 }));
  const planAssets: PlannedRestoreAsset[] = selectedAssets.map((entry) => {
    const id = entry.asset.assetId;
    const action = assetActionById.get(id);
    if (entry.subtype !== "l1" && entry.subtype !== "l2" && !action) {
      throw new Error(`Formal asset restore: asset ${id} has no receipt action`);
    }
    const receipt: PlannedRestoreAsset["receipt"] = entry.subtype === "l1" || entry.subtype === "l2"
      ? { kind: "unresolved-import", requirementId: actionId(`require-memory-${entry.subtype}-import`, id) }
      : entry.subtype === "l0"
      ? {
        kind: "conversation",
        actionId: action!,
        requestedSessionId: (entry.asset as SafeL0).sessionId,
        formalMessageIds: (entry.asset as SafeL0).messages.map((message) => message.messageId),
        runtimeMessageIdsPath: "response.data.accepted_ids",
        mapping: "ordered-response",
      }
      : entry.subtype === "l3"
        ? { kind: "core-scope", actionId: action!, contentHash: exactTextSha256((entry.asset as SafeL3).content.trim()) }
        : { kind: "runtime-asset-id", actionId: action! };
    return {
      formalAssetId: id, family: entry.family, subtype: entry.subtype,
      ownerAgentId: entry.asset.ownerAgentId, contentHash: entry.asset.contentHash, receipt,
    };
  });
  const dedupedRequirements = [...new Map(requirements.map((item) => [item.requirementId, item])).values()]
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  const core = {
    schemaVersion: "task1.formal-asset-restore-plan.v1" as const,
    split: input.selection.split,
    revision: clone(input.source.revision),
    snapshot: {
      snapshotId: input.source.snapshot.snapshotId,
      sourcePackSha256: input.source.snapshot.sourcePackSha256,
      snapshotContentHash: input.source.snapshot.contentHash,
      sourceProjectionSha256: input.source.sourceProjectionSha256,
    },
    runtimePolicy: {
      policy: clone(input.source.world.runtimePolicy),
      sha256: input.source.snapshot.runtimePolicySha256,
    },
    executable: false as const,
    formalMetricEligible: false as const,
    credentialPolicy: "execution-time user key only; no credential value is serialized" as const,
    identityMappings: {
      space: {
        datasetSpaceId: input.source.world.spaceId,
        runtimeServiceId: { state: "unresolved" as const, requiredGate: "space-service-mapping" as const },
      },
      users: selectedUsers.map((datasetUserId) => ({
        datasetUserId,
        resolvedAuthUserId: { state: "unresolved" as const, requiredGate: "auth-user-mapping" as const },
      })),
      teams: selectedTeams.map((team) => ({
        datasetTeamId: team.teamId,
        runtimeTeamId: { state: "from-action-receipt" as const, actionId: actionId("team-create", team.teamId) },
      })),
      agents: selectedAgents.map((agent) => ({
        datasetAgentId: agent.agentId,
        runtimeAgentId: { state: "from-action-receipt" as const, actionId: actionId("agent-create", agent.agentId) },
      })),
      tasks: selectedTaskRows.map(({ task, transportTaskId }) => ({
        datasetTaskId: task.taskId, transportTaskId,
        runtimeTaskId: { state: "from-action-receipt" as const, actionId: actionId("task-create", task.taskId) },
      })),
    },
    selectedVisibleAssetSets: clone(selectedVisibleAssetSets),
    assets: planAssets,
    requirements: dedupedRequirements,
    actions: orderedActions,
    excludedUnreferencedAssetCount: catalog.size - selectedAssetIds.size,
  };
  return deepFreeze({ ...core, planSha256: canonicalSha256(core) });
}
