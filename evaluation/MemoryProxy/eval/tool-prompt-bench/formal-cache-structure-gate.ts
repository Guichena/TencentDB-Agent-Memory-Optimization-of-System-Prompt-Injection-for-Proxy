import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  FORMAL_PROMPT_FREEZE_COMMIT,
  FORMAL_PROMPT_FREEZE_TAG,
  FORMAL_PROMPT_FREEZE_TAG_OBJECT,
  type FormalExecutionReceipt,
} from "./formal-execution-runner.js";
import {
  canonicalSha256,
} from "./measurement-v2/canonical-json.js";
import type {
  FormalM2PreGoldEvidence,
} from "./measurement-v2/formal-m2-evidence-builder.js";
import type {
  ProductionInjectionSegmentV2,
} from "./measurement-v2/production-injection-capture.js";
export {
  FORMAL_PROMPT_FREEZE_COMMIT,
  FORMAL_PROMPT_FREEZE_TAG,
  FORMAL_PROMPT_FREEZE_TAG_OBJECT,
} from "./formal-execution-runner.js";
export const FORMAL_CACHE_STRUCTURE_GATE_SCHEMA =
  "task1.formal-cache-structure-gate.v1" as const;

const CODE_FREEZE_MANIFEST_PATH =
  "MemoryProxy/eval/tool-prompt-bench/variants/code-freeze/code-freeze-manifest.json";
const EXPECTED_VARIANTS = [
  ["V0", "legacy"],
  ["V0-C", "contract-corrected"],
  ["V1a", "protocol-compact"],
  ["V1", "compact"],
  ["V2", "selection-calibrated"],
  ["V3", "capability-pruned"],
] as const;

interface V0CBlockPolicy {
  readonly blockId: string;
  readonly kind: "static_tool" | "mixed";
}

export interface FormalCacheGitResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type FormalCacheGitRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<FormalCacheGitResult>;

export interface FormalCacheStructureGateReceipt {
  readonly schemaVersion: typeof FORMAL_CACHE_STRUCTURE_GATE_SCHEMA;
  readonly passed: true;
  readonly promptFreezeTag: typeof FORMAL_PROMPT_FREEZE_TAG;
  readonly promptFreezeTagObject: string;
  readonly promptFreezeCommit: string;
  readonly taggedManifestPath: typeof CODE_FREEZE_MANIFEST_PATH;
  readonly taggedManifestSha256: string;
  readonly executionCommits: readonly string[];
  readonly invariants: Readonly<{
    allRunsUseTaggedPromptFreeze: true;
    executionCodeDescendsFromFreezeAndWasClean: true;
    providerVisibleEvidenceComplete: true;
    providerCacheUsageEvidenceComplete: true;
    frozenProfilesComplete: true;
    cacheNamespacesUnique: true;
    staticTemplateHashesPresent: true;
    adjacentPrefixMeasurementsPresent: true;
    currentCandidatePrefixInvariantVerified: true;
    v0cSurvivingBlockOrderPreserved: true;
  }>;
  readonly observedRuns: readonly Readonly<{
    readonly runId: string;
    readonly caseId: string;
    readonly variantId: string;
    readonly m2PreGoldCanonicalSha256: string;
    readonly providerInjectionSha256: string;
    readonly providerInjectionTokensO200k: number;
    readonly providerInjectionUtf8Bytes: number;
    readonly providerSourceManifestSha256: string;
    readonly providerRequestBindingSha256: string;
    readonly requestCacheUsage: readonly Readonly<{
      readonly requestId: string;
      readonly cacheReadInputTokens: number;
      readonly cacheWriteInputTokens: null;
    }>[];
  }>[];
  readonly currentCandidatePrefixes: readonly Readonly<{
    readonly variantId: string;
    readonly runIds: readonly string[];
    readonly commonPrefixUtf8Bytes: number;
    readonly commonPrefixSha256: string;
    readonly firstChangedByte: number | null;
    readonly firstVariableSourceUtf8Byte: number | null;
    readonly commonPrefixSourceLayoutSha256: string;
    readonly nonVariableSourceLayoutSha256: string;
    readonly survivingV0CBlockOrder: readonly string[];
  }>[];
  readonly variants: readonly Readonly<{
    readonly variantId: string;
    readonly profileId: string;
    readonly totalInjectionTokensO200k: number;
    readonly totalInjectionSha256: string;
    readonly effectiveSystemSha256: string;
    readonly stablePrefixBytesFromParent: number;
    readonly firstChangedByteFromParent: number | null;
    readonly cacheNamespace: string;
    readonly runnerPromptSha256: string;
    readonly staticTemplateSha256: readonly string[];
  }>[];
}

export interface InspectFormalCacheStructureFreezeInput {
  readonly repositoryRoot: string;
  readonly executions: readonly FormalExecutionReceipt[];
  readonly m2PreGoldEvidence: readonly FormalM2PreGoldEvidence[];
  readonly runGit?: FormalCacheGitRunner;
}

/**
 * Hard cache-structure Gate for a sealed campaign.
 *
 * The immutable C06 Prompt freeze remains the V0-V3 baseline reference and the
 * required execution ancestor. Prompt candidates may intentionally change the
 * injection sources after that baseline. Therefore the formal Gate binds each
 * execution to its independently observed M2 provider-visible injection,
 * source attestation, token count, and cache usage instead of requiring Prompt
 * source files to remain byte-identical to the baseline commit.
 */
export async function inspectFormalCacheStructureFreeze(
  input: InspectFormalCacheStructureFreezeInput,
): Promise<FormalCacheStructureGateReceipt> {
  if (input.executions.length === 0) throw new Error("cache structure Gate requires executions");
  if (input.m2PreGoldEvidence.length === 0) {
    throw new Error("cache structure Gate requires M2 pre-Gold evidence");
  }
  const cwd = resolve(input.repositoryRoot);
  const runGit = input.runGit ?? runGitCommand;
  const tagType = await runGit(
    ["cat-file", "-t", `refs/tags/${FORMAL_PROMPT_FREEZE_TAG}`],
    cwd,
  );
  if (tagType.exitCode !== 0 || tagType.stdout.trim() !== "tag") {
    throw new Error(`${FORMAL_PROMPT_FREEZE_TAG}: expected annotated tag object`);
  }
  const tagObject = await gitCommitish(
    runGit,
    cwd,
    ["rev-parse", `refs/tags/${FORMAL_PROMPT_FREEZE_TAG}`],
    "Prompt freeze tag object",
  );
  if (tagObject !== FORMAL_PROMPT_FREEZE_TAG_OBJECT) {
    throw new Error(`Prompt freeze tag object drift: ${tagObject}`);
  }
  const freezeCommit = await gitCommitish(
    runGit,
    cwd,
    ["rev-parse", `${FORMAL_PROMPT_FREEZE_TAG}^{commit}`],
    "Prompt freeze commit",
  );
  if (freezeCommit !== FORMAL_PROMPT_FREEZE_COMMIT) {
    throw new Error(`Prompt freeze commit drift: ${freezeCommit}`);
  }
  const executionCommits = [...new Set(input.executions.map((execution) => {
    const codeFreeze = execution.codeFreeze;
    const executionCommit = commit("execution code commit", codeFreeze.executionCodeCommit);
    if (codeFreeze.promptFreezeTagObject !== FORMAL_PROMPT_FREEZE_TAG_OBJECT) {
      throw new Error("formal execution Prompt freeze tag object drift");
    }
    if (commit("execution Prompt freeze", codeFreeze.promptFreezeCommit) !== freezeCommit) {
      throw new Error(`formal execution does not use ${FORMAL_PROMPT_FREEZE_TAG}`);
    }
    if (codeFreeze.promptFreezeIsAncestor !== true || codeFreeze.workingTreeClean !== true) {
      throw new Error("formal execution code freeze receipt is not eligible");
    }
    return executionCommit;
  }))].sort();

  const observedRuns = inspectObservedRunEvidence(input.executions, input.m2PreGoldEvidence);

  const show = await runGit([
    "show",
    `${freezeCommit}:${CODE_FREEZE_MANIFEST_PATH}`,
  ], cwd);
  if (show.exitCode !== 0) {
    throw new Error(`unable to read tagged code-freeze manifest: ${show.stderr.trim()}`);
  }
  const manifestText = show.stdout;
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText) as unknown;
  } catch (error) {
    throw new Error("tagged code-freeze manifest is not valid JSON", { cause: error });
  }
  const variants = parseManifest(manifest);
  const v0cBlockPolicies = parseV0CBlockPolicies(manifest);
  const currentCandidatePrefixes = inspectCurrentCandidatePrefixes(
    input.m2PreGoldEvidence,
    v0cBlockPolicies,
  );
  return Object.freeze({
    schemaVersion: FORMAL_CACHE_STRUCTURE_GATE_SCHEMA,
    passed: true as const,
    promptFreezeTag: FORMAL_PROMPT_FREEZE_TAG,
    promptFreezeTagObject: tagObject,
    promptFreezeCommit: freezeCommit,
    taggedManifestPath: CODE_FREEZE_MANIFEST_PATH,
    taggedManifestSha256: sha256(manifestText),
    executionCommits,
    invariants: Object.freeze({
      allRunsUseTaggedPromptFreeze: true as const,
      executionCodeDescendsFromFreezeAndWasClean: true as const,
      providerVisibleEvidenceComplete: true as const,
      providerCacheUsageEvidenceComplete: true as const,
      frozenProfilesComplete: true as const,
      cacheNamespacesUnique: true as const,
      staticTemplateHashesPresent: true as const,
      adjacentPrefixMeasurementsPresent: true as const,
      currentCandidatePrefixInvariantVerified: true as const,
      v0cSurvivingBlockOrderPreserved: true as const,
    }),
    observedRuns,
    currentCandidatePrefixes,
    variants,
  });
}

/**
 * Verify the cache-relevant structure actually observed for the current
 * candidate. This deliberately has no absolute byte threshold: prompt
 * compression may shorten stable text. Instead, runs of the same Variant must
 * keep the production-wide variable boundary stable. Production-owned leading
 * context such as Codex session_context may vary before tool injection. The
 * tagged V0-C block policy separately proves the surviving tool-block order and
 * the static_tool seams without imposing an unsupported byte seam on mixed
 * blocks. The first byte-level difference must still be owned by a dynamic
 * asset/runtime binding rather than by a supposedly stable source.
 */
function inspectCurrentCandidatePrefixes(
  evidence: readonly FormalM2PreGoldEvidence[],
  v0cBlockPolicies: readonly V0CBlockPolicy[],
): FormalCacheStructureGateReceipt["currentCandidatePrefixes"] {
  const byVariant = new Map<string, FormalM2PreGoldEvidence[]>();
  for (const item of evidence) {
    const group = byVariant.get(item.variantId) ?? [];
    group.push(item);
    byVariant.set(item.variantId, group);
  }

  return Object.freeze([...byVariant.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variantId, items]) => {
      const runs = [...items].sort((left, right) => left.runId.localeCompare(right.runId));
      if (runs.length < 2) {
        throw new Error(`${variantId}: current-candidate prefix invariant requires at least two runs`);
      }
      const observed = runs.map((item) => {
        const segments = item.tokenCapture.segments;
        if (segments.length === 0) {
          throw new Error(`${item.runId}: production source manifest has no segments`);
        }
        const toolSegments = segments.filter((segment) => (
          v0cBlockIdForProductionBlock(segment.injectionBlockId) !== null
        ));
        if (toolSegments.length === 0) {
          throw new Error(`${item.runId}: production source manifest has no V0-C tool segments`);
        }
        return {
          runId: item.runId,
          bytes: Buffer.from(segments.map((segment) => segment.text).join(""), "utf8"),
          segments,
          firstVariable: segments.find((segment) => isVariableSource(segment.kind)) ?? null,
          toolSegments,
        };
      });
      const firstVariableSourceUtf8Byte = observed[0].firstVariable?.startUtf8Byte ?? null;
      const firstVariableSourceIdentity = variableSourceIdentity(observed[0].firstVariable);
      if (observed.some((run) => (
        (run.firstVariable?.startUtf8Byte ?? null) !== firstVariableSourceUtf8Byte
        || variableSourceIdentity(run.firstVariable) !== firstVariableSourceIdentity
      ))) {
        throw new Error(`${variantId}: dynamic/runtime source moved earlier across current-candidate runs`);
      }
      const survivingBlockOrders = observed.map((run) => collectSurvivingV0CBlockOrder(
        run.toolSegments,
        v0cBlockPolicies,
      ));
      const survivingV0CBlockOrder = survivingBlockOrders[0];
      if (
        survivingV0CBlockOrder.length === 0
        || survivingBlockOrders.some((blocks) => (
          canonicalSha256(blocks) !== canonicalSha256(survivingV0CBlockOrder)
        ))
      ) {
        throw new Error(`${variantId}: surviving V0-C block order differs across current-candidate runs`);
      }

      // A leading dynamic session_context can end the byte-level common prefix
      // before any tool text. Compare the complete ordered non-variable source
      // sequence separately so later static/execution Prompt drift cannot hide
      // behind that legitimate per-run context change.
      const nonVariableLayoutHashes = observed.map((run) => canonicalSha256(
        nonVariableSourceLayout(run.segments),
      ));
      const nonVariableSourceLayoutSha256 = nonVariableLayoutHashes[0];
      if (nonVariableLayoutHashes.some((hash) => hash !== nonVariableSourceLayoutSha256)) {
        throw new Error(`${variantId}: non-variable production Prompt sources differ across current-candidate runs`);
      }

      const commonPrefixUtf8Bytes = commonPrefixBytes(observed.map((run) => run.bytes));
      const prefixLayoutHashes = observed.map((run) => canonicalSha256(normalizedSourceLayout(
        run.segments.filter((segment) => segment.startUtf8Byte < commonPrefixUtf8Bytes),
      )));
      const commonPrefixSourceLayoutSha256 = prefixLayoutHashes[0];
      if (prefixLayoutHashes.some((hash) => hash !== commonPrefixSourceLayoutSha256)) {
        throw new Error(`${variantId}: production source layout differs inside the stable common prefix`);
      }
      const allBytesEqual = observed.every((run) => (
        run.bytes.length === observed[0].bytes.length
        && run.bytes.equals(observed[0].bytes)
      ));
      const firstChangedByte = allBytesEqual ? null : commonPrefixUtf8Bytes;
      if (firstChangedByte !== null) {
        const strictVariableOwners = observed.map((run) => (
          variableSourceOwnsBoundary(run.segments, firstChangedByte)
        ));
        if (!strictVariableOwners.some(Boolean)) {
          throw new Error(
            `${variantId}: stable common prefix first changes outside a dynamic-asset/runtime-binding source`,
          );
        }
        for (const [index, run] of observed.entries()) {
          if (
            !strictVariableOwners[index]
            && !variableSourceEndsAtBoundary(run.segments, firstChangedByte)
          ) {
            throw new Error(
              `${variantId}: stable common prefix first changes outside a dynamic-asset/runtime-binding source in ${run.runId}`,
            );
          }
        }
      }

      const commonPrefix = observed[0].bytes.subarray(0, commonPrefixUtf8Bytes);
      return Object.freeze({
        variantId,
        runIds: Object.freeze(observed.map((run) => run.runId)),
        commonPrefixUtf8Bytes,
        commonPrefixSha256: sha256Bytes(commonPrefix),
        firstChangedByte,
        firstVariableSourceUtf8Byte,
        commonPrefixSourceLayoutSha256,
        nonVariableSourceLayoutSha256,
        survivingV0CBlockOrder,
      });
    }));
}

function normalizedSourceLayout(segments: readonly ProductionInjectionSegmentV2[]): readonly object[] {
  return segments.map((segment) => ({
    sourceId: segment.sourceId,
    sourceKind: segment.kind,
    injectionBlockId: segment.injectionBlockId,
    ...(isVariableSource(segment.kind) ? {} : { sourceSha256: segment.sha256 }),
  }));
}

function nonVariableSourceLayout(
  segments: readonly ProductionInjectionSegmentV2[],
): readonly object[] {
  return segments
    .filter((segment) => !isVariableSource(segment.kind))
    .map((segment) => ({
      sourceId: segment.sourceId,
      sourceKind: segment.kind,
      injectionBlockId: segment.injectionBlockId,
      sourceSha256: segment.sha256,
    }));
}

function commonPrefixBytes(values: readonly Buffer[]): number {
  const limit = Math.min(...values.map((value) => value.length));
  let offset = 0;
  while (offset < limit && values.every((value) => value[offset] === values[0][offset])) {
    offset += 1;
  }
  return offset;
}

function variableSourceOwnsBoundary(
  segments: readonly ProductionInjectionSegmentV2[],
  byteOffset: number,
): boolean {
  return segments.some((segment) => (
    isVariableSource(segment.kind)
    && segment.startUtf8Byte <= byteOffset
    && byteOffset < segment.endUtf8ByteExclusive
  ));
}

function variableSourceEndsAtBoundary(
  segments: readonly ProductionInjectionSegmentV2[],
  byteOffset: number,
): boolean {
  return segments.some((segment) => (
    isVariableSource(segment.kind) && segment.endUtf8ByteExclusive === byteOffset
  ));
}

function isVariableSource(kind: ProductionInjectionSegmentV2["kind"]): boolean {
  return kind === "dynamic-asset" || kind === "runtime-binding";
}

function variableSourceIdentity(segment: ProductionInjectionSegmentV2 | null): string | null {
  return segment === null
    ? null
    : canonicalSha256({
      sourceId: segment.sourceId,
      sourceKind: segment.kind,
      injectionBlockId: segment.injectionBlockId,
    });
}

/**
 * The tagged V0-C manifest freezes block order and whether each block is
 * static_tool or mixed, but not mixed-block source offsets. Enforce exactly
 * that available non-regression proof: every surviving mapped block remains a
 * contiguous V0-C-order subsequence and still contains stable/execution text.
 * For static_tool blocks, runtime bindings may not jump ahead of that text.
 * Mixed blocks keep only the block-order contract because V0-C does not freeze
 * whether their dynamic asset precedes or follows the stable fragment.
 */
function collectSurvivingV0CBlockOrder(
  segments: readonly ProductionInjectionSegmentV2[],
  policies: readonly V0CBlockPolicy[],
): readonly string[] {
  const policyByBlock = new Map(policies.map((policy) => [policy.blockId, policy] as const));
  const blockOrder: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const blockId = v0cBlockIdForProductionBlock(segment.injectionBlockId);
    if (blockId === null) continue;
    if (!policyByBlock.has(blockId)) {
      throw new Error(`current-candidate tool block is absent from V0-C: ${blockId}`);
    }
    if (blockOrder.at(-1) === blockId) continue;
    if (seen.has(blockId)) {
      throw new Error(`current-candidate V0-C block re-enters after another block: ${blockId}`);
    }
    seen.add(blockId);
    blockOrder.push(blockId);
  }
  const v0cBlockOrder = policies.map((policy) => policy.blockId);
  const indices = blockOrder.map((blockId) => v0cBlockOrder.indexOf(blockId));
  if (
    indices.some((index) => index < 0)
    || indices.some((index, position) => position > 0 && index <= indices[position - 1])
  ) {
    throw new Error("current-candidate mapped blocks do not preserve V0-C order");
  }

  for (const blockId of blockOrder) {
    const blockSegments = segments.filter((segment) => (
      v0cBlockIdForProductionBlock(segment.injectionBlockId) === blockId
    ));
    const firstStableIndex = blockSegments.findIndex((segment) => !isVariableSource(segment.kind));
    if (firstStableIndex < 0) {
      throw new Error(`surviving V0-C block has no stable/execution source: ${blockId}`);
    }
    if (policyByBlock.get(blockId)?.kind === "static_tool") {
      const firstVariableIndex = blockSegments.findIndex((segment) => isVariableSource(segment.kind));
      if (firstVariableIndex >= 0 && firstVariableIndex < firstStableIndex) {
        throw new Error(`dynamic/runtime source precedes stable content in V0-C block ${blockId}`);
      }
    }
  }
  return Object.freeze(blockOrder);
}

function v0cBlockIdForProductionBlock(injectionBlockId: string): string | null {
  const mapping: Readonly<Record<string, string>> = {
    "skill-tools-injector": "skill_tools",
    "skill-injector": "available_skills",
    "knowledge-tools-injector": "knowledge_tools",
    "tdai-memory-tools-injector": "tdai_memory_tools",
    "tdai-profile-memory-injector": "tdai_profile_memory",
  };
  return mapping[injectionBlockId] ?? null;
}

function inspectObservedRunEvidence(
  executions: readonly FormalExecutionReceipt[],
  evidence: readonly FormalM2PreGoldEvidence[],
): FormalCacheStructureGateReceipt["observedRuns"] {
  if (executions.length !== evidence.length) {
    throw new Error("cache structure Gate requires one M2 pre-Gold item per execution");
  }
  const byRunId = new Map<string, FormalM2PreGoldEvidence>();
  for (const item of evidence) {
    if (byRunId.has(item.runId)) throw new Error(`duplicate M2 pre-Gold run ${item.runId}`);
    byRunId.set(item.runId, item);
  }

  return Object.freeze([...executions]
    .sort((left, right) => left.runId.localeCompare(right.runId))
    .map((execution) => {
      const item = byRunId.get(execution.runId);
      if (!item) throw new Error(`missing M2 pre-Gold evidence for ${execution.runId}`);
      if (
        item.caseId !== execution.caseId
        || item.variantId !== execution.variantId
        || item.runIsolation.runId !== execution.runId
      ) {
        throw new Error(`${execution.runId}: M2 pre-Gold identity does not match execution`);
      }
      const { canonicalSha256: recordedPreGoldSha, ...preGoldContent } = item;
      if (canonicalSha256(preGoldContent) !== recordedPreGoldSha) {
        throw new Error(`${execution.runId}: M2 pre-Gold canonical SHA-256 mismatch`);
      }

      const capture = item.tokenCapture;
      const manifest = capture.manifest;
      const ledger = capture.tokenLedger;
      const source = capture.sourceManifest;
      const attestation = ledger.classification.expectedSourceAttestation;
      const { canonicalSha256: recordedManifestSha, ...manifestContent } = manifest;
      const { canonicalSha256: recordedSourceSha, ...sourceContent } = source;
      const { canonicalSha256: recordedLedgerSha, ...ledgerContent } = ledger;
      if (
        canonicalSha256(manifestContent) !== recordedManifestSha
        || canonicalSha256(sourceContent) !== recordedSourceSha
        || canonicalSha256(ledgerContent) !== recordedLedgerSha
      ) {
        throw new Error(`${execution.runId}: provider-visible injection evidence SHA-256 mismatch`);
      }
      if (
        ledger.runId !== execution.runId
        || ledger.variantId !== execution.variantId
        || manifest.providerInjectionSha256 !== ledger.totalInjectionSha256
        || manifest.providerInjectionTokens !== ledger.totalInjectionTokens
        || manifest.providerInjectionUtf8Bytes !== ledger.totalInjectionUtf8Bytes
        || ledger.classification.trustedSourceManifestSha256 !== source.canonicalSha256
        || ledger.classification.sourceInventorySha256 !== source.sourceInventorySha256
        || ledger.classification.orderedSourceManifestSha256 !== source.orderedSourceManifestSha256
        || ledger.classification.sourceRootSha256 !== source.sourceRootSha256
        || attestation.authority !== "campaign-integration"
        || attestation.frozenProviderSourceManifestSha256
          !== manifest.productionSourceManifestSha256
        || !isSha256(attestation.providerRequestBindingSha256)
        || ledger.classification.formalCompilerClosure.status !== "ready"
      ) {
        throw new Error(`${execution.runId}: provider-visible injection/source attestation mismatch`);
      }

      if (item.requestUsageLedger.status !== "ready") {
        throw new Error(`${execution.runId}: provider cache usage ledger is not ready`);
      }
      const usageLedger = item.requestUsageLedger.ledger;
      if (usageLedger.runId !== execution.runId || usageLedger.requests.length === 0) {
        throw new Error(`${execution.runId}: provider cache usage ledger identity is invalid`);
      }
      const requestCacheUsage = usageLedger.requests.map((request) => {
        const usage = request.providerUsage;
        const read = usage.normalized.cacheReadInputTokens;
        const write = usage.normalized.cacheWriteInputTokens;
        if (
          usage.fieldStates.cacheReadInputTokens !== "reported"
          || usage.fieldStates.cacheWriteInputTokens !== "unsupported"
          || typeof read !== "number"
          || !Number.isSafeInteger(read)
          || read < 0
          || write !== null
        ) {
          throw new Error(`${execution.runId}: provider cache usage evidence is incomplete`);
        }
        return Object.freeze({
          requestId: request.requestId,
          cacheReadInputTokens: read,
          cacheWriteInputTokens: null,
        });
      });
      const cacheReadTotal = requestCacheUsage.reduce(
        (total, request) => total + request.cacheReadInputTokens,
        0,
      );
      const firstCache = requestCacheUsage[0];
      const isolationCache = item.runIsolation.providerCache;
      if (
        usageLedger.aggregateProviderUsage.cacheReadInputTokens !== cacheReadTotal
        || usageLedger.aggregateProviderUsage.cacheWriteInputTokens !== null
        || isolationCache.cacheReadState !== "reported"
        || isolationCache.cacheWriteState !== "unsupported"
        || isolationCache.cacheReadInputTokens !== firstCache.cacheReadInputTokens
        || isolationCache.cacheWriteInputTokens !== null
        || isolationCache.telemetryUsable !== true
        || isolationCache.cacheLane !== (firstCache.cacheReadInputTokens > 0 ? "warm" : "cold")
      ) {
        throw new Error(`${execution.runId}: provider cache usage evidence is inconsistent`);
      }
      return Object.freeze({
        runId: execution.runId,
        caseId: execution.caseId,
        variantId: execution.variantId,
        m2PreGoldCanonicalSha256: recordedPreGoldSha,
        providerInjectionSha256: manifest.providerInjectionSha256,
        providerInjectionTokensO200k: manifest.providerInjectionTokens,
        providerInjectionUtf8Bytes: manifest.providerInjectionUtf8Bytes,
        providerSourceManifestSha256: manifest.productionSourceManifestSha256,
        providerRequestBindingSha256: attestation.providerRequestBindingSha256!,
        requestCacheUsage: Object.freeze(requestCacheUsage),
      });
    }));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function parseV0CBlockPolicies(raw: unknown): readonly V0CBlockPolicy[] {
  const manifest = record("code-freeze manifest", raw);
  const inventory = array("profileInventory", manifest.profileInventory);
  const v0c = inventory
    .map((row, index) => record(`profileInventory[${index}]`, row))
    .find((row) => row.variant === "V0-C" && row.profile === "contract-corrected");
  if (!v0c) throw new Error("tagged code-freeze manifest is missing V0-C block order");
  const blockOrder = array("V0-C.blocks", v0c.blocks).map((block, index) => {
    const entry = record(`V0-C.blocks[${index}]`, block);
    const blockId = nonBlank(`V0-C.blocks[${index}].blockId`, entry.blockId);
    if (entry.kind !== "static_tool" && entry.kind !== "mixed") {
      throw new Error(`V0-C.blocks[${index}].kind must be static_tool or mixed`);
    }
    return Object.freeze({ blockId, kind: entry.kind });
  });
  if (blockOrder.length === 0
    || new Set(blockOrder.map((block) => block.blockId)).size !== blockOrder.length) {
    throw new Error("tagged V0-C block order must be non-empty and unique");
  }
  return Object.freeze(blockOrder);
}

function parseManifest(raw: unknown): FormalCacheStructureGateReceipt["variants"] {
  const manifest = record("code-freeze manifest", raw);
  if (manifest.schemaVersion !== 1 || manifest.stage !== "C06") {
    throw new Error("tagged code-freeze manifest is not the C06 schema");
  }
  const inventory = keyedRows("profileInventory", manifest.profileInventory);
  const namespaces = keyedRows("cacheNamespaces", manifest.cacheNamespaces);
  const smoke = keyedRows("runnerProfileSmoke", manifest.runnerProfileSmoke);
  const namespaceValues = new Set<string>();
  const promptHashes = new Set<string>();
  const rows = EXPECTED_VARIANTS.map(([variantId, profileId], index) => {
    const profile = exactVariantProfile("profileInventory", inventory, variantId, profileId);
    const namespace = exactVariantProfile("cacheNamespaces", namespaces, variantId, profileId);
    const runner = exactVariantProfile("runnerProfileSmoke", smoke, variantId, profileId);
    const cacheNamespace = nonBlank(`${variantId}.hookCacheIdentity`, namespace.hookCacheIdentity);
    if (namespaceValues.has(cacheNamespace)) throw new Error("cache namespaces must be unique");
    namespaceValues.add(cacheNamespace);
    const runnerPromptSha256 = digest(`${variantId}.runnerPromptSha256`, runner.promptSha256);
    if (promptHashes.has(runnerPromptSha256)) throw new Error("runner Prompt hashes must be unique");
    promptHashes.add(runnerPromptSha256);
    const blocks = array(`${variantId}.blocks`, profile.blocks);
    if (blocks.length === 0) throw new Error(`${variantId}.blocks must not be empty`);
    const staticTemplateSha256 = blocks.map((block, blockIndex) => digest(
      `${variantId}.blocks[${blockIndex}].staticTemplateSha256`,
      record(`${variantId}.blocks[${blockIndex}]`, block).staticTemplateSha256,
    ));
    const stablePrefix = nonNegativeInteger(
      `${variantId}.stablePrefixBytesFromParent`,
      profile.stablePrefixBytesFromParent,
    );
    const firstChanged = profile.firstChangedByteFromParent === null
      ? null
      : nonNegativeInteger(`${variantId}.firstChangedByteFromParent`, profile.firstChangedByteFromParent);
    if (index === 0 && firstChanged !== null) throw new Error("V0 must not have a parent diff");
    if (index > 0 && firstChanged === null) throw new Error(`${variantId} must have a parent diff`);
    if (firstChanged !== null && stablePrefix !== firstChanged) {
      throw new Error(`${variantId} stable prefix does not equal its first changed byte`);
    }
    return Object.freeze({
      variantId,
      profileId,
      totalInjectionTokensO200k: nonNegativeInteger(
        `${variantId}.totalInjectionTokensO200k`,
        profile.totalInjectionTokensO200k,
      ),
      totalInjectionSha256: digest(`${variantId}.totalInjectionSha256`, profile.totalInjectionSha256),
      effectiveSystemSha256: digest(`${variantId}.effectiveSystemSha256`, profile.effectiveSystemSha256),
      stablePrefixBytesFromParent: stablePrefix,
      firstChangedByteFromParent: firstChanged,
      cacheNamespace,
      runnerPromptSha256,
      staticTemplateSha256: Object.freeze(staticTemplateSha256),
    });
  });
  if (inventory.size !== EXPECTED_VARIANTS.length
    || namespaces.size !== EXPECTED_VARIANTS.length
    || smoke.size !== EXPECTED_VARIANTS.length) {
    throw new Error("tagged code-freeze manifest contains an unexpected Variant set");
  }
  return Object.freeze(rows);
}

function keyedRows(label: string, value: unknown): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const [index, item] of array(label, value).entries()) {
    const row = record(`${label}[${index}]`, item);
    const variant = nonBlank(`${label}[${index}].variant`, row.variant);
    if (result.has(variant)) throw new Error(`${label} contains duplicate Variant ${variant}`);
    result.set(variant, row);
  }
  return result;
}

function exactVariantProfile(
  label: string,
  rows: ReadonlyMap<string, Record<string, unknown>>,
  variant: string,
  profile: string,
): Record<string, unknown> {
  const row = rows.get(variant);
  if (!row || row.profile !== profile) throw new Error(`${label} mapping mismatch for ${variant}`);
  return row;
}

async function gitCommitish(
  runGit: FormalCacheGitRunner,
  cwd: string,
  args: readonly string[],
  label: string,
): Promise<string> {
  const result = await runGit(args, cwd);
  if (result.exitCode !== 0) throw new Error(`unable to resolve ${label}: ${result.stderr.trim()}`);
  return commit(label, result.stdout.trim());
}

function runGitCommand(args: readonly string[], cwd: string): Promise<FormalCacheGitResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn("git", [...args], { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveCommand({ exitCode, stdout, stderr }));
  });
}

function record(label: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(label: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function nonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-blank`);
  return value;
}

function digest(label: string, value: unknown): string {
  const text = nonBlank(label, value).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}

function commit(label: string, value: unknown): string {
  const text = nonBlank(label, value).toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(text)) throw new Error(`${label} must be a 40-character Git commit`);
  return text;
}

function nonNegativeInteger(label: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
