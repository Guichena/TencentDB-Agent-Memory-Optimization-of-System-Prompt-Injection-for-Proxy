/**
 * Runtime boundary for executing a frozen, Gold-blind asset restore plan.
 *
 * Keep this module deliberately shallow in dependencies: the authoring world,
 * private measurement inputs, and dataset contracts must never cross this seam.
 */
import {
  FormalAssetRestorePlanContractError,
  parseFormalAssetRestorePlan,
  type FormalAssetRestorePlan,
  type FormalAssetRestoreSplit,
} from "./restore-plan-contract.js";
import {
  FORMAL_DATA_COMMIT,
  FORMAL_DATA_TAG,
  FORMAL_DATA_TAG_OBJECT,
} from "../formal-runtime/freeze.js";
import type { FormalExpectedExecutionBinding } from "../formal-execution-preflight.js";

export type FormalAssetRuntimeOperation = "restore" | "inspect";

export interface FormalAssetRuntimeObservations {
  readonly schemaVersion: "task1.formal-asset-runtime-observations.v1";
  readonly operation: FormalAssetRuntimeOperation;
  readonly split: FormalAssetRestoreSplit;
  readonly planSha256: string;
  readonly verification: "unverified";
  readonly formalMetricEligible: false;
  readonly readyForFormalMeasurement: false;
  readonly unverifiedObservations: unknown;
}

export type FormalAssetRestoreAdapter = Readonly<{
  executeFormalAssetRestorePlan(plan: FormalAssetRestorePlan): Promise<unknown>;
}>;

export type FormalAssetInspectionAdapter = Readonly<{
  inspectFormalAssetRestorePlan(
    plan: FormalAssetRestorePlan,
    restoreObservations: FormalAssetRuntimeObservations,
    context: FormalAssetInspectionContext,
  ): Promise<unknown>;
}>;

export interface FormalAssetInspectionContext {
  readonly expectedBinding: FormalExpectedExecutionBinding;
}

export type FormalAssetAdapterLoader = () => Promise<unknown>;

export interface ExecuteFormalAssetRestorePlanInput {
  readonly rawPlan: unknown;
  readonly expectedSplit: FormalAssetRestoreSplit;
  readonly allowHiddenTest?: true;
  readonly loadAdapter: FormalAssetAdapterLoader;
}

export interface InspectFormalAssetRestorePlanInput extends ExecuteFormalAssetRestorePlanInput {
  readonly rawRestoreObservations: unknown;
  readonly expectedBinding: FormalExpectedExecutionBinding;
}

type JsonRecord = Record<string, unknown>;

const SHA256 = /^[a-f0-9]{64}$/u;

function invalid(message: string): never {
  throw new FormalAssetRestorePlanContractError(`runtime boundary: ${message}`);
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

function detached<T>(value: T, label: string): T {
  try {
    return structuredClone(value) as T;
  } catch {
    return invalid(`${label} must be structured-clone-compatible`);
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) invalid(`${label} contains unexpected key ${unexpected}`);
}

function falseLiteral(value: unknown, label: string): false {
  if (value !== false) invalid(`${label} must be false`);
  return false;
}

function nonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} must be a non-blank string`);
  return value;
}

function parseInspectionContext(raw: unknown): FormalAssetInspectionContext {
  const value = record(detached(raw, "inspection context"), "inspection context");
  exactKeys(value, ["expectedBinding"], "inspection context");
  const expected = record(value.expectedBinding, "inspection context expectedBinding");
  const keys = [
    "datasetUserId", "spaceId", "teamId", "agentId", "taskId", "sessionId",
    "agentSource", "visibleAssetSetSha256",
  ] as const;
  exactKeys(expected, keys, "inspection context expectedBinding");
  for (const key of keys) nonBlankString(expected[key], `inspection context expectedBinding ${key}`);
  if (!SHA256.test(expected.visibleAssetSetSha256 as string)) {
    invalid("inspection context expectedBinding visibleAssetSetSha256 must be a lowercase SHA-256");
  }
  return deepFreeze(value) as unknown as FormalAssetInspectionContext;
}

function assertPinnedRevision(plan: FormalAssetRestorePlan): void {
  if (plan.revision.tag !== FORMAL_DATA_TAG
    || plan.revision.tagObject !== FORMAL_DATA_TAG_OBJECT
    || plan.revision.commit !== FORMAL_DATA_COMMIT) {
    invalid("plan revision is not the frozen formal data revision");
  }
}

/** Parse and pin the sole plan that may cross the runtime adapter boundary. */
export function parsePinnedFormalAssetRestorePlan(
  rawPlan: unknown,
  input: Pick<ExecuteFormalAssetRestorePlanInput, "expectedSplit" | "allowHiddenTest">,
): FormalAssetRestorePlan {
  const plan = parseFormalAssetRestorePlan(rawPlan, {
    expectedSplit: input.expectedSplit,
    ...(input.allowHiddenTest === true ? { allowHiddenTest: true as const } : {}),
  });
  assertPinnedRevision(plan);
  return plan;
}

function adapterModule(raw: unknown, exportName: string): JsonRecord {
  const module = record(raw, "adapter module");
  if (typeof module[exportName] !== "function") {
    invalid(`adapter must export ${exportName}`);
  }
  return module;
}

function wrapUnverifiedObservations(
  operation: FormalAssetRuntimeOperation,
  plan: FormalAssetRestorePlan,
  observations: unknown,
): FormalAssetRuntimeObservations {
  const serializableObservations = observations === undefined ? null : observations;
  return deepFreeze({
    schemaVersion: "task1.formal-asset-runtime-observations.v1" as const,
    operation,
    split: plan.split,
    planSha256: plan.planSha256,
    verification: "unverified" as const,
    formalMetricEligible: false as const,
    readyForFormalMeasurement: false as const,
    // An adapter may describe what it observed, but cannot grant readiness or
    // metric eligibility. Those decisions remain outside this D3 boundary.
    unverifiedObservations: detached(serializableObservations, "adapter observations"),
  });
}

/**
 * Validate before loading any production adapter. The adapter receives only the
 * detached, recursively frozen runtime plan and its claims remain unverified.
 */
export async function executeFormalAssetRestorePlanWithLoader(
  input: ExecuteFormalAssetRestorePlanInput,
): Promise<FormalAssetRuntimeObservations> {
  const plan = parsePinnedFormalAssetRestorePlan(input.rawPlan, input);
  const module = adapterModule(await input.loadAdapter(), "executeFormalAssetRestorePlan");
  const execute = module.executeFormalAssetRestorePlan as FormalAssetRestoreAdapter["executeFormalAssetRestorePlan"];
  return wrapUnverifiedObservations("restore", plan, await execute(plan));
}

/** Parse a restore observation file without promoting any adapter claim. */
export function parseFormalAssetRuntimeObservations(
  raw: unknown,
  input: Readonly<{
    expectedOperation: FormalAssetRuntimeOperation;
    expectedSplit: FormalAssetRestoreSplit;
    expectedPlanSha256: string;
    allowHiddenTest?: true;
  }>,
): FormalAssetRuntimeObservations {
  if (input.expectedSplit === "hidden_test" && input.allowHiddenTest !== true) {
    invalid("hidden_test access must be authorized before observations are read");
  }
  const value = record(detached(raw, "runtime observations"), "runtime observations");
  exactKeys(value, [
    "schemaVersion", "operation", "split", "planSha256", "verification",
    "formalMetricEligible", "readyForFormalMeasurement", "unverifiedObservations",
  ], "runtime observations");
  if (!Object.hasOwn(value, "unverifiedObservations")) {
    invalid("runtime observations must contain unverifiedObservations");
  }
  if (value.schemaVersion !== "task1.formal-asset-runtime-observations.v1") {
    invalid("unsupported observations schemaVersion");
  }
  if (value.operation !== input.expectedOperation) invalid("observations operation mismatch");
  if (value.split !== input.expectedSplit) invalid("observations split mismatch");
  if (typeof value.planSha256 !== "string" || !SHA256.test(value.planSha256)) {
    invalid("observations planSha256 must be a lowercase SHA-256");
  }
  if (value.planSha256 !== input.expectedPlanSha256) invalid("observations planSha256 mismatch");
  if (value.verification !== "unverified") invalid("observations must remain unverified");
  falseLiteral(value.formalMetricEligible, "observations formalMetricEligible");
  falseLiteral(value.readyForFormalMeasurement, "observations readyForFormalMeasurement");
  return deepFreeze(value) as unknown as FormalAssetRuntimeObservations;
}

/**
 * Run a post-restore inspector against only the safe plan and unverified restore
 * observations. Both inputs are validated and frozen before the adapter loads.
 */
export async function inspectFormalAssetRestorePlanWithLoader(
  input: InspectFormalAssetRestorePlanInput,
): Promise<FormalAssetRuntimeObservations> {
  const plan = parsePinnedFormalAssetRestorePlan(input.rawPlan, input);
  const restoreObservations = parseFormalAssetRuntimeObservations(
    input.rawRestoreObservations,
    {
      expectedOperation: "restore",
      expectedSplit: input.expectedSplit,
      expectedPlanSha256: plan.planSha256,
      ...(input.allowHiddenTest === true ? { allowHiddenTest: true as const } : {}),
    },
  );
  const context = parseInspectionContext({ expectedBinding: input.expectedBinding });
  const module = adapterModule(await input.loadAdapter(), "inspectFormalAssetRestorePlan");
  const inspect = module.inspectFormalAssetRestorePlan as FormalAssetInspectionAdapter["inspectFormalAssetRestorePlan"];
  return wrapUnverifiedObservations(
    "inspect",
    plan,
    await inspect(plan, restoreObservations, context),
  );
}
