/** Production read-back inspector for a restored local server_team snapshot. */
import { createHash } from "node:crypto";

import type {
  FormalAssetInspectionAdapter,
  FormalAssetInspectionContext,
  FormalAssetRuntimeObservations,
} from "./restore-plan-runtime.js";
import type {
  FormalAssetRestorePlan,
  PlannedRestoreAsset,
} from "./restore-plan-contract.js";
import type {
  FormalAssetInventorySourceObservation,
  FormalAssetLocatorMapping,
  FormalExecutionPreflightInput,
  FormalRuntimeAssetLocator,
} from "../formal-execution-preflight.js";
import { canonicalSha256 } from "../formal-runtime/canonical.js";
import type {
  ProductionAssetRestoreReceipt,
  ProductionRestoreActionReceipt,
  ProductionRestoreRequirementReceipt,
} from "./production-restore-executor.js";

type JsonRecord = Record<string, unknown>;
type Environment = Readonly<Record<string, string | undefined>>;
type FetchImplementation = (input: string, init: RequestInit) => Promise<Response>;

export class ServerTeamProductionInspectorError extends Error {
  readonly code = "SERVER_TEAM_PRODUCTION_INSPECTION_FAILED" as const;
  constructor(message: string) {
    super(`server_team production inspector: ${message}`);
    this.name = "ServerTeamProductionInspectorError";
  }
}

export interface InspectServerTeamProductionOptions {
  readonly env: Environment;
  readonly fetchImpl?: FetchImplementation;
}

interface InspectorConfig {
  readonly memoryCoreBaseUrl: URL;
  readonly memoryKnowledgeBaseUrl: URL;
  readonly memoryProxyBaseUrl: URL;
  readonly memoryCoreApiKey: string;
  readonly userKey: string;
  readonly runtimeServiceId: string;
}

interface RawExchange {
  readonly path: string;
  readonly status: number;
  readonly envelopeCode: number;
  readonly body: JsonRecord;
  readonly contentSha256: string;
  readonly requestBodySha256: string;
}

interface RuntimeIdentity {
  readonly datasetUserId: string;
  readonly datasetSpaceId: string;
  readonly datasetTeamId: string;
  readonly datasetAgentId: string;
  readonly datasetTaskId: string;
  readonly resolvedUserId: string;
  readonly runtimeTeamId: string;
  readonly runtimeAgentId: string;
  readonly runtimeTaskId: string;
}

interface LocatedAsset {
  readonly asset: PlannedRestoreAsset;
  readonly locator: FormalRuntimeAssetLocator;
  readonly sourceAgentId: string;
  readonly skillName?: string;
}

function fail(message: string): never {
  throw new ServerTeamProductionInspectorError(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) return fail(`${label} must be non-blank`);
  return value;
}

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    return fail(`${label} must be a non-empty string array`);
  }
  return value as string[];
}

function baseUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail(`${label} must be an absolute URL`);
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password
    || parsed.search || parsed.hash) return fail(`${label} must be a credential-free HTTP(S) URL`);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
  return parsed;
}

function required(env: Environment, name: string): string {
  return string(env[name], name);
}

function config(env: Environment): InspectorConfig {
  return {
    memoryCoreBaseUrl: baseUrl(required(env, "TDAI_FORMAL_MEMORY_CORE_URL"), "MemoryCore URL"),
    memoryKnowledgeBaseUrl: baseUrl(
      required(env, "TDAI_FORMAL_MEMORY_KNOWLEDGE_URL"),
      "MemoryKnowledge URL",
    ),
    memoryProxyBaseUrl: baseUrl(required(env, "TDAI_FORMAL_MEMORY_PROXY_URL"), "MemoryProxy URL"),
    memoryCoreApiKey: required(env, "TDAI_FORMAL_MEMORY_CORE_API_KEY"),
    userKey: required(env, "TDAI_EVAL_USER_KEY"),
    runtimeServiceId: required(env, "TDAI_FORMAL_RUNTIME_SERVICE_ID"),
  };
}

async function getJson(
  fetchImpl: FetchImplementation,
  base: URL,
  path: string,
): Promise<RawExchange> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint(base, path), { method: "GET" });
  } catch {
    return fail(`${path} did not receive an HTTP response`);
  }
  const text = await response.text();
  let parsed: JsonRecord;
  try {
    parsed = record(JSON.parse(text) as unknown, `${path} response`);
  } catch {
    return fail(`${path} response was not JSON`);
  }
  return {
    path,
    status: response.status,
    envelopeCode: typeof parsed.code === "number" ? parsed.code : -1,
    body: parsed,
    contentSha256: sha256(text),
    requestBodySha256: sha256(""),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function endpoint(base: URL, path: string): string {
  return new URL(path.replace(/^\/+/, ""), base).toString();
}

async function postJson(
  fetchImpl: FetchImplementation,
  base: URL,
  path: string,
  body: Readonly<JsonRecord>,
  headers: Readonly<Record<string, string>>,
): Promise<RawExchange> {
  const serialized = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetchImpl(endpoint(base, path), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: serialized,
    });
  } catch {
    return fail(`${path} did not receive an HTTP response`);
  }
  const text = await response.text();
  let parsed: JsonRecord;
  try {
    parsed = record(JSON.parse(text) as unknown, `${path} response`);
  } catch {
    return fail(`${path} response was not JSON`);
  }
  return {
    path,
    status: response.status,
    envelopeCode: typeof parsed.code === "number" ? parsed.code : -1,
    body: parsed,
    contentSha256: sha256(text),
    requestBodySha256: sha256(serialized),
  };
}

function successful(exchange: RawExchange): JsonRecord {
  if (exchange.status !== 200 || exchange.envelopeCode !== 0) {
    return fail(`${exchange.path} failed with HTTP ${exchange.status}, code ${exchange.envelopeCode}`);
  }
  return record(exchange.body.data, `${exchange.path} data`);
}

/**
 * Refuse a campaign while Code Graph visibility can still change underneath
 * paired variants. This is a one-shot correctness check, not a retry layer:
 * operators wait for the real service to leave pending/processing, then rerun
 * the zero-model preflight.
 */
export async function assertServerTeamKnowledgeStable(input: {
  readonly memoryKnowledgeBaseUrl: string;
  readonly runtimeServiceId: string;
  readonly codeGraphIds: readonly string[];
  readonly fetchImpl?: FetchImplementation;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const knowledgeBase = baseUrl(input.memoryKnowledgeBaseUrl, "MemoryKnowledge URL");
  const autoSync = successful(await getJson(fetchImpl, knowledgeBase, "/v3/auto-sync/status"));
  const autoSyncConfig = record(autoSync.config, "auto-sync config");
  if (autoSyncConfig.enabled !== false || autoSync.running !== false
    || autoSync.scanning !== false || autoSync.activeSyncs !== 0) {
    return fail("MemoryKnowledge auto-sync must be disabled and idle for a paired campaign");
  }

  for (const codeGraphId of [...new Set(input.codeGraphIds)].sort()) {
    const detail = successful(await postJson(
      fetchImpl,
      knowledgeBase,
      "/v3/code-graph/get",
      { code_graph_id: codeGraphId },
      { "x-tdai-service-id": input.runtimeServiceId },
    ));
    if (detail.status !== "ready") {
      return fail(`Code Graph ${codeGraphId} is ${String(detail.status)}; formal preflight requires ready`);
    }
  }
}

function restoreReceipt(observations: FormalAssetRuntimeObservations): ProductionAssetRestoreReceipt {
  const receipt = record(observations.unverifiedObservations, "restore receipt");
  if (receipt.schemaVersion !== "task1.production-asset-restore-receipt.v1"
    || receipt.complete !== true || receipt.planSha256 !== observations.planSha256
    || receipt.split !== observations.split || !Array.isArray(receipt.actions)
    || !Array.isArray(receipt.requirements)) {
    return fail("restore observations do not contain a complete matching production receipt");
  }
  return receipt as unknown as ProductionAssetRestoreReceipt;
}

function action(receipt: ProductionAssetRestoreReceipt, actionId: string): ProductionRestoreActionReceipt {
  const found = receipt.actions.find((item) => item.actionId === actionId);
  if (!found) return fail(`restore receipt is missing action ${actionId}`);
  return found;
}

function capture(
  receipt: ProductionAssetRestoreReceipt,
  actionId: string,
  name: string,
): unknown {
  const value = action(receipt, actionId).captures[name];
  if (value === undefined) return fail(`restore action ${actionId} is missing capture ${name}`);
  return value;
}

function requirement(
  receipt: ProductionAssetRestoreReceipt,
  requirementId: string,
): ProductionRestoreRequirementReceipt {
  const found = receipt.requirements.find((item) => item.requirementId === requirementId);
  if (!found) return fail(`restore receipt is missing requirement ${requirementId}`);
  return found;
}

function resolveRuntimeIdentity(
  plan: FormalAssetRestorePlan,
  receipt: ProductionAssetRestoreReceipt,
  context: FormalAssetInspectionContext,
  resolvedUserId: string,
): RuntimeIdentity {
  const expected = context.expectedBinding;
  if (plan.identityMappings.space.datasetSpaceId !== expected.spaceId) {
    return fail("prepared run Space does not match the restore plan");
  }
  const team = plan.identityMappings.teams.find((item) => item.datasetTeamId === expected.teamId);
  const agent = plan.identityMappings.agents.find((item) => item.datasetAgentId === expected.agentId);
  // Prepared-run bindings carry the provider-safe transport Task id. The
  // restore plan retains both that id and the original dataset id so either
  // representation can be inspected without weakening the identity check.
  const task = plan.identityMappings.tasks.find(
    (item) => item.datasetTaskId === expected.taskId || item.transportTaskId === expected.taskId,
  );
  const user = plan.identityMappings.users.find((item) => item.datasetUserId === expected.datasetUserId);
  if (!team || !agent || !task || !user) return fail("prepared run identity is absent from the restore plan");
  return {
    datasetUserId: expected.datasetUserId,
    datasetSpaceId: expected.spaceId,
    datasetTeamId: expected.teamId,
    datasetAgentId: expected.agentId,
    datasetTaskId: expected.taskId,
    resolvedUserId,
    runtimeTeamId: string(capture(receipt, team.runtimeTeamId.actionId, "runtimeTeamId"), "runtime Team id"),
    runtimeAgentId: string(capture(receipt, agent.runtimeAgentId.actionId, "runtimeAgentId"), "runtime Agent id"),
    runtimeTaskId: string(capture(receipt, task.runtimeTaskId.actionId, "runtimeTaskId"), "runtime Task id"),
  };
}

function locateAsset(
  plan: FormalAssetRestorePlan,
  asset: PlannedRestoreAsset,
  receipt: ProductionAssetRestoreReceipt,
  runtime: RuntimeIdentity,
  serviceId: string,
): LocatedAsset {
  const proof = asset.receipt;
  const owner = plan.identityMappings.agents.find((item) => item.datasetAgentId === asset.ownerAgentId);
  if (!owner) return fail(`asset ${asset.formalAssetId} owner is absent from Agent mappings`);
  const runtimeOwnerAgentId = string(
    capture(receipt, owner.runtimeAgentId.actionId, "runtimeAgentId"),
    `${asset.formalAssetId} owner runtime Agent id`,
  );
  // Imported Memory is read under its real owner scope. Skill search/listing
  // and fixed Knowledge visibility are evaluated from the selected Agent.
  const sourceAgentId = asset.family === "memory" ? runtimeOwnerAgentId : runtime.runtimeAgentId;
  let locator: FormalRuntimeAssetLocator;
  if (proof.kind === "conversation") {
    locator = {
      kind: "conversation-message",
      sessionId: proof.requestedSessionId,
      messageIds: strings(capture(receipt, proof.actionId, "runtimeMessageIds"), `${asset.formalAssetId} message ids`),
    };
  } else if (proof.kind === "unresolved-import") {
    const evidence = record(requirement(receipt, proof.requirementId).evidence, `${asset.formalAssetId} import evidence`);
    locator = record(evidence.runtimeLocator, `${asset.formalAssetId} runtime locator`) as unknown as FormalRuntimeAssetLocator;
  } else if (proof.kind === "core-scope") {
    locator = {
      kind: "core-scope",
      spaceId: serviceId,
      teamId: runtime.runtimeTeamId,
      userId: runtime.resolvedUserId,
      agentId: sourceAgentId,
    };
  } else {
    locator = {
      kind: "asset-id",
      assetId: string(capture(receipt, proof.actionId, "runtimeAssetId"), `${asset.formalAssetId} runtime asset id`),
    };
  }
  let skillName: string | undefined;
  if (asset.subtype === "skill") {
    if (proof.kind !== "runtime-asset-id" && proof.kind !== "explicit-id") {
      return fail(`${asset.formalAssetId} Skill has no runtime action receipt`);
    }
    skillName = string(
      plan.actions.find((item) => item.actionId === proof.actionId)?.body.name,
      `${asset.formalAssetId} Skill name`,
    );
  }
  return { asset, locator, sourceAgentId, ...(skillName ? { skillName } : {}) };
}

function values(root: unknown, key: string): readonly string[] {
  if (!Array.isArray(root)) return [];
  return root.flatMap((item) => {
    const value = item && typeof item === "object" ? (item as JsonRecord)[key] : undefined;
    return typeof value === "string" ? [value] : [];
  });
}

function assertVisible(exchange: RawExchange, located: readonly LocatedAsset[]): void {
  const data = successful(exchange);
  const subtype = located[0]?.asset.subtype;
  let observed: readonly string[] = [];
  if (subtype === "l0") observed = values(data.messages, "id");
  else if (subtype === "l1") observed = values(data.items, "id").concat(values(data.items, "record_id"));
  else if (subtype === "l2") observed = typeof data.path === "string" ? [data.path] : [];
  else if (subtype === "l3") observed = typeof data.content === "string" && data.content.length > 0 ? ["core"] : [];
  else if (subtype === "skill") {
    observed = exchange.path === "/v3/skill/search"
      ? values(data.items, "skill_id")
      : values(data.hits, "skill_id");
  }
  else observed = values(data.items, "asset_id");

  for (const item of located) {
    const locator = item.locator;
    const present = locator.kind === "conversation-message"
      ? locator.messageIds.every((id) => observed.includes(id))
      : locator.kind === "asset-id"
        ? observed.includes(locator.assetId)
        : locator.kind === "scenario-path"
          ? observed.includes(locator.path)
          : observed.includes("core");
    if (!present) fail(`${exchange.path} did not read back ${item.asset.formalAssetId}`);
  }
}

function inventorySource(
  exchange: RawExchange,
  family: "memory" | "skill" | "knowledge",
  located: readonly LocatedAsset[],
  runtime: RuntimeIdentity,
  serviceId: string,
): FormalAssetInventorySourceObservation {
  assertVisible(exchange, located);
  const receiptSha256 = canonicalSha256({
    schemaVersion: "task1.formal-read-back-receipt.v1",
    serviceId,
    resolvedUserId: runtime.resolvedUserId,
    teamId: runtime.runtimeTeamId,
    agentId: located[0]?.sourceAgentId ?? fail("read-back source has no assets"),
    path: exchange.path,
    requestBodySha256: exchange.requestBodySha256,
    httpStatus: exchange.status,
    envelopeCode: exchange.envelopeCode,
    contentSha256: exchange.contentSha256,
  });
  return {
    serviceId,
    resolvedUserId: runtime.resolvedUserId,
    teamId: runtime.runtimeTeamId,
    agentId: located[0]?.sourceAgentId ?? fail("read-back source has no assets"),
    family,
    requestPath: exchange.path,
    httpStatus: exchange.status,
    envelopeCode: exchange.envelopeCode,
    contentSha256: exchange.contentSha256,
    receiptSha256,
    items: located.map((item) => ({ subtype: item.asset.subtype, runtimeLocator: item.locator })),
  };
}

function selectedAssets(
  plan: FormalAssetRestorePlan,
  context: FormalAssetInspectionContext,
): readonly PlannedRestoreAsset[] {
  const expected = context.expectedBinding;
  const visible = plan.selectedVisibleAssetSets.find((set) => set.teamId === expected.teamId
    && set.userId === expected.datasetUserId && set.agentId === expected.agentId);
  if (!visible || visible.sha256 !== expected.visibleAssetSetSha256) {
    return fail("prepared run visible asset set does not match the restore plan");
  }
  const byId = new Map(plan.assets.map((asset) => [asset.formalAssetId, asset]));
  return visible.assetIds.map((id) => byId.get(id) ?? fail(`visible asset ${id} is absent from plan assets`));
}

async function readBackAssets(
  fetchImpl: FetchImplementation,
  cfg: InspectorConfig,
  runtime: RuntimeIdentity,
  located: readonly LocatedAsset[],
): Promise<readonly FormalAssetInventorySourceObservation[]> {
  const headers = {
    authorization: `Bearer ${cfg.memoryCoreApiKey}`,
    "x-tdai-service-id": cfg.runtimeServiceId,
    "x-tdai-user-key": cfg.userKey,
  };
  const sources: FormalAssetInventorySourceObservation[] = [];
  const add = async (
    family: "memory" | "skill" | "knowledge",
    path: string,
    body: JsonRecord,
    assets: readonly LocatedAsset[],
  ): Promise<void> => {
    if (assets.length === 0) return;
    const exchange = await postJson(fetchImpl, cfg.memoryCoreBaseUrl, path, body, headers);
    sources.push(inventorySource(exchange, family, assets, runtime, cfg.runtimeServiceId));
  };

  const memoriesByAgent = new Map<string, LocatedAsset[]>();
  for (const item of located.filter((entry) => entry.asset.family === "memory")) {
    const group = memoriesByAgent.get(item.sourceAgentId) ?? [];
    group.push(item);
    memoriesByAgent.set(item.sourceAgentId, group);
  }
  for (const [sourceAgentId, memoryAssets] of memoriesByAgent) {
    const common = {
      team_id: runtime.runtimeTeamId,
      user_id: runtime.resolvedUserId,
      agent_id: sourceAgentId,
    };
    const l0BySession = new Map<string, LocatedAsset[]>();
    const l0 = memoryAssets.filter((item) => item.asset.subtype === "l0");
    for (const item of l0) {
      const locator = item.locator as Extract<FormalRuntimeAssetLocator, { kind: "conversation-message" }>;
      const group = l0BySession.get(locator.sessionId) ?? [];
      group.push(item);
      l0BySession.set(locator.sessionId, group);
    }
    for (const [sessionId, assets] of l0BySession) {
      await add("memory", "/v3/conversation/query", {
        ...common, session_id: sessionId, limit: 100, offset: 0,
      }, assets);
    }
    await add("memory", "/v3/atomic/query", { ...common, limit: 100, offset: 0 },
      memoryAssets.filter((item) => item.asset.subtype === "l1"));
    for (const item of memoryAssets.filter((entry) => entry.asset.subtype === "l2")) {
      const locator = item.locator as Extract<FormalRuntimeAssetLocator, { kind: "scenario-path" }>;
      await add("memory", "/v3/scenario/read", { ...common, path: locator.path }, [item]);
    }
    const l3 = memoryAssets.filter((item) => item.asset.subtype === "l3");
    if (l3.length > 1) fail("a prepared run cannot map multiple L3 assets to one core scope");
    await add("memory", "/v3/core/read", common, l3);
  }
  const selectedCommon = {
    team_id: runtime.runtimeTeamId,
    user_id: runtime.resolvedUserId,
    agent_id: runtime.runtimeAgentId,
  };
  // The Formal visible Skill set is team-searchable A union current-Agent B,
  // while listing alone contains only the current Agent's own/bound Skills.
  // Search each frozen name with scope=team so shared Skills are proven too.
  for (const item of located.filter((entry) => entry.asset.subtype === "skill")) {
    await add("skill", "/v3/skill/search", {
      ...selectedCommon,
      query: item.skillName ?? fail(`${item.asset.formalAssetId} has no Skill name`),
      top_k: 50,
      scope: "team",
    }, [item]);
  }
  const knowledge = located.filter((item) => item.asset.family === "knowledge");
  await add("knowledge", "/v3/meta/agent-fixed-asset/list-with-detail", {
    agent_id: runtime.runtimeAgentId,
    apply_visibility_filter: true,
    asset_types: [...new Set(knowledge.map((item) => item.asset.subtype === "wiki" ? "llm_wiki" : "code_graph"))],
    limit: 100,
    offset: 0,
  }, knowledge);
  return sources;
}

function dataItems(exchange: RawExchange): readonly JsonRecord[] {
  const items = successful(exchange).items;
  if (!Array.isArray(items)) return fail(`${exchange.path} data.items must be an array`);
  return items.map((item, index) => record(item, `${exchange.path} data.items[${index}]`));
}

/** Inspect one prepared run without reading Cases, queries, Gold, or provider state. */
export async function inspectServerTeamProductionAssets(
  plan: FormalAssetRestorePlan,
  restoreObservations: FormalAssetRuntimeObservations,
  context: FormalAssetInspectionContext,
  options: InspectServerTeamProductionOptions,
): Promise<FormalExecutionPreflightInput> {
  const cfg = config(options.env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const coreHeaders = {
    authorization: `Bearer ${cfg.memoryCoreApiKey}`,
    "x-tdai-service-id": cfg.runtimeServiceId,
    "x-tdai-user-key": cfg.userKey,
  };
  const auth = await postJson(fetchImpl, cfg.memoryCoreBaseUrl, "/v3/meta/auth/verify", {
    user_key: cfg.userKey,
  }, {
    authorization: `Bearer ${cfg.memoryCoreApiKey}`,
    "x-tdai-service-id": cfg.runtimeServiceId,
  });
  const authData = successful(auth);
  const authUser = record(authData.user, "auth user");
  if (authData.valid !== true) fail("auth/verify did not return valid=true");
  const resolvedUserId = string(authUser.user_id, "resolved auth user id");

  const receipt = restoreReceipt(restoreObservations);
  const runtime = resolveRuntimeIdentity(plan, receipt, context, resolvedUserId);
  const assets = selectedAssets(plan, context);
  const located = assets.map((asset) => locateAsset(plan, asset, receipt, runtime, cfg.runtimeServiceId));

  await assertServerTeamKnowledgeStable({
    memoryKnowledgeBaseUrl: cfg.memoryKnowledgeBaseUrl.toString(),
    runtimeServiceId: cfg.runtimeServiceId,
    codeGraphIds: located
      .filter((item) => item.asset.subtype === "code_graph")
      .map((item) => item.locator.kind === "asset-id"
        ? item.locator.assetId
        : fail(`${item.asset.formalAssetId} Code Graph has no runtime asset id`)),
    fetchImpl,
  });

  const [teamsExchange, agentsExchange, tasksExchange, inventory] = await Promise.all([
    postJson(fetchImpl, cfg.memoryCoreBaseUrl, "/v3/meta/team/list", {
      user_id: resolvedUserId, limit: 100, offset: 0,
    }, coreHeaders),
    postJson(fetchImpl, cfg.memoryCoreBaseUrl, "/v3/meta/agent/list", {
      team_id: runtime.runtimeTeamId, owner_user_id: resolvedUserId, status: "active", limit: 100, offset: 0,
    }, coreHeaders),
    postJson(fetchImpl, cfg.memoryCoreBaseUrl, "/v3/meta/task/list", {
      team_id: runtime.runtimeTeamId, status: "running", limit: 100, offset: 0,
    }, coreHeaders),
    readBackAssets(fetchImpl, cfg, runtime, located),
  ]);
  const teamRows = dataItems(teamsExchange);
  const agentRows = dataItems(agentsExchange);
  const taskRows = dataItems(tasksExchange);
  // Register the opaque Session only after every read-only identity and asset
  // check passed. A broken read-back must not consume the fresh namespace and
  // make a corrected rerun fail for an unrelated reason.
  const proxyExchange = await postJson(
    fetchImpl,
    cfg.memoryProxyBaseUrl,
    "/v3/formal-bench/preflight-session",
    {
      service_id: cfg.runtimeServiceId,
      session_id: context.expectedBinding.sessionId,
      team_id: runtime.runtimeTeamId,
      agent_id: runtime.runtimeAgentId,
      task_id: runtime.runtimeTaskId,
      agent_source: context.expectedBinding.agentSource,
    },
    { "x-tdai-user-key": cfg.userKey },
  );
  const proxyData = successful(proxyExchange);
  const session = record(proxyData.session, "preflight session");
  const sessionNamespace = record(proxyData.sessionNamespace, "preflight session namespace");
  const effectiveWriteConfig = record(proxyData.effectiveWriteConfig, "preflight write config");

  const receiptByLocator = new Map<string, string>();
  for (const source of inventory) {
    for (const item of source.items) {
      receiptByLocator.set(canonicalSha256({
        family: source.family, subtype: item.subtype, sourceAgentId: source.agentId,
        locator: item.runtimeLocator,
      }), source.receiptSha256);
    }
  }
  const assetLocators: FormalAssetLocatorMapping[] = located.map((item) => {
    const key = canonicalSha256({
      family: item.asset.family, subtype: item.asset.subtype, sourceAgentId: item.sourceAgentId,
      locator: item.locator,
    });
    return {
      logicalAssetId: item.asset.formalAssetId,
      family: item.asset.family,
      subtype: item.asset.subtype,
      sourceAgentId: item.sourceAgentId,
      runtimeLocator: item.locator,
      readBackReceiptSha256: receiptByLocator.get(key) ?? fail(`no read-back receipt for ${item.asset.formalAssetId}`),
    };
  });
  const sourceArtifactSha256 = canonicalSha256({
    schemaVersion: "task1.formal-runtime-identity-mapping.v1",
    planSha256: plan.planSha256,
    restoreReceiptSha256: canonicalSha256(receipt),
    logicalIdentity: context.expectedBinding,
    runtimeIdentity: runtime,
    assetLocators,
  });

  return {
    expected: context.expectedBinding,
    identityMapping: {
      sourceArtifactSha256,
      logicalIdentity: {
        datasetUserId: runtime.datasetUserId,
        spaceId: runtime.datasetSpaceId,
        teamId: runtime.datasetTeamId,
        agentId: runtime.datasetAgentId,
        taskId: runtime.datasetTaskId,
      },
      runtimeIdentity: {
        resolvedAuthUserId: resolvedUserId,
        spaceId: cfg.runtimeServiceId,
        teamId: runtime.runtimeTeamId,
        agentId: runtime.runtimeAgentId,
        taskId: runtime.runtimeTaskId,
      },
      assetLocators,
    },
    authVerify: {
      serviceId: cfg.runtimeServiceId,
      httpStatus: auth.status,
      envelopeCode: auth.envelopeCode,
      responseValid: authData.valid === true,
      resolvedUserId,
    },
    metadata: {
      serviceId: cfg.runtimeServiceId,
      resolvedUserId,
      httpStatus: Math.max(teamsExchange.status, agentsExchange.status, tasksExchange.status),
      envelopeCode: Math.max(teamsExchange.envelopeCode, agentsExchange.envelopeCode, tasksExchange.envelopeCode),
      teams: teamRows.map((team) => ({
        teamId: string(team.team_id, "metadata team id"),
        agentIds: agentRows
          .filter((agent) => agent.team_id === team.team_id)
          .map((agent) => string(agent.agent_id, "metadata agent id")),
        taskIds: taskRows
          .filter((task) => task.team_id === team.team_id)
          .map((task) => string(task.task_id, "metadata task id")),
      })),
    },
    session: session as unknown as FormalExecutionPreflightInput["session"],
    assetInventory: { sources: inventory },
    effectiveWriteConfig: effectiveWriteConfig as unknown as FormalExecutionPreflightInput["effectiveWriteConfig"],
    sessionNamespace: sessionNamespace as unknown as FormalExecutionPreflightInput["sessionNamespace"],
  };
}

/** Dynamic adapter export consumed by inspect-formal-snapshot.ts. */
export const inspectFormalAssetRestorePlan: FormalAssetInspectionAdapter["inspectFormalAssetRestorePlan"] =
  async (plan, restoreObservations, context) => inspectServerTeamProductionAssets(
    plan,
    restoreObservations,
    context,
    { env: process.env },
  );
