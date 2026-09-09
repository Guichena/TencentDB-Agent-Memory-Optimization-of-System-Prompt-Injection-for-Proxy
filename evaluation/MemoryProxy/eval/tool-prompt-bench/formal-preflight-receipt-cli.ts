import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePinnedFormalAssetRestorePlan,
  parseFormalAssetRuntimeObservations,
  type FormalAssetRuntimeObservations,
} from "./formal-assets/restore-plan-runtime.js";
import type {
  FormalAssetRestorePlan,
  FormalAssetRestoreSplit,
} from "./formal-assets/restore-plan-contract.js";
import {
  evaluateFormalExecutionPreflight,
  type FormalExpectedExecutionBinding,
  type FormalExecutionPreflightInput,
  type FormalExecutionPreflightReceipt,
  type PinnedFormalExecutionPreflightReceipt,
} from "./formal-execution-preflight.js";
import { loadPreparedFormalRunDirectory } from "./formal-execution-cli.js";
import type { PreparedFormalRun } from "./formal-prepare-runner.js";
import { canonicalSha256 } from "./formal-runtime/canonical.js";

export interface FormalPreflightReceiptCliOptions {
  readonly runDirectory: string;
  readonly planPath: string;
  readonly inspectObservationsPath: string;
  readonly split: FormalAssetRestoreSplit;
  readonly allowHiddenTest: boolean;
  readonly outputPath: string;
}

export interface CreateFormalExecutionPreflightReceiptInput {
  readonly rawPlan: unknown;
  readonly rawInspectObservations: unknown;
  readonly expected: FormalExpectedExecutionBinding;
  readonly split: FormalAssetRestoreSplit;
  readonly allowHiddenTest?: true;
}

export interface FormalPreflightReceiptDependencies {
  readonly parsePlan?: typeof parsePinnedFormalAssetRestorePlan;
  readonly parseObservations?: typeof parseFormalAssetRuntimeObservations;
  readonly evaluate?: typeof evaluateFormalExecutionPreflight;
}

export function parseFormalPreflightReceiptCliArguments(
  argv: readonly string[],
): FormalPreflightReceiptCliOptions {
  const booleanFlags = new Set(["--allow-hidden-test"]);
  const valueFlags = new Set([
    "--plan",
    "--run-dir",
    "--inspect-observations",
    "--split",
    "--output",
  ]);
  const values = new Map<string, string>();
  let allowHiddenTest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (allowHiddenTest) throw new Error(`duplicate formal preflight argument: ${flag}`);
      allowHiddenTest = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`unsupported formal preflight argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (values.has(flag)) throw new Error(`duplicate formal preflight argument: ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const split = required(values, "--split");
  if (split !== "dev" && split !== "hidden_test") {
    throw new Error("--split must be dev or hidden_test");
  }
  if (split === "hidden_test" && !allowHiddenTest) {
    throw new Error("hidden_test preflight requires --allow-hidden-test");
  }
  return {
    runDirectory: resolve(required(values, "--run-dir")),
    planPath: resolve(required(values, "--plan")),
    inspectObservationsPath: resolve(required(values, "--inspect-observations")),
    split,
    allowHiddenTest,
    outputPath: resolve(required(values, "--output")),
  };
}

/**
 * Promote neither restore nor inspector claims directly. Both envelopes are
 * parsed against the pinned formal data revision, then the independent R04
 * evaluator recomputes all six readiness checks from raw observations.
 */
export function createFormalExecutionPreflightReceipt(
  input: CreateFormalExecutionPreflightReceiptInput,
  dependencies: FormalPreflightReceiptDependencies = {},
): PinnedFormalExecutionPreflightReceipt {
  const parsePlan = dependencies.parsePlan ?? parsePinnedFormalAssetRestorePlan;
  const parseObservations = dependencies.parseObservations ?? parseFormalAssetRuntimeObservations;
  const evaluate = dependencies.evaluate ?? evaluateFormalExecutionPreflight;
  const authorization = input.allowHiddenTest === true
    ? { allowHiddenTest: true as const }
    : {};
  const plan = parsePlan(input.rawPlan, {
    expectedSplit: input.split,
    ...authorization,
  }) as FormalAssetRestorePlan;
  const inspected = parseObservations(input.rawInspectObservations, {
    expectedOperation: "inspect",
    expectedSplit: input.split,
    expectedPlanSha256: plan.planSha256,
    ...authorization,
  }) as FormalAssetRuntimeObservations;
  const observations = record(
    "inspect unverifiedObservations",
    inspected.unverifiedObservations,
  ) as unknown as FormalExecutionPreflightInput;
  if (canonicalSha256(observations.expected) !== canonicalSha256(input.expected)) {
    throw new Error("formal inspect expected binding does not match the prepared run");
  }
  const evaluated = evaluate({ ...observations, expected: input.expected });
  return Object.freeze({
    ...evaluated,
    provenance: Object.freeze({
      restorePlanSha256: plan.planSha256,
      snapshotId: plan.snapshot.snapshotId,
      snapshotCanonicalSha256: plan.revision.snapshotCanonicalSha256,
      inspectEnvelopeCanonicalSha256: canonicalSha256(inspected),
    }),
  });
}

export async function runFormalPreflightReceiptCli(
  options: FormalPreflightReceiptCliOptions,
): Promise<void> {
  // Hidden authorization is checked by argument parsing before either runtime
  // file is opened. Keep the same invariant for programmatic callers.
  if (options.split === "hidden_test" && options.allowHiddenTest !== true) {
    throw new Error("hidden_test preflight requires --allow-hidden-test");
  }
  const [run, rawPlan, rawInspectObservations] = await Promise.all([
    loadPreparedFormalRunDirectory(options.runDirectory),
    readJson(options.planPath, "formal restore plan"),
    readJson(options.inspectObservationsPath, "formal inspect observations"),
  ]);
  const receipt = createFormalExecutionPreflightReceipt({
    rawPlan,
    rawInspectObservations,
    expected: expectedBindingFromPreparedRun(run),
    split: options.split,
    ...(options.allowHiddenTest ? { allowHiddenTest: true as const } : {}),
  });
  if (receipt.ready !== true) {
    throw new Error("formal execution preflight failed; no ready receipt was written");
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    outputPath: options.outputPath,
    ready: receipt.ready,
    checks: receipt.checks,
  }, null, 2)}\n`);
}

export function expectedBindingFromPreparedRun(
  run: PreparedFormalRun,
): FormalExpectedExecutionBinding {
  const expected = run.command.executionRequiredGates.identityBinding.expected;
  const taskId = requiredValue("prepared run taskId", expected.taskId);
  return Object.freeze({
    datasetUserId: requiredValue("prepared run datasetUserId", expected.datasetUserId),
    spaceId: requiredValue("prepared run spaceId", expected.spaceId),
    teamId: requiredValue("prepared run teamId", expected.teamId),
    agentId: requiredValue("prepared run agentId", expected.agentId),
    taskId,
    sessionId: requiredValue("prepared run sessionId", run.manifest.session_id),
    agentSource: "codex",
    visibleAssetSetSha256: requiredValue(
      "prepared run visibleAssetSetSha256",
      expected.visibleAssetSetSha256,
    ),
  });
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is not readable valid JSON: ${path}`, { cause: error });
  }
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function requiredValue(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-blank`);
  return value;
}

function record(label: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runFormalPreflightReceiptCli(parseFormalPreflightReceiptCliArguments(process.argv.slice(2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
