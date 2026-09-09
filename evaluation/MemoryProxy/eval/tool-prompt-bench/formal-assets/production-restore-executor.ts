/**
 * Deterministic executor for the server_team production restore plan.
 *
 * This module owns orchestration only. Concrete HTTP transport and the
 * deployment-specific L1/L2/knowledge importers are injected at the boundary,
 * which keeps unit tests network-free and prevents credentials from entering
 * persisted receipts.
 */
import type {
  FormalAssetRestorePlan,
  RestorePlanAction,
  RestorePlanRequirement,
  RuntimeValueRef,
} from "./restore-plan-contract.js";

export type FormalProductionRestoreErrorCode =
  | "ACTION_DEPENDENCY_UNMET"
  | "ACTION_BLOCKED"
  | "RUNTIME_REF_UNRESOLVED"
  | "REQUIREMENT_FAILED"
  | "REQUIREMENT_UNRESOLVED"
  | "ACTION_HTTP_FAILED"
  | "ACTION_API_FAILED"
  | "CAPTURE_PATH_MISSING";

export class FormalProductionRestoreError extends Error {
  constructor(
    readonly code: FormalProductionRestoreErrorCode,
    readonly subjectId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`Formal production restore [${code}] ${subjectId}: ${message}`, options);
    this.name = "FormalProductionRestoreError";
  }
}

export interface ProductionRestoreRuntimeBindings {
  readonly serviceIdsByDatasetSpaceId: Readonly<Record<string, string>>;
  readonly authUserIdsByDatasetUserId: Readonly<Record<string, string>>;
  readonly chatMemoryAssetIdsByDatasetAgentId: Readonly<Record<string, string>>;
}

export interface ProductionRestoreTransportRequest {
  readonly actionId: string;
  readonly serviceBoundary: RestorePlanAction["serviceBoundary"];
  readonly method: RestorePlanAction["method"];
  readonly endpoint: string;
  readonly executionIdentity: RestorePlanAction["executionIdentity"];
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface ProductionRestoreTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

export type ProductionRestoreTransport = (
  request: ProductionRestoreTransportRequest,
) => Promise<ProductionRestoreTransportResponse>;

export interface ProductionRestoreRequirementContext {
  /** Resolve runtime refs in an importer payload after its action prerequisites. */
  readonly resolve: <T>(value: T) => T;
}

export interface ProductionRestoreRequirementResult {
  /**
   * Runtime-only values consumed by later plan refs. Never serialized.
   * Skill package resolvers provide verified_skill_entry_content/resources here.
   */
  readonly values: Readonly<Record<string, unknown>>;
  /** Non-secret, JSON-compatible verification summary persisted in the receipt. */
  readonly evidence: unknown;
}

export type ProductionRestoreRequirementResolver = (
  requirement: RestorePlanRequirement,
  context: ProductionRestoreRequirementContext,
) => Promise<ProductionRestoreRequirementResult>;

export interface ProductionRestoreActionReceipt {
  readonly actionId: string;
  readonly serviceBoundary: RestorePlanAction["serviceBoundary"];
  readonly endpoint: string;
  readonly httpStatus: number;
  readonly captures: Readonly<Record<string, unknown>>;
}

export interface ProductionRestoreRequirementReceipt {
  readonly requirementId: string;
  readonly kind: RestorePlanRequirement["kind"];
  readonly evidence: unknown;
}

export interface ProductionAssetRestoreReceipt {
  readonly schemaVersion: "task1.production-asset-restore-receipt.v1";
  readonly split: FormalAssetRestorePlan["split"];
  readonly planSha256: string;
  readonly complete: true;
  readonly actionCount: number;
  readonly requirementCount: number;
  readonly actions: readonly ProductionRestoreActionReceipt[];
  readonly requirements: readonly ProductionRestoreRequirementReceipt[];
}

export interface ExecuteProductionRestorePlanInput {
  readonly plan: FormalAssetRestorePlan;
  readonly bindings: ProductionRestoreRuntimeBindings;
  readonly resolveRequirement: ProductionRestoreRequirementResolver;
  readonly transport: ProductionRestoreTransport;
}

type JsonRecord = Record<string, unknown>;

const ACTION_CAPTURE_BY_RUNTIME_REF: Readonly<Record<string, string>> = {
  runtime_team_id: "runtimeTeamId",
  runtime_agent_id: "runtimeAgentId",
  runtime_asset_id: "runtimeAssetId",
  knowledge_service_url: "serviceUrl",
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneReceiptValue<T>(value: T, subjectId: string): T {
  try {
    return structuredClone(value) as T;
  } catch (cause) {
    throw new FormalProductionRestoreError(
      "REQUIREMENT_FAILED",
      subjectId,
      "receipt evidence must be structured-clone-compatible",
      { cause },
    );
  }
}

function getPath(root: unknown, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  let cursor = root;
  for (const segment of segments) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function isRuntimeRef(value: unknown): value is RuntimeValueRef {
  return isRecord(value) && typeof value.$runtimeRef === "string";
}

function externalBinding(
  ref: RuntimeValueRef,
  bindings: ProductionRestoreRuntimeBindings,
): unknown {
  if (ref.logicalId === undefined) return undefined;
  if (ref.$runtimeRef === "runtime_service_id") {
    return bindings.serviceIdsByDatasetSpaceId[ref.logicalId];
  }
  if (ref.$runtimeRef === "resolved_auth_user_id") {
    return bindings.authUserIdsByDatasetUserId[ref.logicalId];
  }
  if (ref.$runtimeRef === "derived_chat_memory_asset_id") {
    return bindings.chatMemoryAssetIdsByDatasetAgentId[ref.logicalId];
  }
  return undefined;
}

function resolveRef(
  ref: RuntimeValueRef,
  subjectId: string,
  plan: FormalAssetRestorePlan,
  bindings: ProductionRestoreRuntimeBindings,
  actionCaptures: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  requirementValues: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): unknown {
  const bound = externalBinding(ref, bindings);
  if (bound !== undefined) return bound;

  if (ref.$runtimeRef === "derived_chat_memory_asset_id" && ref.logicalId !== undefined) {
    const agentAction = ref.actionId === undefined
      ? plan.actions.find((action) => action.executionIdentity.datasetAgentId === ref.logicalId)
      : plan.actions.find((action) => action.actionId === ref.actionId);
    const datasetTeamId = agentAction?.executionIdentity.datasetTeamId;
    const runtimeAgentId = agentAction === undefined
      ? undefined
      : actionCaptures.get(agentAction.actionId)?.runtimeAgentId;
    const teamAction = datasetTeamId === undefined
      ? undefined
      : plan.actions.find((action) =>
        action.executionIdentity.datasetTeamId === datasetTeamId
        && Object.hasOwn(action.captures, "runtimeTeamId")
      );
    const runtimeTeamId = teamAction === undefined
      ? undefined
      : actionCaptures.get(teamAction.actionId)?.runtimeTeamId;
    if (typeof runtimeTeamId === "string" && typeof runtimeAgentId === "string") {
      return `chat_memory-${runtimeTeamId}-${runtimeAgentId}`;
    }
  }

  if (ref.actionId !== undefined) {
    const requirementValue = requirementValues.get(ref.actionId)?.[ref.$runtimeRef];
    if (requirementValue !== undefined) return requirementValue;

    const captureName = ACTION_CAPTURE_BY_RUNTIME_REF[ref.$runtimeRef];
    const captured = captureName === undefined
      ? undefined
      : actionCaptures.get(ref.actionId)?.[captureName];
    if (captured !== undefined) return captured;
  }

  throw new FormalProductionRestoreError(
    "RUNTIME_REF_UNRESOLVED",
    subjectId,
    `${ref.$runtimeRef}${ref.logicalId ? ` for ${ref.logicalId}` : ""}`,
  );
}

function resolveNested<T>(
  value: T,
  subjectId: string,
  plan: FormalAssetRestorePlan,
  bindings: ProductionRestoreRuntimeBindings,
  actionCaptures: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  requirementValues: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): T {
  if (isRuntimeRef(value)) {
    return resolveRef(
      value,
      subjectId,
      plan,
      bindings,
      actionCaptures,
      requirementValues,
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((child) => resolveNested(
      child,
      subjectId,
      plan,
      bindings,
      actionCaptures,
      requirementValues,
    )) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      resolveNested(child, subjectId, plan, bindings, actionCaptures, requirementValues),
    ])) as T;
  }
  return value;
}

function validateSuccessEnvelope(action: RestorePlanAction, response: ProductionRestoreTransportResponse): JsonRecord {
  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    throw new FormalProductionRestoreError(
      "ACTION_HTTP_FAILED",
      action.actionId,
      `HTTP ${response.status}`,
    );
  }
  if (!isRecord(response.body) || response.body.code !== 0) {
    throw new FormalProductionRestoreError(
      "ACTION_API_FAILED",
      action.actionId,
      "response envelope code must equal 0",
    );
  }
  return response.body;
}

function captureResponse(
  action: RestorePlanAction,
  responseBody: JsonRecord,
): Readonly<Record<string, unknown>> {
  const captures: JsonRecord = {};
  for (const [name, path] of Object.entries(action.captures)) {
    const value = getPath({ response: responseBody }, path);
    if (value === undefined) {
      throw new FormalProductionRestoreError(
        "CAPTURE_PATH_MISSING",
        action.actionId,
        `${name} at ${path}`,
      );
    }
    captures[name] = cloneReceiptValue(value, action.actionId);
  }
  return Object.freeze(captures);
}

/**
 * Execute the already-validated frozen plan in its declared order.
 *
 * Requirements become runnable only after their declared prerequisite actions.
 * Any unresolved requirement or runtime ref stops the run before the dependent
 * request is sent. The returned receipt intentionally excludes request bodies,
 * headers, runtime bindings, requirement values, and raw response envelopes.
 */
export async function executeProductionRestorePlan(
  input: ExecuteProductionRestorePlanInput,
): Promise<ProductionAssetRestoreReceipt> {
  const completedActions = new Set<string>();
  const actionCaptures = new Map<string, Readonly<Record<string, unknown>>>();
  const requirementValues = new Map<string, Readonly<Record<string, unknown>>>();
  const actionReceipts: ProductionRestoreActionReceipt[] = [];
  const requirementReceipts: ProductionRestoreRequirementReceipt[] = [];

  const resolveValue = <T>(value: T, subjectId: string): T => resolveNested(
    value,
    subjectId,
    input.plan,
    input.bindings,
    actionCaptures,
    requirementValues,
  );

  const resolveReadyRequirements = async (): Promise<void> => {
    for (const requirement of input.plan.requirements) {
      if (requirementValues.has(requirement.requirementId)) continue;
      const dependencies = requirement.dependsOnActions ?? [];
      if (!dependencies.every((id) => completedActions.has(id))) continue;

      let result: ProductionRestoreRequirementResult;
      try {
        result = await input.resolveRequirement(requirement, {
          resolve: <T>(value: T) => resolveValue(value, requirement.requirementId),
        });
      } catch (cause) {
        throw new FormalProductionRestoreError(
          "REQUIREMENT_FAILED",
          requirement.requirementId,
          "deployment requirement resolver failed",
          { cause },
        );
      }
      if (!isRecord(result.values)) {
        throw new FormalProductionRestoreError(
          "REQUIREMENT_FAILED",
          requirement.requirementId,
          "resolver values must be an object",
        );
      }
      requirementValues.set(requirement.requirementId, Object.freeze({ ...result.values }));
      requirementReceipts.push(Object.freeze({
        requirementId: requirement.requirementId,
        kind: requirement.kind,
        evidence: cloneReceiptValue(result.evidence, requirement.requirementId),
      }));
    }
  };

  await resolveReadyRequirements();

  for (const action of input.plan.actions) {
    const missingDependency = action.dependsOn.find((id) => !completedActions.has(id));
    if (missingDependency !== undefined) {
      throw new FormalProductionRestoreError(
        "ACTION_DEPENDENCY_UNMET",
        action.actionId,
        `missing completed action ${missingDependency}`,
      );
    }

    await resolveReadyRequirements();
    const unresolvedBlocker = (action.blockedByRequirements ?? [])
      .find((id) => !requirementValues.has(id));
    if (unresolvedBlocker !== undefined) {
      throw new FormalProductionRestoreError(
        "ACTION_BLOCKED",
        action.actionId,
        `unresolved requirement ${unresolvedBlocker}`,
      );
    }

    const headers = resolveValue(action.correlationHeaders ?? {}, action.actionId);
    const body = resolveValue(action.body, action.actionId);
    const response = await input.transport({
      actionId: action.actionId,
      serviceBoundary: action.serviceBoundary,
      method: action.method,
      endpoint: action.endpoint,
      executionIdentity: action.executionIdentity,
      headers,
      body,
    });
    const responseBody = validateSuccessEnvelope(action, response);
    const captures = captureResponse(action, responseBody);
    actionCaptures.set(action.actionId, captures);
    completedActions.add(action.actionId);
    actionReceipts.push(Object.freeze({
      actionId: action.actionId,
      serviceBoundary: action.serviceBoundary,
      endpoint: action.endpoint,
      httpStatus: response.status,
      captures,
    }));
    await resolveReadyRequirements();
  }

  const unresolvedRequirement = input.plan.requirements
    .find((value) => !requirementValues.has(value.requirementId));
  if (unresolvedRequirement !== undefined) {
    throw new FormalProductionRestoreError(
      "REQUIREMENT_UNRESOLVED",
      unresolvedRequirement.requirementId,
      "its prerequisite actions did not complete",
    );
  }

  return Object.freeze({
    schemaVersion: "task1.production-asset-restore-receipt.v1" as const,
    split: input.plan.split,
    planSha256: input.plan.planSha256,
    complete: true as const,
    actionCount: actionReceipts.length,
    requirementCount: requirementReceipts.length,
    actions: Object.freeze(actionReceipts),
    requirements: Object.freeze(requirementReceipts),
  });
}
