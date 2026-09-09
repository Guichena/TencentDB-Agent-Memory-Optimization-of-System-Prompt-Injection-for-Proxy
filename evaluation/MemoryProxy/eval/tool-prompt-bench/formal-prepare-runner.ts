import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import {
  buildCodexConfigArgs,
  buildCodexInvocation,
  isolateCodexEnvironment,
  type CodexReasoningEffort,
} from "./codex-runner.js";
import {
  FORMAL_DATA_TAG,
  FORMAL_DATA_TAG_OBJECT,
} from "./formal-runtime/index.js";
import {
  USER_PLANE_HISTORY_TRANSPORT_V1,
  buildMemoryProxyCodexBaseUrl,
  buildRealChainProviderInput,
  buildRealChainIdentityHeaders,
  type RealChainHistoryMessage,
  type RealChainIdentity,
} from "./real-chain-adapter.js";
import {
  resolveToolPromptVariant,
  type ToolPromptVariant,
} from "./variant-profiles.js";
import type { ToolPromptProfile } from "../../../../implementations/final/MemoryProxy/src/injection/tool-prompt/types.js";
import { EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA } from "../../../../implementations/final/MemoryProxy/src/experiment-config-fingerprint.js";
import { FORMAL_EPISODE_POLICY } from "./formal-episode-policy.js";

export const DEFAULT_FORMAL_MODEL = "gpt-5.6-luna" as const;
export const DEFAULT_FORMAL_REASONING_EFFORT = "high" as const;
export const DEFAULT_FORMAL_VERBOSITY = "medium" as const;
export const FORMAL_TDAI_USER_KEY_ENV = "TDAI_EVAL_USER_KEY" as const;
export const OFFICIAL_CODEX_UPSTREAM_URL = "https://chatgpt.com/backend-api/codex" as const;

export type FormalPrepareScope = "dev" | "hidden_test" | "smoke" | "case";
export type FormalSplit = "dev" | "hidden_test";
export type FormalVariantId = ToolPromptVariant;

export interface FormalProviderRecord {
  readonly caseId: string;
  readonly language: string;
  readonly contextMessages: readonly RealChainHistoryMessage[];
  readonly query: string;
}

export interface FormalCaseBinding {
  readonly identity: Omit<RealChainIdentity, "sessionId"> & {
    readonly userId: string;
    readonly agentSource: string;
    readonly sessionSeed: string;
  };
  readonly snapshotId: string;
  readonly workspace: unknown;
  /** Canonical public visibility input; no asset has been restored in R02. */
  readonly visibleAssetSetSha256: string;
}

/**
 * Gold-blind join returned by the public runtime loader. Expected tools,
 * terminal matchers, private Pair records, and scores intentionally cannot be
 * represented by this type.
 */
export interface FormalPrepareCase {
  readonly split: FormalSplit;
  readonly providerRecord: FormalProviderRecord;
  readonly binding: FormalCaseBinding;
}

export interface FormalPrepareSplitStatus {
  readonly expectedCaseCount: number;
  readonly providerInputSha256: string;
  /** Public status metadata only; the runner never opens the private Gold. */
  readonly privateGoldSha256: string;
  readonly privateGoldHashScope: "measurement-v2-split-canonical" | "repo-backed-v2.1-file";
  readonly pairContractSha256: string;
  readonly pairContractHashScope: "measurement-v2-split-canonical" | "repo-backed-v2.1-file";
  readonly snapshotSha256: string;
}

export interface FormalPreparePublicStatus {
  readonly datasetRevision: string;
  readonly datasetTag: typeof FORMAL_DATA_TAG;
  readonly datasetTagObject: typeof FORMAL_DATA_TAG_OBJECT;
  readonly datasetCommit: string;
  readonly contractSha256: string;
  readonly preregisteredSmokeCaseIds: readonly string[];
  readonly splits: Readonly<Record<FormalSplit, FormalPrepareSplitStatus>>;
  readonly formalMetricEligible: false;
}

/** Adapter seam for R02-B's public loader. It must never expose private Gold. */
export interface FormalPrepareDataSource {
  readPublicStatus(): Promise<FormalPreparePublicStatus>;
  openProviderSplit(
    split: FormalSplit,
    options?: { readonly allowHiddenTest?: true },
  ): Promise<{
    readonly cases: readonly FormalPrepareCase[];
    readonly caseBindingsFileSha256: string;
  }>;
  /** Must delegate to R02-B's frozen canonical JSON helper. */
  canonicalProviderInputSha256(value: unknown): string;
}

export interface PrepareFormalCampaignInput {
  readonly source: FormalPrepareDataSource;
  readonly outputRoot: string;
  /** Model-visible HOME/cwd live only below opaque run ids in this namespace. */
  readonly runtimeRoot: string;
  readonly campaignId: string;
  readonly scope: FormalPrepareScope;
  readonly caseId?: string;
  readonly caseSplit?: FormalSplit;
  readonly heldOutAuthorized?: boolean;
  /** A campaign is deliberately single-Variant; the Proxy profile is process-wide. */
  readonly variant: FormalVariantId;
  readonly proxyInstance: {
    readonly instanceId: string;
    readonly instanceEpoch: string;
    readonly proxyBaseUrl: string;
    readonly expectedToolPromptProfile: ToolPromptProfile;
    /** Resolved, read-only YAML used by the formal Proxy startup command. */
    readonly configFilePath: string;
    /** Exact bytes of the read-only YAML used to launch this Proxy instance. */
    readonly configFileSha256: string;
    readonly experimentBaseConfigSha256: string;
    readonly experimentEffectiveConfigSha256: string;
  };
  readonly repeats?: number;
  readonly model?: string;
  readonly reasoningEffort?: CodexReasoningEffort;
  readonly codeCommit: string;
  readonly promptFreezeCommit: string;
  readonly createdAt?: string;
  /** Test/planning seam. The CLI leaves this true; false performs no writes. */
  readonly writeArtifacts?: boolean;
}

export interface FormalPrepareRunManifest {
  readonly schemaVersion: "task1.formal-prepare-run-manifest.v1";
  readonly prepareOnly: true;
  readonly formalMetricEligible: false;
  readonly dataset_revision: string;
  readonly dataset_tag: typeof FORMAL_DATA_TAG;
  readonly dataset_tag_object: typeof FORMAL_DATA_TAG_OBJECT;
  readonly dataset_commit: string;
  readonly contract_sha256: string;
  readonly provider_input_sha256: string;
  readonly provider_input_canonical_sha256: string;
  readonly provider_corpus_sha256: string;
  readonly private_gold_sha256: string;
  readonly private_gold_hash_scope: "measurement-v2-split-canonical" | "repo-backed-v2.1-file";
  readonly snapshot_sha256: string;
  readonly pair_contract_sha256: string;
  readonly pair_contract_hash_scope: "measurement-v2-split-canonical" | "repo-backed-v2.1-file";
  readonly code_commit: string;
  readonly prompt_freeze_commit: string;
  readonly proxy_instance_id: string;
  readonly proxy_instance_epoch: string;
  readonly proxy_config_sha256: string;
  readonly proxy_config_file_sha256: string;
  readonly proxy_base_config_sha256: string;
  readonly identity_binding_state: "unverified-prepare-only";
  readonly expected_tool_prompt_profile: ToolPromptProfile;
  readonly expected_codex_upstream_url: typeof OFFICIAL_CODEX_UPSTREAM_URL;
  readonly expected_codex_upstream_auth: "client-passthrough";
  readonly case_binding_sha256: string;
  readonly case_bindings_file_sha256: string;
  readonly execution_workspace_path: string;
  readonly execution_workspace_policy_sha256: string;
  readonly asset_binding_state: "not-restored-prepare-only";
  readonly asset_binding_input_sha256: string;
  readonly visible_asset_set_sha256: string;
  readonly snapshot_id: string;
  readonly variant_id: FormalVariantId;
  readonly profile_id: string;
  readonly model_id: string;
  readonly reasoning_effort: CodexReasoningEffort;
  readonly verbosity: typeof DEFAULT_FORMAL_VERBOSITY;
  readonly case_id: string;
  readonly pair_id: string | null;
  readonly split: FormalSplit;
  readonly repeat: number;
  readonly run_id: string;
  readonly session_id: string;
  readonly history_transport: typeof USER_PLANE_HISTORY_TRANSPORT_V1;
  readonly episode_policy: typeof FORMAL_EPISODE_POLICY;
  readonly prepared_at: string;
  readonly started_at: null;
  readonly finished_at: null;
}

export interface PreparedFormalRun {
  readonly directory: string;
  readonly manifest: FormalPrepareRunManifest;
  readonly command: {
    readonly schemaVersion: "task1.formal-prepare-command.v1";
    readonly autoExecute: false;
    readonly executable: string;
    readonly args: readonly string[];
    readonly versionProbe: {
      readonly executable: string;
      readonly args: readonly string[];
    };
    readonly stdinSource: "provider-prompt.json#/messages/0/content/0/text";
    readonly requiredEnvironment: readonly [typeof FORMAL_TDAI_USER_KEY_ENV];
    readonly preflight: {
      readonly method: "GET";
      readonly healthUrl: string;
      readonly expected: {
        readonly injectionEnabled: true;
        readonly toolPromptProfile: ToolPromptProfile;
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
      };
    };
    readonly proxyStartupContract: {
      readonly freshProcessRequired: true;
      readonly configurationFileMutation: false;
      readonly configurationFile: {
        readonly path: string;
        readonly exactSha256: string;
      };
      readonly cliOverride: readonly [
        "--tool-prompt-profile",
        ToolPromptProfile,
        "--experiment-read-only",
      ];
    };
    readonly workspacePolicy: {
      readonly path: string;
      readonly initialState: "empty";
      readonly inheritsDatasetWorkspace: false;
      readonly createAtExecution: true;
    };
    readonly environmentPolicy: {
      readonly helper: "isolateCodexEnvironment";
      readonly authentication: "current-codex-home-or-userprofile-dot-codex";
      readonly copyAuthJson: false;
      readonly readAuthJsonDuringPrepare: false;
      readonly isolatedHome: string;
      readonly isolatedUserProfile: string;
      readonly isolatedCodexSqliteHome: string;
    };
    readonly executionRequiredGates: {
      readonly identityBinding: {
        readonly state: "unverified-prepare-only";
        readonly requiredBefore: "model-invocation";
        readonly expected: {
          /** Logical identity from the dataset; not an auth-service user id. */
          readonly datasetUserId: string;
          readonly spaceId: string;
          readonly teamId: string;
          readonly agentId: string;
          readonly taskId?: string;
          readonly visibleAssetSetSha256: string;
        };
        readonly checks: readonly [
          "auth-user-mapping",
          "space",
          "team",
          "agent",
          "task",
          "visible-assets",
        ];
        readonly requiredEvidence:
          "dataset-user-to-resolved-auth-user-mapping-with-required-visibility";
      };
      readonly codeAndPromptFreeze: {
        readonly state: "unverified-prepare-only";
        readonly requiredBefore: "model-invocation";
      };
      readonly runtimeIsolation: {
        readonly state: "planned-prepare-only";
        readonly requiredBefore: "model-invocation";
        readonly operation: "materializePreparedRunExecutionContext";
      };
      readonly campaignMatrix: {
        readonly state: "unregistered-prepare-only";
        readonly requiredBefore: "formal-comparison";
        readonly requiredOrder: "AB/BA";
      };
    };
  };
}

export interface PreparedFormalCampaign {
  readonly schemaVersion: "task1.formal-prepare-campaign.v1";
  readonly scope: FormalPrepareScope;
  readonly variant: FormalVariantId;
  readonly formalMetricEligible: false;
  readonly runs: readonly PreparedFormalRun[];
}

function requireNonBlank(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireSha256(name: string, value: unknown): string {
  const text = requireNonBlank(name, value);
  if (!/^[a-f0-9]{64}$/i.test(text)) throw new Error(`${name} must be a SHA-256 hex digest`);
  return text.toLowerCase();
}

function requireCommit(name: string, value: unknown): string {
  const text = requireNonBlank(name, value);
  if (!/^[a-f0-9]{40}$/i.test(text)) throw new Error(`${name} must be a 40-character Git commit`);
  return text.toLowerCase();
}

function requireIsoDateTime(name: string, value: unknown): string {
  const text = requireNonBlank(name, value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text)
    || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${name} must be an ISO-8601 UTC date-time`);
  }
  return text;
}

function requireAbsolutePath(name: string, value: unknown): string {
  const text = requireNonBlank(name, value);
  if (!isAbsolute(text)) throw new Error(`${name} must be an absolute path`);
  return text;
}

export function normalizeFormalProxyBaseUrl(value: unknown): string {
  const text = requireNonBlank("proxyBaseUrl", value);
  let url: URL;
  try {
    url = new URL(text);
  } catch (error) {
    throw new Error("proxyBaseUrl must be an absolute HTTP(S) URL", { cause: error });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname !== "/") {
    throw new Error("proxyBaseUrl must be an HTTP(S) origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function safeSegment(name: string, value: string): string {
  const text = requireNonBlank(name, value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text) || text === "." || text === "..") {
    throw new Error(`${name} must be a safe path segment`);
  }
  return text;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicId(prefix: string, parts: readonly (string | number)[]): string {
  return `${prefix}-${sha256(parts.join("\u001f")).slice(0, 32)}`;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateHeldOutBoundary(input: PrepareFormalCampaignInput): void {
  const requestsHidden = input.scope === "hidden_test"
    || (input.scope === "case" && input.caseSplit === "hidden_test");
  if (requestsHidden && input.heldOutAuthorized !== true) {
    throw new Error("explicit held-out authorization is required before opening hidden_test provider data");
  }
}

function validatePublicStatus(status: FormalPreparePublicStatus): FormalPreparePublicStatus {
  if (status.formalMetricEligible !== false) {
    throw new Error("R02 public status must remain formalMetricEligible=false");
  }
  safeSegment("datasetRevision", status.datasetRevision);
  if (status.datasetTag !== FORMAL_DATA_TAG) throw new Error(`rejected formal data tag: ${status.datasetTag}`);
  if (status.datasetTagObject !== FORMAL_DATA_TAG_OBJECT) {
    throw new Error(`formal data tag object drift: ${status.datasetTagObject}`);
  }
  requireCommit("datasetCommit", status.datasetCommit);
  requireSha256("contractSha256", status.contractSha256);
  for (const split of ["dev", "hidden_test"] as const) {
    const splitStatus = status.splits[split];
    const requiredCount = 320;
    if (splitStatus.expectedCaseCount !== requiredCount) {
      throw new Error(`${split}: public status expectedCaseCount must be ${requiredCount}`);
    }
    requireSha256(`${split}.providerInputSha256`, splitStatus.providerInputSha256);
    requireSha256(`${split}.privateGoldSha256`, splitStatus.privateGoldSha256);
    if (splitStatus.privateGoldHashScope !== "measurement-v2-split-canonical"
      && splitStatus.privateGoldHashScope !== "repo-backed-v2.1-file") {
      throw new Error(`${split}.privateGoldHashScope is unsupported`);
    }
    requireSha256(`${split}.pairContractSha256`, splitStatus.pairContractSha256);
    if (splitStatus.pairContractHashScope !== "measurement-v2-split-canonical"
      && splitStatus.pairContractHashScope !== "repo-backed-v2.1-file") {
      throw new Error(`${split}.pairContractHashScope is unsupported`);
    }
    requireSha256(`${split}.snapshotSha256`, splitStatus.snapshotSha256);
  }
  if (status.preregisteredSmokeCaseIds.length !== 40
    || new Set(status.preregisteredSmokeCaseIds).size !== 40) {
    throw new Error("public status must preregister exactly 40 unique smoke case ids");
  }
  return status;
}

function validateProviderRecord(record: FormalProviderRecord): void {
  safeSegment("caseId", record.caseId);
  requireNonBlank("language", record.language);
  requireNonBlank("query", record.query);
  if (!Array.isArray(record.contextMessages)) throw new Error(`${record.caseId}: contextMessages must be an array`);
  record.contextMessages.forEach((message, index) => {
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      throw new Error(`${record.caseId}: contextMessages[${index}] has an invalid role`);
    }
    requireNonBlank(`${record.caseId}.contextMessages[${index}].content`, message.content);
  });
}

function validateCases(split: FormalSplit, cases: readonly FormalPrepareCase[], expected: number): void {
  if (cases.length !== expected) throw new Error(`${split}: expected ${expected} cases, got ${cases.length}`);
  const ids = new Set<string>();
  for (const item of cases) {
    if (item.split !== split) throw new Error(`${item.providerRecord.caseId}: split mismatch`);
    validateProviderRecord(item.providerRecord);
    if (ids.has(item.providerRecord.caseId)) throw new Error(`${split}: duplicate case id ${item.providerRecord.caseId}`);
    ids.add(item.providerRecord.caseId);
    requireSha256(`${item.providerRecord.caseId}.visibleAssetSetSha256`, item.binding.visibleAssetSetSha256);
    safeSegment("spaceId", item.binding.identity.spaceId);
    safeSegment("teamId", item.binding.identity.teamId);
    safeSegment("agentId", item.binding.identity.agentId);
    safeSegment("userId", item.binding.identity.userId);
    safeSegment("agentSource", item.binding.identity.agentSource);
    if (item.binding.identity.taskId !== undefined) safeSegment("taskId", item.binding.identity.taskId);
    requireNonBlank("sessionSeed", item.binding.identity.sessionSeed);
    safeSegment("snapshotId", item.binding.snapshotId);
    if (!item.binding.workspace || typeof item.binding.workspace !== "object" || Array.isArray(item.binding.workspace)) {
      throw new Error(`${item.providerRecord.caseId}.workspace must be an object`);
    }
  }
}

async function selectCases(
  input: PrepareFormalCampaignInput,
  status: FormalPreparePublicStatus,
): Promise<{
  readonly cases: readonly FormalPrepareCase[];
  readonly caseBindingsFileSha256: string;
}> {
  const split: FormalSplit = input.scope === "hidden_test"
    ? "hidden_test"
    : input.scope === "case"
      ? input.caseSplit ?? "dev"
      : "dev";
  const loaded = await input.source.openProviderSplit(
    split,
    split === "hidden_test" ? { allowHiddenTest: true } : undefined,
  );
  const all = loaded.cases;
  validateCases(split, all, status.splits[split].expectedCaseCount);
  const caseBindingsFileSha256 = requireSha256(
    "caseBindingsFileSha256",
    loaded.caseBindingsFileSha256,
  );
  if (input.scope === "dev" || input.scope === "hidden_test") {
    return { cases: all, caseBindingsFileSha256 };
  }
  if (input.scope === "smoke") {
    const byId = new Map(all.map((item) => [item.providerRecord.caseId, item]));
    const cases = status.preregisteredSmokeCaseIds.map((caseId) => {
      const found = byId.get(caseId);
      if (!found) throw new Error(`preregistered smoke case not found in Dev provider data: ${caseId}`);
      return found;
    });
    return { cases, caseBindingsFileSha256 };
  }
  const caseId = safeSegment("caseId", requireNonBlank("caseId", input.caseId));
  const found = all.find((item) => item.providerRecord.caseId === caseId);
  if (!found) throw new Error(`formal case not found in ${split}: ${caseId}`);
  return { cases: [found], caseBindingsFileSha256 };
}

function buildRun(
  input: PrepareFormalCampaignInput,
  status: FormalPreparePublicStatus,
  item: FormalPrepareCase,
  variant: FormalVariantId,
  repeat: number,
  preparedAt: string,
  caseBindingsFileSha256: string,
): { run: PreparedFormalRun; files: Readonly<Record<string, unknown>> } {
  const caseId = item.providerRecord.caseId;
  const sessionId = deterministicId("session", [
    status.datasetRevision,
    input.campaignId,
    caseId,
    item.binding.identity.sessionSeed,
    variant,
    repeat,
  ]);
  const identity: RealChainIdentity = { ...item.binding.identity, sessionId };
  const messages = buildRealChainProviderInput({
    history: item.providerRecord.contextMessages,
    finalQuery: item.providerRecord.query,
  });
  const providerPrompt = {
    schemaVersion: "task1.formal-provider-prompt.v1",
    historyTransport: USER_PLANE_HISTORY_TRANSPORT_V1,
    messages,
  } as const;
  const stdinEnvelope = messages[0]!.content[0]!.text;
  const exactProviderInputSha256 = sha256(stdinEnvelope);
  const canonicalProviderInputSha256 = requireSha256(
    "providerInputCanonicalSha256",
    input.source.canonicalProviderInputSha256(messages),
  );
  const runId = deterministicId("run", [status.datasetRevision, input.campaignId, caseId, variant, repeat]);
  const directory = join(
    input.outputRoot,
    safeSegment("datasetRevision", status.datasetRevision),
    safeSegment("campaignId", input.campaignId),
    safeSegment("caseId", caseId),
    variant,
    String(repeat),
  );
  const opaqueRuntimeDirectory = join(
    requireNonBlank("runtimeRoot", input.runtimeRoot),
    safeSegment("runId", runId),
  );
  const executionWorkspace = join(opaqueRuntimeDirectory, "workspace");
  const workspacePolicy = {
    path: executionWorkspace,
    initialState: "empty",
    inheritsDatasetWorkspace: false,
    createAtExecution: true,
  } as const;
  const workspacePolicySha256 = requireSha256(
    "executionWorkspacePolicySha256",
    input.source.canonicalProviderInputSha256({
      initialState: workspacePolicy.initialState,
      inheritsDatasetWorkspace: workspacePolicy.inheritsDatasetWorkspace,
      createAtExecution: workspacePolicy.createAtExecution,
    }),
  );
  const model = requireNonBlank("model", input.model ?? DEFAULT_FORMAL_MODEL);
  const reasoningEffort = input.reasoningEffort ?? DEFAULT_FORMAL_REASONING_EFFORT;
  const proxyBaseUrl = normalizeFormalProxyBaseUrl(input.proxyInstance.proxyBaseUrl);
  const invocation = buildCodexInvocation({
    workspaceDir: executionWorkspace,
    model,
    approveForMe: true,
    configArgs: buildCodexConfigArgs({
      providerBaseUrl: buildMemoryProxyCodexBaseUrl(
        proxyBaseUrl,
        identity.spaceId,
      ),
      providerHeaders: buildRealChainIdentityHeaders(identity),
      providerEnvHeaders: { "x-tdai-user-key": FORMAL_TDAI_USER_KEY_ENV },
      reasoningEffort,
      verbosity: DEFAULT_FORMAL_VERBOSITY,
    }),
  });
  const isolatedHome = join(opaqueRuntimeDirectory, "home");
  const command = {
    schemaVersion: "task1.formal-prepare-command.v1",
    autoExecute: false,
    executable: invocation.executable,
    args: invocation.args,
    versionProbe: {
      executable: invocation.executable,
      args: [...(invocation.commandPrefix ?? []), "--version"],
    },
    stdinSource: "provider-prompt.json#/messages/0/content/0/text",
    requiredEnvironment: [FORMAL_TDAI_USER_KEY_ENV],
    preflight: {
      method: "GET",
      healthUrl: `${proxyBaseUrl}/health`,
      expected: {
        injectionEnabled: true,
        toolPromptProfile: input.proxyInstance.expectedToolPromptProfile,
        serverInstanceId: safeSegment("proxyInstance.instanceId", input.proxyInstance.instanceId),
        serverStartedAt: requireIsoDateTime("proxyInstance.instanceEpoch", input.proxyInstance.instanceEpoch),
        codexUpstream: OFFICIAL_CODEX_UPSTREAM_URL,
        codexUpstreamAuth: "client-passthrough",
        experimentReadOnly: {
          extractionDisabled: true,
          tdaiL0WriteDisabled: true,
          skillLlmWriteDisabled: true,
          analyseMarkerDisabled: true,
          toolPromptDiagnosticDisabled: true,
          ready: true,
        },
        toolPromptDiagnostic: "disabled",
        experimentConfigFingerprint: {
          schemaVersion: EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA,
          baseSha256: requireSha256(
            "proxyInstance.experimentBaseConfigSha256",
            input.proxyInstance.experimentBaseConfigSha256,
          ),
          effectiveSha256: requireSha256(
            "proxyInstance.experimentEffectiveConfigSha256",
            input.proxyInstance.experimentEffectiveConfigSha256,
          ),
        },
        experimentConfigFileSha256: requireSha256(
          "proxyInstance.configFileSha256",
          input.proxyInstance.configFileSha256,
        ),
      },
    },
    proxyStartupContract: {
      freshProcessRequired: true,
      configurationFileMutation: false,
      configurationFile: {
        path: requireAbsolutePath(
          "proxyInstance.configFilePath",
          input.proxyInstance.configFilePath,
        ),
        exactSha256: requireSha256(
          "proxyInstance.configFileSha256",
          input.proxyInstance.configFileSha256,
        ),
      },
      cliOverride: [
        "--tool-prompt-profile",
        input.proxyInstance.expectedToolPromptProfile,
        "--experiment-read-only",
      ],
    },
    workspacePolicy,
    environmentPolicy: {
      helper: "isolateCodexEnvironment",
      authentication: "current-codex-home-or-userprofile-dot-codex",
      copyAuthJson: false,
      readAuthJsonDuringPrepare: false,
      isolatedHome,
      isolatedUserProfile: isolatedHome,
      isolatedCodexSqliteHome: join(isolatedHome, "sqlite"),
    },
    executionRequiredGates: {
      identityBinding: {
        state: "unverified-prepare-only",
        requiredBefore: "model-invocation",
        expected: {
          datasetUserId: item.binding.identity.userId,
          spaceId: item.binding.identity.spaceId,
          teamId: item.binding.identity.teamId,
          agentId: item.binding.identity.agentId,
          ...(item.binding.identity.taskId ? { taskId: item.binding.identity.taskId } : {}),
          visibleAssetSetSha256: item.binding.visibleAssetSetSha256,
        },
        checks: [
          "auth-user-mapping",
          "space",
          "team",
          "agent",
          "task",
          "visible-assets",
        ],
        requiredEvidence:
          "dataset-user-to-resolved-auth-user-mapping-with-required-visibility",
      },
      codeAndPromptFreeze: {
        state: "unverified-prepare-only",
        requiredBefore: "model-invocation",
      },
      runtimeIsolation: {
        state: "planned-prepare-only",
        requiredBefore: "model-invocation",
        operation: "materializePreparedRunExecutionContext",
      },
      campaignMatrix: {
        state: "unregistered-prepare-only",
        requiredBefore: "formal-comparison",
        requiredOrder: "AB/BA",
      },
    },
  } as const;
  const splitStatus = status.splits[item.split];
  const manifest: FormalPrepareRunManifest = {
    schemaVersion: "task1.formal-prepare-run-manifest.v1",
    prepareOnly: true,
    formalMetricEligible: false,
    dataset_revision: status.datasetRevision,
    dataset_tag: status.datasetTag,
    dataset_tag_object: status.datasetTagObject,
    dataset_commit: requireCommit("datasetCommit", status.datasetCommit),
    contract_sha256: requireSha256("contractSha256", status.contractSha256),
    provider_input_sha256: exactProviderInputSha256,
    provider_input_canonical_sha256: canonicalProviderInputSha256,
    provider_corpus_sha256: requireSha256("providerInputSha256", splitStatus.providerInputSha256),
    private_gold_sha256: requireSha256("privateGoldSha256", splitStatus.privateGoldSha256),
    private_gold_hash_scope: splitStatus.privateGoldHashScope,
    snapshot_sha256: requireSha256("snapshotSha256", splitStatus.snapshotSha256),
    pair_contract_sha256: requireSha256("pairContractSha256", splitStatus.pairContractSha256),
    pair_contract_hash_scope: splitStatus.pairContractHashScope,
    code_commit: requireCommit("codeCommit", input.codeCommit),
    prompt_freeze_commit: requireCommit("promptFreezeCommit", input.promptFreezeCommit),
    proxy_instance_id: safeSegment("proxyInstance.instanceId", input.proxyInstance.instanceId),
    proxy_instance_epoch: requireIsoDateTime("proxyInstance.instanceEpoch", input.proxyInstance.instanceEpoch),
    proxy_config_sha256: requireSha256(
      "proxyInstance.experimentEffectiveConfigSha256",
      input.proxyInstance.experimentEffectiveConfigSha256,
    ),
    proxy_config_file_sha256: requireSha256(
      "proxyInstance.configFileSha256",
      input.proxyInstance.configFileSha256,
    ),
    proxy_base_config_sha256: requireSha256(
      "proxyInstance.experimentBaseConfigSha256",
      input.proxyInstance.experimentBaseConfigSha256,
    ),
    identity_binding_state: "unverified-prepare-only",
    expected_tool_prompt_profile: input.proxyInstance.expectedToolPromptProfile,
    expected_codex_upstream_url: OFFICIAL_CODEX_UPSTREAM_URL,
    expected_codex_upstream_auth: "client-passthrough",
    case_binding_sha256: requireSha256(
      "caseBindingSha256",
      input.source.canonicalProviderInputSha256({
        caseId,
        split: item.split,
        identity: item.binding.identity,
        snapshotId: item.binding.snapshotId,
        workspace: item.binding.workspace,
        visibleAssetSetSha256: item.binding.visibleAssetSetSha256,
      }),
    ),
    case_bindings_file_sha256: requireSha256("caseBindingsFileSha256", caseBindingsFileSha256),
    execution_workspace_path: executionWorkspace,
    execution_workspace_policy_sha256: workspacePolicySha256,
    asset_binding_state: "not-restored-prepare-only",
    asset_binding_input_sha256: requireSha256(
      "assetBindingInputSha256",
      input.source.canonicalProviderInputSha256({
        caseId,
        snapshotId: item.binding.snapshotId,
        workspace: item.binding.workspace,
        visibleAssetSetSha256: item.binding.visibleAssetSetSha256,
      }),
    ),
    visible_asset_set_sha256: requireSha256(
      "visibleAssetSetSha256",
      item.binding.visibleAssetSetSha256,
    ),
    snapshot_id: item.binding.snapshotId,
    variant_id: variant,
    profile_id: input.proxyInstance.expectedToolPromptProfile,
    model_id: model,
    reasoning_effort: reasoningEffort,
    verbosity: DEFAULT_FORMAL_VERBOSITY,
    case_id: caseId,
    // Pair membership belongs to the private Measurement overlay. PrepareOnly
    // keeps the required manifest field explicit without importing that data.
    pair_id: null,
    split: item.split,
    repeat,
    run_id: runId,
    session_id: sessionId,
    history_transport: USER_PLANE_HISTORY_TRANSPORT_V1,
    episode_policy: FORMAL_EPISODE_POLICY,
    prepared_at: preparedAt,
    started_at: null,
    finished_at: null,
  };
  return {
    run: { directory, manifest, command },
    files: {
      "run-manifest.json": manifest,
      "provider-prompt.json": providerPrompt,
      "prepare-command.json": command,
    },
  };
}

/** Execution-only seam. PrepareOnly never calls it or reads process.env. */
export function materializePreparedRunEnvironment(
  run: PreparedFormalRun,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  requireNonBlank(FORMAL_TDAI_USER_KEY_ENV, source[FORMAL_TDAI_USER_KEY_ENV]);
  const platformHome = source.USERPROFILE ?? source.HOME;
  const authenticatedCodexHome = source.CODEX_HOME
    ?? join(requireNonBlank("USERPROFILE or HOME", platformHome), ".codex");
  const workdirLeakNames = new Set([
    "PWD",
    "OLDPWD",
    "INIT_CWD",
    "NPM_CONFIG_LOCAL_PREFIX",
    "NPM_PACKAGE_JSON",
    "NPM_LIFECYCLE_SCRIPT",
    "VSCODE_CWD",
  ]);
  const sanitizedSource = Object.fromEntries(
    Object.entries(source).filter(([name]) => !workdirLeakNames.has(name.toUpperCase())),
  );
  return isolateCodexEnvironment(
    sanitizedSource,
    authenticatedCodexHome,
    run.command.environmentPolicy.isolatedHome,
  );
}

export interface MaterializedPreparedRunExecutionContext {
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}

/**
 * Execution-only filesystem Gate. The opaque run directory is created exactly
 * once and must not already exist; a failed/retried run needs a new campaign or
 * repeat. This function prepares no assets and never reads/copies auth.json.
 */
export async function materializePreparedRunExecutionContext(
  run: PreparedFormalRun,
  source: NodeJS.ProcessEnv,
): Promise<MaterializedPreparedRunExecutionContext> {
  const environment = materializePreparedRunEnvironment(run, source);
  const workspace = requireAbsolutePath("workspacePolicy.path", run.command.workspacePolicy.path);
  const isolatedHome = requireAbsolutePath(
    "environmentPolicy.isolatedHome",
    run.command.environmentPolicy.isolatedHome,
  );
  const sqliteHome = requireAbsolutePath(
    "environmentPolicy.isolatedCodexSqliteHome",
    run.command.environmentPolicy.isolatedCodexSqliteHome,
  );
  const opaqueRunRoot = dirname(workspace);
  if (dirname(isolatedHome) !== opaqueRunRoot || dirname(sqliteHome) !== isolatedHome) {
    throw new Error("prepared runtime paths must share one opaque run root");
  }
  // The shared neutral namespace is safe to create recursively; the per-run
  // opaque directory below it remains an exclusive, fail-if-exists claim.
  await mkdir(dirname(opaqueRunRoot), { recursive: true });
  try {
    await mkdir(opaqueRunRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`formal runtime directory already exists: ${opaqueRunRoot}`, { cause: error });
    }
    throw error;
  }
  await mkdir(workspace);
  await mkdir(isolatedHome);
  await mkdir(sqliteHome);
  return Object.freeze({ cwd: workspace, environment: Object.freeze(environment) });
}

async function writeRunFiles(directory: string, files: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, value]) => (
    writeFile(join(directory, name), stableJson(value), { encoding: "utf8" })
  )));
}

async function reserveCampaignRoot(campaignRoot: string): Promise<void> {
  await mkdir(dirname(campaignRoot), { recursive: true });
  try {
    await mkdir(campaignRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`PrepareOnly refuses to overwrite existing campaign root: ${campaignRoot}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Prepare-only entry. It never invokes the Codex runner, restores assets,
 * inspects CODEX_HOME/auth.json, or opens a Measurement/Gold source. It writes
 * only a command contract, the exact stdin payload, and a Gold-blind manifest.
 */
export async function prepareFormalCampaign(
  input: PrepareFormalCampaignInput,
): Promise<PreparedFormalCampaign> {
  validateHeldOutBoundary(input);
  safeSegment("campaignId", input.campaignId);
  requireNonBlank("outputRoot", input.outputRoot);
  const repeats = input.repeats ?? 1;
  if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error("repeats must be a positive integer");
  const resolvedVariant = resolveToolPromptVariant(input.variant);
  if (resolvedVariant.profile !== input.proxyInstance.expectedToolPromptProfile) {
    throw new Error(
      `Variant ${input.variant} requires Proxy profile ${resolvedVariant.profile}, got ${input.proxyInstance.expectedToolPromptProfile}`,
    );
  }

  const status = validatePublicStatus(await input.source.readPublicStatus());
  const selected = await selectCases(input, status);
  const preparedAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(preparedAt))) throw new Error("createdAt must be an ISO date-time");

  const prepared: Array<{ run: PreparedFormalRun; files: Readonly<Record<string, unknown>> }> = [];
  for (const item of selected.cases) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      prepared.push(buildRun(
        input,
        status,
        item,
        resolvedVariant.variant,
        repeat,
        preparedAt,
        selected.caseBindingsFileSha256,
      ));
    }
  }
  if (input.writeArtifacts !== false) {
    const campaignRoot = join(
      input.outputRoot,
      safeSegment("datasetRevision", status.datasetRevision),
      safeSegment("campaignId", input.campaignId),
    );
    await reserveCampaignRoot(campaignRoot);
    for (const item of prepared) await writeRunFiles(item.run.directory, item.files);
  }
  return Object.freeze({
    schemaVersion: "task1.formal-prepare-campaign.v1",
    scope: input.scope,
    variant: resolvedVariant.variant,
    formalMetricEligible: false,
    runs: Object.freeze(prepared.map((item) => Object.freeze(item.run))),
  });
}
