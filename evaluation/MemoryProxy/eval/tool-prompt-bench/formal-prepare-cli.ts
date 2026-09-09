import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  prepareFormalCampaignFromSources,
  type FormalPrepareEntryDependencies,
  type PrepareFormalCampaignEntryInput,
} from "./formal-prepare-entry.js";
import type { CodexReasoningEffort } from "./codex-runner.js";
import {
  DEFAULT_FORMAL_MODEL,
  DEFAULT_FORMAL_REASONING_EFFORT,
  type FormalPrepareScope,
  type FormalSplit,
} from "./formal-prepare-runner.js";
import type { ToolPromptVariant } from "./variant-profiles.js";

function value(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`);
  return next;
}

function required(args: readonly string[], name: string): string {
  const found = value(args, name);
  if (!found) throw new Error(`${name} is required`);
  return found;
}

function oneOf<T extends string>(name: string, input: string, values: readonly T[]): T {
  if (!(values as readonly string[]).includes(input)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  }
  return input as T;
}

export function parseFormalPrepareCliArgs(argv: readonly string[]): PrepareFormalCampaignEntryInput {
  const args = argv.slice(2);
  const flags = new Set(["--prepare-only", "--held-out-authorized"]);
  const options = new Set([
    "--scope",
    "--case-id",
    "--case-split",
    "--variant",
    "--campaign",
    "--repository-root",
    "--config",
    "--output-root",
    "--proxy-base-url",
    "--repeats",
    "--model",
    "--reasoning-effort",
    "--code-ref",
    "--prompt-freeze-ref",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (flags.has(token)) continue;
    if (!options.has(token)) throw new Error(`unsupported formal PrepareOnly argument: ${token}`);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${token} requires a value`);
    index += 1;
  }
  if (!args.includes("--prepare-only")) {
    throw new Error("--prepare-only is required; this entry never executes a model run");
  }
  const scope = oneOf<FormalPrepareScope>(
    "--scope",
    required(args, "--scope"),
    ["dev", "hidden_test", "smoke", "case"],
  );
  const caseSplitValue = value(args, "--case-split");
  const caseSplit = caseSplitValue === undefined
    ? undefined
    : oneOf<FormalSplit>("--case-split", caseSplitValue, ["dev", "hidden_test"]);
  const repeatsText = value(args, "--repeats");
  const repeats = repeatsText === undefined ? undefined : Number(repeatsText);
  if (repeats !== undefined && (!Number.isSafeInteger(repeats) || repeats < 1)) {
    throw new Error("--repeats must be a positive integer");
  }
  const reasoningText = value(args, "--reasoning-effort");
  const reasoningEffort = reasoningText === undefined
    ? undefined
    : oneOf<CodexReasoningEffort>(
      "--reasoning-effort",
      reasoningText,
      ["minimal", "low", "medium", "high", "xhigh"],
    );
  const caseId = value(args, "--case-id");
  if (scope === "case" && !caseId) throw new Error("--case-id is required for --scope case");
  return {
    repositoryRoot: required(args, "--repository-root"),
    configFile: required(args, "--config"),
    outputRoot: required(args, "--output-root"),
    campaignId: required(args, "--campaign"),
    scope,
    caseId,
    caseSplit,
    heldOutAuthorized: args.includes("--held-out-authorized") || undefined,
    variant: required(args, "--variant") as ToolPromptVariant,
    proxyBaseUrl: required(args, "--proxy-base-url"),
    repeats,
    model: value(args, "--model") ?? DEFAULT_FORMAL_MODEL,
    reasoningEffort: reasoningEffort ?? DEFAULT_FORMAL_REASONING_EFFORT,
    codeRef: value(args, "--code-ref"),
    promptFreezeRef: value(args, "--prompt-freeze-ref"),
  };
}

export async function runFormalPrepareCli(
  argv: readonly string[],
  dependencies: FormalPrepareEntryDependencies = {},
): Promise<void> {
  const campaign = await prepareFormalCampaignFromSources(
    parseFormalPrepareCliArgs(argv),
    dependencies,
  );
  process.stdout.write(`${JSON.stringify({
    schemaVersion: campaign.schemaVersion,
    scope: campaign.scope,
    variant: campaign.variant,
    formalMetricEligible: campaign.formalMetricEligible,
    preparedRuns: campaign.runs.length,
  })}\n`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runFormalPrepareCli(process.argv).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
