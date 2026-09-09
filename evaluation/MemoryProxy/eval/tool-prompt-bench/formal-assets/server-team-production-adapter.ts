/** Loadable production restore adapter for the local server_team deployment. */
import type { FormalAssetRestoreAdapter } from "./restore-plan-runtime.js";
import type { FormalAssetRestorePlan } from "./restore-plan-contract.js";
import {
  executeProductionRestorePlan,
  type ProductionAssetRestoreReceipt,
  type ProductionRestoreRuntimeBindings,
} from "./production-restore-executor.js";
import { createServerTeamProductionTransport } from "./server-team-production-transport.js";
import {
  createServerTeamRequirementResolver,
  discoverFrozenSkillPackageRoots,
} from "./server-team-production-requirements.js";
import { createServerTeamMemoryImportHooks } from "./server-team-memory-import-client.js";

export class ServerTeamProductionAdapterConfigError extends Error {
  readonly code = "INVALID_SERVER_TEAM_PRODUCTION_ADAPTER_CONFIG" as const;

  constructor(message: string) {
    super(`server_team production adapter config: ${message}`);
    this.name = "ServerTeamProductionAdapterConfigError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

export interface ExecuteServerTeamProductionRestoreOptions {
  readonly env: Environment;
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}

interface RuntimeConfig {
  readonly memoryCoreBaseUrl: string;
  readonly memoryKnowledgeBaseUrl: string;
  readonly memoryCoreApiKey: string;
  readonly userKey: string;
  readonly runtimeServiceId: string;
  readonly runtimeAuthUserId: string;
  readonly frozenDataRoot: string;
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ServerTeamProductionAdapterConfigError(`${name} is required`);
  return value;
}

function runtimeConfig(env: Environment): RuntimeConfig {
  return {
    memoryCoreBaseUrl: required(env, "TDAI_FORMAL_MEMORY_CORE_URL"),
    memoryKnowledgeBaseUrl: required(env, "TDAI_FORMAL_MEMORY_KNOWLEDGE_URL"),
    memoryCoreApiKey: required(env, "TDAI_FORMAL_MEMORY_CORE_API_KEY"),
    userKey: required(env, "TDAI_EVAL_USER_KEY"),
    runtimeServiceId: required(env, "TDAI_FORMAL_RUNTIME_SERVICE_ID"),
    runtimeAuthUserId: required(env, "TDAI_FORMAL_RUNTIME_AUTH_USER_ID"),
    frozenDataRoot: required(env, "TDAI_FORMAL_DATA_ROOT"),
  };
}

function runtimeBindings(
  plan: FormalAssetRestorePlan,
  config: RuntimeConfig,
): ProductionRestoreRuntimeBindings {
  const datasetSpaceId = plan.identityMappings.space.datasetSpaceId;
  if (!datasetSpaceId) {
    throw new ServerTeamProductionAdapterConfigError("plan has no dataset Space mapping");
  }
  if (plan.identityMappings.users.length === 0) {
    throw new ServerTeamProductionAdapterConfigError("plan has no dataset user mappings");
  }
  return {
    serviceIdsByDatasetSpaceId: { [datasetSpaceId]: config.runtimeServiceId },
    authUserIdsByDatasetUserId: Object.fromEntries(
      plan.identityMappings.users.map((mapping) => [
        mapping.datasetUserId,
        config.runtimeAuthUserId,
      ]),
    ),
    // Production ids are derived after Team/Agent creation by the executor.
    chatMemoryAssetIdsByDatasetAgentId: {},
  };
}

function runtimeSkillMetadata(
  plan: FormalAssetRestorePlan,
): Readonly<{
  names: Readonly<Record<string, string>>;
  descriptions: Readonly<Record<string, string>>;
}> {
  const names: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const action of plan.actions) {
    if (action.endpoint !== "/v3/skill/create") continue;
    const body = action.body as Readonly<Record<string, unknown>>;
    const metadata = body.metadata;
    const formalAssetId = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Readonly<Record<string, unknown>>).formalAssetId
      : undefined;
    const description = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Readonly<Record<string, unknown>>).description
      : undefined;
    const name = body.name;
    if (typeof formalAssetId !== "string" || !formalAssetId.trim()
      || typeof name !== "string" || !name.trim()
      || typeof description !== "string" || !description.trim()) {
      throw new ServerTeamProductionAdapterConfigError(
        `Skill action ${action.actionId} has no formal asset id, runtime name, or description`,
      );
    }
    if ((names[formalAssetId] && names[formalAssetId] !== name)
      || (descriptions[formalAssetId] && descriptions[formalAssetId] !== description)) {
      throw new ServerTeamProductionAdapterConfigError(
        `Skill ${formalAssetId} has conflicting runtime metadata`,
      );
    }
    names[formalAssetId] = name;
    descriptions[formalAssetId] = description;
  }
  return Object.freeze({
    names: Object.freeze(names),
    descriptions: Object.freeze(descriptions),
  });
}

/** Compose and execute restore without starting either service or running a model. */
export async function executeServerTeamProductionRestore(
  plan: FormalAssetRestorePlan,
  options: ExecuteServerTeamProductionRestoreOptions,
): Promise<ProductionAssetRestoreReceipt> {
  const config = runtimeConfig(options.env);
  const bindings = runtimeBindings(plan, config);
  const skillMetadata = runtimeSkillMetadata(plan);
  const skillPackageRoots = await discoverFrozenSkillPackageRoots(config.frozenDataRoot);
  const transport = createServerTeamProductionTransport({
    memoryCoreBaseUrl: config.memoryCoreBaseUrl,
    memoryKnowledgeBaseUrl: config.memoryKnowledgeBaseUrl,
    memoryCoreApiKey: config.memoryCoreApiKey,
    userKey: config.userKey,
    serviceIdsByDatasetSpaceId: bindings.serviceIdsByDatasetSpaceId,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const datasetUserId = plan.identityMappings.users[0]!.datasetUserId;
  const memoryHooks = createServerTeamMemoryImportHooks({
    transport,
    datasetSpaceId: plan.identityMappings.space.datasetSpaceId,
    datasetUserId,
  });
  const resolveRequirement = createServerTeamRequirementResolver({
    serviceIdsByDatasetSpaceId: bindings.serviceIdsByDatasetSpaceId,
    authUserIdsByDatasetUserId: bindings.authUserIdsByDatasetUserId,
    skillPackageRoots,
    runtimeSkillNamesByFormalAssetId: skillMetadata.names,
    runtimeSkillDescriptionsByFormalAssetId: skillMetadata.descriptions,
    importMemoryL1: memoryHooks.importMemoryL1,
    importMemoryL2: memoryHooks.importMemoryL2,
  });
  return executeProductionRestorePlan({
    plan,
    bindings,
    resolveRequirement,
    transport,
  });
}

/** Export name required by restore-plan-runtime.ts dynamic adapter boundary. */
export const executeFormalAssetRestorePlan: FormalAssetRestoreAdapter["executeFormalAssetRestorePlan"] =
  async (plan) => executeServerTeamProductionRestore(plan, { env: process.env });
