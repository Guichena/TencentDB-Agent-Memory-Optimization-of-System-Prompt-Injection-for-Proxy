/**
 * Runtime-only contract for a Gold-blind Formal asset restore plan.
 *
 * This module intentionally has no dependency on the authoring World schema,
 * private measurement loaders, or dataset contracts. Offline code may project
 * those richer objects into this DTO; runtime restore code must parse only this
 * DTO before it can inspect or schedule any restore action.
 */
import { canonicalSha256 } from "../formal-runtime/canonical.js";

export type FormalAssetRestoreSplit = "dev" | "hidden_test";

export type FormalDataRevisionReceipt = Readonly<{
  tag: string;
  tagObject: string;
  commit: string;
  contractCanonicalSha256: string;
  snapshotCanonicalSha256: string;
}>;

export type FormalRestoreRuntimePolicy = Readonly<{
  allowLlmWrite: false;
  extraction: Readonly<{ enabled: false; extractors: readonly [] }>;
  assetReflection: false;
  writeL0: false;
  archiveWriteBack: false;
}>;

export type FormalRestoreVisibleAssetSet = Readonly<{
  teamId: string;
  userId: string;
  agentId: string;
  assetIds: readonly string[];
  sha256: string;
}>;

export type RuntimeValueRef = Readonly<{
  $runtimeRef: string;
  logicalId?: string;
  actionId?: string;
}>;

export interface RestorePlanAction {
  readonly order: number;
  readonly actionId: string;
  readonly phase: "identity" | "memory" | "skill" | "knowledge" | "binding";
  readonly serviceBoundary: "memory_core" | "memory_knowledge";
  readonly service:
    | "metadata"
    | "memory-data"
    | "skill-data"
    | "knowledge-metadata"
    | "knowledge-resource";
  readonly method: "POST";
  readonly endpoint: string;
  readonly dependsOn: readonly string[];
  readonly blockedByRequirements?: readonly string[];
  readonly executionIdentity: Readonly<{
    datasetSpaceId: string;
    datasetUserId: string;
    datasetTeamId?: string;
    datasetAgentId?: string;
  }>;
  readonly correlationHeaders?: Readonly<Record<string, RuntimeValueRef>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly captures: Readonly<Record<string, string>>;
}

export interface RestorePlanRequirement {
  readonly requirementId: string;
  readonly kind:
    | "space_service_mapping"
    | "auth_user_mapping"
    | "skill_package_bytes"
    | "knowledge_snapshot_import"
    | "memory_l1_import"
    | "memory_l2_import";
  readonly blocking: true;
  readonly formalAssetId?: string;
  readonly logicalLocator?: string;
  readonly runtimeLocator?: string;
  readonly dependsOnActions?: readonly string[];
  readonly runtimeAssetRef?: RuntimeValueRef;
  readonly expectedSha256?: string;
  readonly expectedAssetContentHash?: string;
  readonly manifest?: readonly Readonly<{ path: string; sha256: string }>[];
  readonly sourcePin?: Readonly<{
    repoUrl?: string;
    repoCommit?: string;
    indexVersion?: string;
  }>;
  readonly runtimeIsolation?: Readonly<{
    team_id: RuntimeValueRef;
    user_id: RuntimeValueRef;
    agent_id: RuntimeValueRef;
  }>;
  readonly importPayload?: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export type PlannedRestoreAsset = Readonly<{
  formalAssetId: string;
  family: "memory" | "skill" | "knowledge";
  subtype: "l0" | "l1" | "l2" | "l3" | "skill" | "wiki" | "code_graph";
  ownerAgentId: string;
  contentHash: string;
  receipt:
    | Readonly<{
      kind: "conversation";
      actionId: string;
      requestedSessionId: string;
      formalMessageIds: readonly string[];
      runtimeMessageIdsPath: string;
      mapping: "ordered-response";
    }>
    | Readonly<{ kind: "core-scope"; actionId: string; contentHash: string }>
    | Readonly<{ kind: "unresolved-import"; requirementId: string }>
    | Readonly<{ kind: "runtime-asset-id" | "explicit-id" | "scenario-path"; actionId: string }>;
}>;

export interface FormalAssetRestorePlan {
  readonly schemaVersion: "task1.formal-asset-restore-plan.v1";
  readonly split: FormalAssetRestoreSplit;
  readonly revision: FormalDataRevisionReceipt;
  readonly snapshot: Readonly<{
    snapshotId: string;
    sourcePackSha256: string;
    snapshotContentHash: string;
    sourceProjectionSha256: string;
  }>;
  readonly runtimePolicy: Readonly<{
    policy: FormalRestoreRuntimePolicy;
    sha256: string;
  }>;
  readonly executable: false;
  readonly formalMetricEligible: false;
  readonly credentialPolicy: "execution-time user key only; no credential value is serialized";
  readonly identityMappings: Readonly<{
    space: Readonly<{
      datasetSpaceId: string;
      runtimeServiceId: Readonly<{ state: "unresolved"; requiredGate: "space-service-mapping" }>;
    }>;
    users: readonly Readonly<{
      datasetUserId: string;
      resolvedAuthUserId: Readonly<{ state: "unresolved"; requiredGate: "auth-user-mapping" }>;
    }>[];
    teams: readonly Readonly<{
      datasetTeamId: string;
      runtimeTeamId: Readonly<{ state: "from-action-receipt"; actionId: string }>;
    }>[];
    agents: readonly Readonly<{
      datasetAgentId: string;
      runtimeAgentId: Readonly<{ state: "from-action-receipt"; actionId: string }>;
    }>[];
    tasks: readonly Readonly<{
      datasetTaskId: string;
      transportTaskId: string;
      runtimeTaskId: Readonly<{ state: "from-action-receipt"; actionId: string }>;
    }>[];
  }>;
  readonly selectedVisibleAssetSets: readonly FormalRestoreVisibleAssetSet[];
  readonly assets: readonly PlannedRestoreAsset[];
  readonly requirements: readonly RestorePlanRequirement[];
  readonly actions: readonly RestorePlanAction[];
  readonly excludedUnreferencedAssetCount: number;
  readonly planSha256: string;
}

export type ParseFormalAssetRestorePlanOptions = Readonly<{
  expectedSplit: FormalAssetRestoreSplit;
  allowHiddenTest?: true;
  expectedRevision?: FormalDataRevisionReceipt;
}>;

export class FormalAssetRestorePlanContractError extends Error {
  readonly code = "INVALID_FORMAL_ASSET_RESTORE_PLAN" as const;

  constructor(message: string) {
    super(`Formal asset restore plan: ${message}`);
    this.name = "FormalAssetRestorePlanContractError";
  }
}

type JsonRecord = Record<string, unknown>;

const HASH = /^[a-f0-9]{64}$/u;
const GIT_OBJECT = /^[a-f0-9]{40}$/u;
const FORBIDDEN_RUNTIME_KEYS = new Set([
  "publiccases",
  "cases",
  "privateannotations",
  "pairs",
  "runrecords",
  "case",
  "caseid",
  "identity",
  "workspace",
  "language",
  "difficulty",
  "query",
  "contextmessages",
  "allowedsequences",
  "allowedfirstactions",
  "expectedfollowupactions",
  "expectedknowledgecalls",
  "forbiddentools",
  "needtdaitool",
  "maxtdaicalls",
  "informationgap",
  "stopafter",
  "maxcallsreviewreason",
  "targetassetids",
  "evidencerefs",
  "sourceevidence",
  "sourceevidenceids",
  "annotationreason",
  "ablationevidence",
  "notoolevidence",
  "pairid",
  "pairrole",
  "positivecaseid",
  "negativecaseid",
  "counterfactualkind",
  "controlleddeltasha256",
]);
const SAFE_CORRELATION_HEADERS = new Set([
  "x-conversation-id",
  "x-session-id",
  "x-chat-id",
  "x-thread-id",
  "x-tdai-service-id",
  "x-tdai-user-id",
  "x-tdai-team-id",
  "x-tdai-agent-id",
  "x-tdai-agent-source",
  "x-tdai-space-id",
]);

function invalid(message: string): never {
  throw new FormalAssetRestorePlanContractError(message);
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isSecretLikeKey(key: string): boolean {
  if (key === "credentialPolicy") return false;
  const normalized = normalizedKey(key);
  return normalized.includes("authorization")
    || normalized.endsWith("apikey")
    || normalized.endsWith("userkey")
    || normalized.endsWith("privatekey")
    || normalized.endsWith("accesstoken")
    || normalized.endsWith("refreshtoken")
    || normalized.endsWith("token")
    || normalized.endsWith("password")
    || normalized.endsWith("secret")
    || normalized === "authjson"
    || normalized === "cookie"
    || normalized === "bearer"
    || normalized === "credential";
}

function rejectForbiddenRuntimeKeys(value: unknown, path = "$", seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) invalid(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((child, index) => rejectForbiddenRuntimeKeys(child, `${path}[${index}]`, seen));
      return;
    }
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      const normalized = normalizedKey(key);
      if (FORBIDDEN_RUNTIME_KEYS.has(normalized) || normalized.includes("gold")) {
        invalid(`${path}.${key} is a forbidden Gold/Case key`);
      }
      if (isSecretLikeKey(key)) invalid(`${path}.${key} is a forbidden secret-like key`);
      rejectForbiddenRuntimeKeys(child, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function record(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${path} must be an object`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: readonly string[], path: string): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allow.has(key));
  if (unexpected.length > 0) invalid(`${path} contains unexpected key ${unexpected[0]}`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return invalid(`${path} must be a non-empty string`);
  return value;
}

function literal<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    return invalid(`${path} must be one of ${choices.join(", ")}`);
  }
  return value as T;
}

function hash(value: unknown, path: string): string {
  const result = string(value, path);
  if (!HASH.test(result)) invalid(`${path} must be a lowercase SHA-256`);
  return result;
}

function gitObject(value: unknown, path: string): string {
  const result = string(value, path);
  if (!GIT_OBJECT.test(result)) invalid(`${path} must be a lowercase Git object id`);
  return result;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(`${path} must be an array`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  const result = array(value, path).map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) invalid(`${path} must not contain duplicates`);
  return result;
}

function integer(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return invalid(`${path} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function falseLiteral(value: unknown, path: string): false {
  if (value !== false) return invalid(`${path} must be false`);
  return false;
}

function runtimeRef(value: unknown, path: string): RuntimeValueRef {
  const result = record(value, path);
  exactKeys(result, ["$runtimeRef", "logicalId", "actionId"], path);
  string(result.$runtimeRef, `${path}.$runtimeRef`);
  if (result.logicalId !== undefined) string(result.logicalId, `${path}.logicalId`);
  if (result.actionId !== undefined) string(result.actionId, `${path}.actionId`);
  return result as RuntimeValueRef;
}

function validateNestedRuntimeRefs(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateNestedRuntimeRefs(child, `${path}[${index}]`));
    return;
  }
  const result = value as JsonRecord;
  if (Object.hasOwn(result, "$runtimeRef")) runtimeRef(result, path);
  for (const [key, child] of Object.entries(result)) validateNestedRuntimeRefs(child, `${path}.${key}`);
}

function validateRevision(value: unknown, path: string): FormalDataRevisionReceipt {
  const result = record(value, path);
  exactKeys(result, ["tag", "tagObject", "commit", "contractCanonicalSha256", "snapshotCanonicalSha256"], path);
  string(result.tag, `${path}.tag`);
  gitObject(result.tagObject, `${path}.tagObject`);
  gitObject(result.commit, `${path}.commit`);
  hash(result.contractCanonicalSha256, `${path}.contractCanonicalSha256`);
  hash(result.snapshotCanonicalSha256, `${path}.snapshotCanonicalSha256`);
  return result as FormalDataRevisionReceipt;
}

function validateRuntimePolicy(value: unknown): void {
  const result = record(value, "$.runtimePolicy");
  exactKeys(result, ["policy", "sha256"], "$.runtimePolicy");
  const policy = record(result.policy, "$.runtimePolicy.policy");
  exactKeys(policy, ["allowLlmWrite", "extraction", "assetReflection", "writeL0", "archiveWriteBack"], "$.runtimePolicy.policy");
  falseLiteral(policy.allowLlmWrite, "$.runtimePolicy.policy.allowLlmWrite");
  falseLiteral(policy.assetReflection, "$.runtimePolicy.policy.assetReflection");
  falseLiteral(policy.writeL0, "$.runtimePolicy.policy.writeL0");
  falseLiteral(policy.archiveWriteBack, "$.runtimePolicy.policy.archiveWriteBack");
  const extraction = record(policy.extraction, "$.runtimePolicy.policy.extraction");
  exactKeys(extraction, ["enabled", "extractors"], "$.runtimePolicy.policy.extraction");
  falseLiteral(extraction.enabled, "$.runtimePolicy.policy.extraction.enabled");
  if (array(extraction.extractors, "$.runtimePolicy.policy.extraction.extractors").length !== 0) {
    invalid("$.runtimePolicy.policy.extraction.extractors must be empty");
  }
  const expected = hash(result.sha256, "$.runtimePolicy.sha256");
  if (canonicalSha256(policy) !== expected) invalid("runtimePolicy sha256 does not match policy");
}

function validateExecutionIdentity(value: unknown, path: string): void {
  const result = record(value, path);
  exactKeys(result, ["datasetSpaceId", "datasetUserId", "datasetTeamId", "datasetAgentId"], path);
  string(result.datasetSpaceId, `${path}.datasetSpaceId`);
  string(result.datasetUserId, `${path}.datasetUserId`);
  if (result.datasetTeamId !== undefined) string(result.datasetTeamId, `${path}.datasetTeamId`);
  if (result.datasetAgentId !== undefined) string(result.datasetAgentId, `${path}.datasetAgentId`);
}

function validateActions(value: unknown): { actions: JsonRecord[]; ids: Set<string> } {
  const actions = array(value, "$.actions").map((item, index) => record(item, `$.actions[${index}]`));
  const ids = new Set<string>();
  actions.forEach((action, index) => {
    const path = `$.actions[${index}]`;
    exactKeys(action, [
      "order", "actionId", "phase", "serviceBoundary", "service", "method", "endpoint",
      "dependsOn", "blockedByRequirements", "executionIdentity", "correlationHeaders", "body", "captures",
    ], path);
    if (integer(action.order, `${path}.order`, 1) !== index + 1) invalid(`${path}.order must equal ${index + 1}`);
    const id = string(action.actionId, `${path}.actionId`);
    if (ids.has(id)) invalid(`duplicate action id ${id}`);
    ids.add(id);
    literal(action.phase, ["identity", "memory", "skill", "knowledge", "binding"], `${path}.phase`);
    literal(action.serviceBoundary, ["memory_core", "memory_knowledge"], `${path}.serviceBoundary`);
    literal(action.service, ["metadata", "memory-data", "skill-data", "knowledge-metadata", "knowledge-resource"], `${path}.service`);
    if (action.method !== "POST") invalid(`${path}.method must be POST`);
    if (!string(action.endpoint, `${path}.endpoint`).startsWith("/v3/")) invalid(`${path}.endpoint must be a /v3/ route`);
    stringArray(action.dependsOn, `${path}.dependsOn`);
    if (action.blockedByRequirements !== undefined) stringArray(action.blockedByRequirements, `${path}.blockedByRequirements`);
    validateExecutionIdentity(action.executionIdentity, `${path}.executionIdentity`);
    if (action.correlationHeaders !== undefined) {
      const headers = record(action.correlationHeaders, `${path}.correlationHeaders`);
      for (const [name, headerValue] of Object.entries(headers)) {
        if (!SAFE_CORRELATION_HEADERS.has(name)) invalid(`${path}.correlationHeaders contains unsafe header ${name}`);
        runtimeRef(headerValue, `${path}.correlationHeaders.${name}`);
      }
    }
    validateNestedRuntimeRefs(record(action.body, `${path}.body`), `${path}.body`);
    const captures = record(action.captures, `${path}.captures`);
    Object.entries(captures).forEach(([name, capture]) => string(capture, `${path}.captures.${name}`));
  });
  return { actions, ids };
}

function validateRequirements(value: unknown): { requirements: JsonRecord[]; ids: Set<string> } {
  const requirements = array(value, "$.requirements").map((item, index) => record(item, `$.requirements[${index}]`));
  const ids = new Set<string>();
  requirements.forEach((requirement, index) => {
    const path = `$.requirements[${index}]`;
    exactKeys(requirement, [
      "requirementId", "kind", "blocking", "formalAssetId", "logicalLocator", "runtimeLocator",
      "dependsOnActions", "runtimeAssetRef", "expectedSha256", "expectedAssetContentHash", "manifest",
      "sourcePin", "runtimeIsolation", "importPayload", "reason",
    ], path);
    const id = string(requirement.requirementId, `${path}.requirementId`);
    if (ids.has(id)) invalid(`duplicate requirement id ${id}`);
    ids.add(id);
    literal(requirement.kind, [
      "space_service_mapping", "auth_user_mapping", "skill_package_bytes", "knowledge_snapshot_import",
      "memory_l1_import", "memory_l2_import",
    ], `${path}.kind`);
    if (requirement.blocking !== true) invalid(`${path}.blocking must be true`);
    for (const key of ["formalAssetId", "logicalLocator", "runtimeLocator"] as const) {
      if (requirement[key] !== undefined) string(requirement[key], `${path}.${key}`);
    }
    if (requirement.dependsOnActions !== undefined) stringArray(requirement.dependsOnActions, `${path}.dependsOnActions`);
    if (requirement.runtimeAssetRef !== undefined) runtimeRef(requirement.runtimeAssetRef, `${path}.runtimeAssetRef`);
    if (requirement.expectedSha256 !== undefined) hash(requirement.expectedSha256, `${path}.expectedSha256`);
    if (requirement.expectedAssetContentHash !== undefined) hash(requirement.expectedAssetContentHash, `${path}.expectedAssetContentHash`);
    if (requirement.manifest !== undefined) {
      array(requirement.manifest, `${path}.manifest`).forEach((item, itemIndex) => {
        const entryPath = `${path}.manifest[${itemIndex}]`;
        const entry = record(item, entryPath);
        exactKeys(entry, ["path", "sha256"], entryPath);
        string(entry.path, `${entryPath}.path`);
        hash(entry.sha256, `${entryPath}.sha256`);
      });
    }
    if (requirement.sourcePin !== undefined) {
      const sourcePin = record(requirement.sourcePin, `${path}.sourcePin`);
      exactKeys(sourcePin, ["repoUrl", "repoCommit", "indexVersion"], `${path}.sourcePin`);
      Object.entries(sourcePin).forEach(([key, item]) => string(item, `${path}.sourcePin.${key}`));
    }
    if (requirement.runtimeIsolation !== undefined) {
      const isolation = record(requirement.runtimeIsolation, `${path}.runtimeIsolation`);
      exactKeys(isolation, ["team_id", "user_id", "agent_id"], `${path}.runtimeIsolation`);
      runtimeRef(isolation.team_id, `${path}.runtimeIsolation.team_id`);
      runtimeRef(isolation.user_id, `${path}.runtimeIsolation.user_id`);
      runtimeRef(isolation.agent_id, `${path}.runtimeIsolation.agent_id`);
    }
    if (requirement.importPayload !== undefined) {
      validateNestedRuntimeRefs(record(requirement.importPayload, `${path}.importPayload`), `${path}.importPayload`);
    }
    string(requirement.reason, `${path}.reason`);
  });
  return { requirements, ids };
}

function assertRefExists(id: string, ids: ReadonlySet<string>, message: string): void {
  if (!ids.has(id)) invalid(`${message}: ${id}`);
}

function validateDependencyGraph(
  actions: readonly JsonRecord[],
  actionIds: ReadonlySet<string>,
  requirements: readonly JsonRecord[],
  requirementIds: ReadonlySet<string>,
): void {
  for (const id of actionIds) if (requirementIds.has(id)) invalid(`action and requirement share id ${id}`);
  const completedActions = new Set<string>();
  actions.forEach((action) => {
    const actionId = action.actionId as string;
    for (const dependency of action.dependsOn as string[]) {
      assertRefExists(dependency, actionIds, `unknown action dependency for ${actionId}`);
      if (!completedActions.has(dependency)) invalid(`action ${actionId} depends on a non-prior action ${dependency}`);
    }
    for (const requirementId of (action.blockedByRequirements ?? []) as string[]) {
      assertRefExists(requirementId, requirementIds, `unknown blocking requirement for ${actionId}`);
    }
    completedActions.add(actionId);
  });
  requirements.forEach((requirement) => {
    for (const dependency of (requirement.dependsOnActions ?? []) as string[]) {
      assertRefExists(dependency, actionIds, `unknown action dependency for requirement ${requirement.requirementId as string}`);
    }
  });
}

function validateIdentityMappings(value: unknown, actionIds: ReadonlySet<string>, requirements: readonly JsonRecord[]): void {
  const mappings = record(value, "$.identityMappings");
  exactKeys(mappings, ["space", "users", "teams", "agents", "tasks"], "$.identityMappings");
  const space = record(mappings.space, "$.identityMappings.space");
  exactKeys(space, ["datasetSpaceId", "runtimeServiceId"], "$.identityMappings.space");
  string(space.datasetSpaceId, "$.identityMappings.space.datasetSpaceId");
  const service = record(space.runtimeServiceId, "$.identityMappings.space.runtimeServiceId");
  exactKeys(service, ["state", "requiredGate"], "$.identityMappings.space.runtimeServiceId");
  if (service.state !== "unresolved" || service.requiredGate !== "space-service-mapping") {
    invalid("$.identityMappings.space.runtimeServiceId must remain unresolved behind space-service-mapping");
  }
  if (!requirements.some((item) => item.kind === "space_service_mapping")) {
    invalid("space-service-mapping has no blocking requirement");
  }

  const seenUsers = new Set<string>();
  array(mappings.users, "$.identityMappings.users").forEach((item, index) => {
    const path = `$.identityMappings.users[${index}]`;
    const user = record(item, path);
    exactKeys(user, ["datasetUserId", "resolvedAuthUserId"], path);
    const id = string(user.datasetUserId, `${path}.datasetUserId`);
    if (seenUsers.has(id)) invalid(`duplicate dataset user ${id}`);
    seenUsers.add(id);
    const runtime = record(user.resolvedAuthUserId, `${path}.resolvedAuthUserId`);
    exactKeys(runtime, ["state", "requiredGate"], `${path}.resolvedAuthUserId`);
    if (runtime.state !== "unresolved" || runtime.requiredGate !== "auth-user-mapping") {
      invalid(`${path}.resolvedAuthUserId must remain unresolved behind auth-user-mapping`);
    }
  });
  if (requirements.filter((item) => item.kind === "auth_user_mapping").length < seenUsers.size) {
    invalid("auth-user-mapping requirements do not cover every dataset user");
  }

  const mappingGroups = [
    ["teams", "datasetTeamId", "runtimeTeamId"],
    ["agents", "datasetAgentId", "runtimeAgentId"],
  ] as const;
  mappingGroups.forEach(([groupName, datasetKey, runtimeKey]) => {
    const seen = new Set<string>();
    array(mappings[groupName], `$.identityMappings.${groupName}`).forEach((item, index) => {
      const path = `$.identityMappings.${groupName}[${index}]`;
      const mapping = record(item, path);
      exactKeys(mapping, [datasetKey, runtimeKey], path);
      const datasetId = string(mapping[datasetKey], `${path}.${datasetKey}`);
      if (seen.has(datasetId)) invalid(`duplicate ${datasetKey} ${datasetId}`);
      seen.add(datasetId);
      const runtime = record(mapping[runtimeKey], `${path}.${runtimeKey}`);
      exactKeys(runtime, ["state", "actionId"], `${path}.${runtimeKey}`);
      if (runtime.state !== "from-action-receipt") invalid(`${path}.${runtimeKey}.state must be from-action-receipt`);
      assertRefExists(string(runtime.actionId, `${path}.${runtimeKey}.actionId`), actionIds, `unknown identity action for ${datasetId}`);
    });
  });

  const seenTasks = new Set<string>();
  array(mappings.tasks, "$.identityMappings.tasks").forEach((item, index) => {
    const path = `$.identityMappings.tasks[${index}]`;
    const task = record(item, path);
    exactKeys(task, ["datasetTaskId", "transportTaskId", "runtimeTaskId"], path);
    const datasetTaskId = string(task.datasetTaskId, `${path}.datasetTaskId`);
    if (seenTasks.has(datasetTaskId)) invalid(`duplicate datasetTaskId ${datasetTaskId}`);
    seenTasks.add(datasetTaskId);
    string(task.transportTaskId, `${path}.transportTaskId`);
    const runtime = record(task.runtimeTaskId, `${path}.runtimeTaskId`);
    exactKeys(runtime, ["state", "actionId"], `${path}.runtimeTaskId`);
    if (runtime.state !== "from-action-receipt") invalid(`${path}.runtimeTaskId.state must be from-action-receipt`);
    assertRefExists(string(runtime.actionId, `${path}.runtimeTaskId.actionId`), actionIds, `unknown identity action for ${datasetTaskId}`);
  });
}

function validateVisibleSetsAndAssets(
  visibleValue: unknown,
  assetValue: unknown,
  actionIds: ReadonlySet<string>,
  requirementIds: ReadonlySet<string>,
): void {
  const visibleAssetIds = new Set<string>();
  const visibleHashes = new Set<string>();
  array(visibleValue, "$.selectedVisibleAssetSets").forEach((item, index) => {
    const path = `$.selectedVisibleAssetSets[${index}]`;
    const set = record(item, path);
    exactKeys(set, ["teamId", "userId", "agentId", "assetIds", "sha256"], path);
    string(set.teamId, `${path}.teamId`);
    string(set.userId, `${path}.userId`);
    string(set.agentId, `${path}.agentId`);
    stringArray(set.assetIds, `${path}.assetIds`).forEach((id) => visibleAssetIds.add(id));
    const setHash = hash(set.sha256, `${path}.sha256`);
    if (visibleHashes.has(setHash)) invalid(`duplicate visible asset set ${setHash}`);
    visibleHashes.add(setHash);
  });

  const plannedAssetIds = new Set<string>();
  array(assetValue, "$.assets").forEach((item, index) => {
    const path = `$.assets[${index}]`;
    const asset = record(item, path);
    exactKeys(asset, ["formalAssetId", "family", "subtype", "ownerAgentId", "contentHash", "receipt"], path);
    const id = string(asset.formalAssetId, `${path}.formalAssetId`);
    if (plannedAssetIds.has(id)) invalid(`duplicate formal asset ${id}`);
    plannedAssetIds.add(id);
    literal(asset.family, ["memory", "skill", "knowledge"], `${path}.family`);
    literal(asset.subtype, ["l0", "l1", "l2", "l3", "skill", "wiki", "code_graph"], `${path}.subtype`);
    string(asset.ownerAgentId, `${path}.ownerAgentId`);
    hash(asset.contentHash, `${path}.contentHash`);
    const receipt = record(asset.receipt, `${path}.receipt`);
    const kind = literal(receipt.kind, ["conversation", "core-scope", "unresolved-import", "runtime-asset-id", "explicit-id", "scenario-path"], `${path}.receipt.kind`);
    if (kind === "conversation") {
      exactKeys(receipt, ["kind", "actionId", "requestedSessionId", "formalMessageIds", "runtimeMessageIdsPath", "mapping"], `${path}.receipt`);
      assertRefExists(string(receipt.actionId, `${path}.receipt.actionId`), actionIds, `unknown receipt action for ${id}`);
      string(receipt.requestedSessionId, `${path}.receipt.requestedSessionId`);
      stringArray(receipt.formalMessageIds, `${path}.receipt.formalMessageIds`);
      string(receipt.runtimeMessageIdsPath, `${path}.receipt.runtimeMessageIdsPath`);
      if (receipt.mapping !== "ordered-response") invalid(`${path}.receipt.mapping must be ordered-response`);
    } else if (kind === "core-scope") {
      exactKeys(receipt, ["kind", "actionId", "contentHash"], `${path}.receipt`);
      assertRefExists(string(receipt.actionId, `${path}.receipt.actionId`), actionIds, `unknown receipt action for ${id}`);
      hash(receipt.contentHash, `${path}.receipt.contentHash`);
    } else if (kind === "unresolved-import") {
      exactKeys(receipt, ["kind", "requirementId"], `${path}.receipt`);
      assertRefExists(string(receipt.requirementId, `${path}.receipt.requirementId`), requirementIds, `unknown receipt requirement for ${id}`);
    } else {
      exactKeys(receipt, ["kind", "actionId"], `${path}.receipt`);
      assertRefExists(string(receipt.actionId, `${path}.receipt.actionId`), actionIds, `unknown receipt action for ${id}`);
    }
  });
  if (plannedAssetIds.size !== visibleAssetIds.size
    || [...plannedAssetIds].some((id) => !visibleAssetIds.has(id))) {
    invalid("planned assets must exactly equal the selected visible asset union");
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value as JsonRecord)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

/**
 * Parse the only object accepted by a future runtime restore executor.
 * Hidden-test authorization is deliberately checked before `raw` is touched.
 */
export function parseFormalAssetRestorePlan(
  raw: unknown,
  options: ParseFormalAssetRestorePlanOptions,
): FormalAssetRestorePlan {
  if (options.expectedSplit === "hidden_test" && options.allowHiddenTest !== true) {
    invalid("hidden_test access must be explicitly authorized before plan input is read");
  }

  let detached: unknown;
  try {
    detached = structuredClone(raw);
  } catch {
    return invalid("input must be detached structured-clone-compatible evidence");
  }
  rejectForbiddenRuntimeKeys(detached);
  const plan = record(detached, "$");
  exactKeys(plan, [
    "schemaVersion", "split", "revision", "snapshot", "runtimePolicy", "executable",
    "formalMetricEligible", "credentialPolicy", "identityMappings", "selectedVisibleAssetSets",
    "assets", "requirements", "actions", "excludedUnreferencedAssetCount", "planSha256",
  ], "$");
  if (plan.schemaVersion !== "task1.formal-asset-restore-plan.v1") invalid("unsupported schemaVersion");
  const split = literal(plan.split, ["dev", "hidden_test"], "$.split");
  if (split !== options.expectedSplit) invalid(`split ${split} does not match expected ${options.expectedSplit}`);

  const revision = validateRevision(plan.revision, "$.revision");
  if (options.expectedRevision !== undefined
    && canonicalSha256(revision) !== canonicalSha256(options.expectedRevision)) {
    invalid("revision does not match the expected frozen data receipt");
  }
  const snapshot = record(plan.snapshot, "$.snapshot");
  exactKeys(snapshot, ["snapshotId", "sourcePackSha256", "snapshotContentHash", "sourceProjectionSha256"], "$.snapshot");
  string(snapshot.snapshotId, "$.snapshot.snapshotId");
  hash(snapshot.sourcePackSha256, "$.snapshot.sourcePackSha256");
  hash(snapshot.snapshotContentHash, "$.snapshot.snapshotContentHash");
  hash(snapshot.sourceProjectionSha256, "$.snapshot.sourceProjectionSha256");
  validateRuntimePolicy(plan.runtimePolicy);
  falseLiteral(plan.executable, "$.executable");
  falseLiteral(plan.formalMetricEligible, "$.formalMetricEligible");
  if (plan.credentialPolicy !== "execution-time user key only; no credential value is serialized") {
    invalid("credentialPolicy is not the frozen execution-time-only policy");
  }

  const { actions, ids: actionIds } = validateActions(plan.actions);
  const { requirements, ids: requirementIds } = validateRequirements(plan.requirements);
  validateDependencyGraph(actions, actionIds, requirements, requirementIds);
  validateIdentityMappings(plan.identityMappings, actionIds, requirements);
  validateVisibleSetsAndAssets(plan.selectedVisibleAssetSets, plan.assets, actionIds, requirementIds);
  integer(plan.excludedUnreferencedAssetCount, "$.excludedUnreferencedAssetCount", 0);

  const expectedPlanSha256 = hash(plan.planSha256, "$.planSha256");
  const { planSha256: _omitted, ...core } = plan;
  if (canonicalSha256(core) !== expectedPlanSha256) invalid("planSha256 does not match the canonical plan core");
  return deepFreeze(plan) as unknown as FormalAssetRestorePlan;
}
