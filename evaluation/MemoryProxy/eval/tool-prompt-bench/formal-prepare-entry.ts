import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA } from "../../../../implementations/final/MemoryProxy/src/experiment-config-fingerprint.js";
import { createFormalPrepareDataSource } from "./formal-prepare-datasource.js";
import {
  OFFICIAL_CODEX_UPSTREAM_URL,
  normalizeFormalProxyBaseUrl,
  prepareFormalCampaign,
  type FormalPrepareDataSource,
  type FormalPrepareScope,
  type FormalSplit,
  type PreparedFormalCampaign,
} from "./formal-prepare-runner.js";
import {
  resolveFormalDataFreeze,
  type FormalDataFreeze,
} from "./formal-runtime/index.js";
import { resolveToolPromptVariant, type ToolPromptVariant } from "./variant-profiles.js";
import type { CodexReasoningEffort } from "./codex-runner.js";
import { FORMAL_PROMPT_FREEZE_TAG } from "./formal-cache-structure-gate.js";

const FORMAL_RUNTIME_NAMESPACE = "tdai-task1-formal-runtime-v1";

export interface PrepareFormalCampaignEntryInput {
  readonly repositoryRoot: string;
  readonly configFile: string;
  readonly outputRoot: string;
  readonly campaignId: string;
  readonly scope: FormalPrepareScope;
  readonly caseId?: string;
  readonly caseSplit?: FormalSplit;
  readonly heldOutAuthorized?: boolean;
  readonly variant: ToolPromptVariant;
  readonly proxyBaseUrl: string;
  readonly repeats?: number;
  readonly model?: string;
  readonly reasoningEffort?: CodexReasoningEffort;
  readonly codeRef?: string;
  readonly promptFreezeRef?: string;
  readonly writeArtifacts?: boolean;
}

export interface FormalPrepareHealthReceipt {
  readonly injectionEnabled: true;
  readonly toolPromptProfile: string;
  readonly serverInstanceId: string;
  readonly serverStartedAt: string;
  readonly codexUpstream: typeof OFFICIAL_CODEX_UPSTREAM_URL;
  readonly codexUpstreamAuth: "client-passthrough";
  readonly experimentReadOnly: {
    readonly extractionDisabled: true;
    readonly tdaiL0WriteDisabled: true;
    readonly skillLlmWriteDisabled: true;
    readonly analyseMarkerDisabled: true;
    readonly toolPromptDiagnosticDisabled: true;
    readonly ready: true;
  };
  readonly toolPromptDiagnostic: "disabled";
  readonly experimentConfigFingerprint: {
    readonly schemaVersion: typeof EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA;
    readonly baseSha256: string;
    readonly effectiveSha256: string;
  };
  readonly experimentConfigFileSha256: string;
}

export interface FormalPrepareEntryDependencies {
  readonly resolveDataFreeze?: (repositoryRoot: string) => FormalDataFreeze;
  readonly createDataSource?: (freeze: FormalDataFreeze) => FormalPrepareDataSource;
  readonly resolveGitCommit?: (repositoryRoot: string, ref: string) => string;
  readonly readConfigFile?: (path: string) => Promise<Uint8Array>;
  readonly readHealth?: (healthUrl: string) => Promise<unknown>;
  readonly now?: () => string;
}

function nonBlank(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function sha256(name: string, value: unknown): string {
  const text = nonBlank(name, value);
  if (!/^[a-f0-9]{64}$/iu.test(text)) throw new Error(`${name} must be a SHA-256 hex digest`);
  return text.toLowerCase();
}

function commit(name: string, value: unknown): string {
  const text = nonBlank(name, value);
  if (!/^[a-f0-9]{40}$/iu.test(text)) throw new Error(`${name} must resolve to a Git commit`);
  return text.toLowerCase();
}

function object(name: string, value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertHeldOutAuthorization(input: PrepareFormalCampaignEntryInput): void {
  const hidden = input.scope === "hidden_test"
    || (input.scope === "case" && input.caseSplit === "hidden_test");
  if (hidden && input.heldOutAuthorized !== true) {
    throw new Error("explicit held-out authorization is required before any hidden_test preparation read");
  }
}

function parseHealth(value: unknown): FormalPrepareHealthReceipt {
  const health = object("MemoryProxy health", value);
  if (health.injectionEnabled !== true) {
    throw new Error("MemoryProxy health must report injectionEnabled=true");
  }
  if (health.codexUpstream !== OFFICIAL_CODEX_UPSTREAM_URL) {
    throw new Error(`MemoryProxy health must report the official Codex upstream ${OFFICIAL_CODEX_UPSTREAM_URL}`);
  }
  if (health.codexUpstreamAuth !== "client-passthrough") {
    throw new Error("MemoryProxy health must report codexUpstreamAuth=client-passthrough");
  }
  const readOnly = object("MemoryProxy health.experimentReadOnly", health.experimentReadOnly);
  for (const field of [
    "extractionDisabled",
    "tdaiL0WriteDisabled",
    "skillLlmWriteDisabled",
    "analyseMarkerDisabled",
    "toolPromptDiagnosticDisabled",
    "ready",
  ] as const) {
    if (readOnly[field] !== true) {
      throw new Error(`MemoryProxy health.experimentReadOnly.${field} must be true`);
    }
  }
  if (health.toolPromptDiagnostic !== "disabled") {
    throw new Error("MemoryProxy health.toolPromptDiagnostic must be disabled");
  }
  const fingerprint = object(
    "MemoryProxy health.experimentConfigFingerprint",
    health.experimentConfigFingerprint,
  );
  const configFileSha256 = sha256(
    "MemoryProxy health.experimentConfigFileSha256",
    health.experimentConfigFileSha256,
  );
  if (fingerprint.schemaVersion !== EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA) {
    throw new Error(
      `MemoryProxy health experiment fingerprint must use ${EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA}`,
    );
  }
  const serverStartedAt = nonBlank("MemoryProxy health.serverStartedAt", health.serverStartedAt);
  if (!Number.isFinite(Date.parse(serverStartedAt))) {
    throw new Error("MemoryProxy health.serverStartedAt must be an ISO date-time");
  }
  return Object.freeze({
    injectionEnabled: true as const,
    toolPromptProfile: nonBlank("MemoryProxy health.toolPromptProfile", health.toolPromptProfile),
    serverInstanceId: nonBlank("MemoryProxy health.serverInstanceId", health.serverInstanceId),
    serverStartedAt,
    codexUpstream: OFFICIAL_CODEX_UPSTREAM_URL,
    codexUpstreamAuth: "client-passthrough" as const,
    experimentReadOnly: Object.freeze({
      extractionDisabled: true as const,
      tdaiL0WriteDisabled: true as const,
      skillLlmWriteDisabled: true as const,
      analyseMarkerDisabled: true as const,
      toolPromptDiagnosticDisabled: true as const,
      ready: true as const,
    }),
    toolPromptDiagnostic: "disabled" as const,
    experimentConfigFingerprint: Object.freeze({
      schemaVersion: EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA,
      baseSha256: sha256(
        "MemoryProxy health.experimentConfigFingerprint.baseSha256",
        fingerprint.baseSha256,
      ),
      effectiveSha256: sha256(
        "MemoryProxy health.experimentConfigFingerprint.effectiveSha256",
        fingerprint.effectiveSha256,
      ),
    }),
    experimentConfigFileSha256: configFileSha256,
  });
}

function resolveGitCommit(repositoryRoot: string, ref: string): string {
  return execFileSync("git", ["-C", repositoryRoot, "rev-parse", `${ref}^{commit}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function readHealth(healthUrl: string): Promise<unknown> {
  const response = await fetch(healthUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`MemoryProxy health preflight failed with HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

/**
 * Formal PrepareOnly factory. All caller-supplied identities and hashes are
 * removed from the public interface: Git, config bytes, data Tag and Proxy
 * health are resolved from their actual sources after the held-out Gate.
 */
export async function prepareFormalCampaignFromSources(
  input: PrepareFormalCampaignEntryInput,
  dependencies: FormalPrepareEntryDependencies = {},
): Promise<PreparedFormalCampaign> {
  // This must stay first: no Git, data, config or health source may be opened
  // for a held-out request until the operator provides explicit authorization.
  assertHeldOutAuthorization(input);

  const repositoryRoot = resolve(nonBlank("repositoryRoot", input.repositoryRoot));
  const configPath = resolve(repositoryRoot, nonBlank("configFile", input.configFile));
  const proxyBaseUrl = normalizeFormalProxyBaseUrl(input.proxyBaseUrl);
  const resolvedVariant = resolveToolPromptVariant(input.variant);
  const healthUrl = `${proxyBaseUrl}/health`;

  const readConfigSource = dependencies.readConfigFile ?? readFile;
  const configBytes = await readConfigSource(configPath);
  const configFileSha256 = createHash("sha256").update(configBytes).digest("hex");
  const health = parseHealth(await (dependencies.readHealth ?? readHealth)(healthUrl));
  if (health.experimentConfigFileSha256 !== configFileSha256) {
    throw new Error(
      "MemoryProxy health experimentConfigFileSha256 does not match the locally read startup YAML",
    );
  }
  if (health.toolPromptProfile !== resolvedVariant.profile) {
    throw new Error(
      `MemoryProxy health profile ${health.toolPromptProfile} does not match Variant ${input.variant} (${resolvedVariant.profile})`,
    );
  }

  const freeze = (dependencies.resolveDataFreeze ?? ((root: string) => (
    resolveFormalDataFreeze({ repositoryRoot: root })
  )))(repositoryRoot);
  const source = (dependencies.createDataSource ?? ((value: FormalDataFreeze) => (
    createFormalPrepareDataSource({ freeze: value })
  )))(freeze);
  const gitCommit = dependencies.resolveGitCommit ?? resolveGitCommit;
  const codeCommit = commit("codeRef", gitCommit(repositoryRoot, input.codeRef ?? "HEAD"));
  const promptFreezeRef = input.promptFreezeRef ?? FORMAL_PROMPT_FREEZE_TAG;
  const promptFreezeCommit = commit(
    "promptFreezeRef",
    gitCommit(repositoryRoot, promptFreezeRef),
  );
  if (promptFreezeRef !== FORMAL_PROMPT_FREEZE_TAG) {
    const canonicalPromptFreezeCommit = commit(
      FORMAL_PROMPT_FREEZE_TAG,
      gitCommit(repositoryRoot, FORMAL_PROMPT_FREEZE_TAG),
    );
    if (promptFreezeCommit !== canonicalPromptFreezeCommit) {
      throw new Error(`promptFreezeRef must resolve to ${FORMAL_PROMPT_FREEZE_TAG}`);
    }
  }

  return prepareFormalCampaign({
    source,
    outputRoot: resolve(nonBlank("outputRoot", input.outputRoot)),
    // The model-visible namespace is deliberately detached from semantic
    // artifact paths and cannot be selected by a CLI caller.
    runtimeRoot: resolve(tmpdir(), FORMAL_RUNTIME_NAMESPACE),
    campaignId: input.campaignId,
    scope: input.scope,
    caseId: input.caseId,
    caseSplit: input.caseSplit,
    heldOutAuthorized: input.heldOutAuthorized,
    variant: resolvedVariant.variant,
    proxyInstance: {
      instanceId: health.serverInstanceId,
      instanceEpoch: health.serverStartedAt,
      proxyBaseUrl,
      expectedToolPromptProfile: resolvedVariant.profile,
      configFilePath: configPath,
      configFileSha256,
      experimentBaseConfigSha256: health.experimentConfigFingerprint.baseSha256,
      experimentEffectiveConfigSha256: health.experimentConfigFingerprint.effectiveSha256,
    },
    repeats: input.repeats,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    codeCommit,
    promptFreezeCommit,
    createdAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    writeArtifacts: input.writeArtifacts,
  });
}
