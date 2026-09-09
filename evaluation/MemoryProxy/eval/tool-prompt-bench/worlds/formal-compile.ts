/** Compile one Formal V2 Case without mixing runner, provider, and scorer data. */
import {
  assertFormalWorldContract,
  toProviderVisibleCase,
  type FormalWorldContract,
  type FormalSplit,
  type ProviderVisibleCase,
  type RuntimeIdentity,
  type WorkspaceRef,
} from "./formal-schema.js";
import { canonicalSha256 } from "./formal-snapshot.js";
import {
  resolveVisibleSnapshot,
  type ResolvedVisibleSnapshot,
} from "./formal-visibility.js";

export interface FormalSessionInitRequest {
  /** URL path / tenant selector, not provider text. */
  spaceId: string;
  registration: {
    team_id: string;
    user_id: string;
    agent_id: string;
    task_id: string;
    session_id: string;
  };
  agentSource: "codex";
}

/** Runner-safe output. Only `provider` may be serialized into model messages. */
export interface CompiledFormalCaseInput {
  caseId: string;
  provider: ProviderVisibleCase;
  sessionInit: FormalSessionInitRequest;
  workspace: WorkspaceRef;
  visibleAssets: ResolvedVisibleSnapshot;
  visibleAssetIds: string[];
  visibleAssetSetSha256: string;
}

/** Runner-private provenance inventory. It is never embedded in provider input. */
export interface CompiledFormalProvenanceSummary {
  synthetic: {
    count: number;
    sourceIds: string[];
    batchIds: string[];
  };
  externalImport: {
    count: number;
    sourceIds: string[];
  };
}

export function compileFormalProvenanceSummary(
  contract: FormalWorldContract,
): CompiledFormalProvenanceSummary {
  assertFormalWorldContract(contract);
  const synthetic = contract.sourceEvidence
    .filter((source) => source.provenanceKind === "synthetic")
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const externalImport = contract.sourceEvidence
    .filter((source) => source.provenanceKind === "external_import")
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    synthetic: {
      count: synthetic.length,
      sourceIds: synthetic.map((source) => source.sourceId),
      batchIds: [...new Set(synthetic.map((source) => source.batchId))]
        .sort((left, right) => left.localeCompare(right)),
    },
    externalImport: {
      count: externalImport.length,
      sourceIds: externalImport.map((source) => source.sourceId),
    },
  };
}

function visibleAssetIds(snapshot: ResolvedVisibleSnapshot): string[] {
  return [...new Set([
    ...snapshot.memories.map((asset) => asset.assetId),
    ...snapshot.skills.map((asset) => asset.assetId),
    ...snapshot.knowledge.map((asset) => asset.assetId),
  ])].sort((left, right) => left.localeCompare(right));
}

export function hashVisibleAssetSet(input: {
  teamId: string;
  userId: string;
  agentId: string;
  assetIds: string[];
}): string {
  return canonicalSha256({
    teamId: input.teamId,
    userId: input.userId,
    agentId: input.agentId,
    assetIds: [...input.assetIds].sort((left, right) => left.localeCompare(right)),
  });
}

function sessionInit(identity: RuntimeIdentity): FormalSessionInitRequest {
  return {
    spaceId: identity.spaceId,
    registration: {
      team_id: identity.teamId,
      user_id: identity.userId,
      agent_id: identity.agentId,
      task_id: identity.taskId,
      session_id: identity.sessionId,
    },
    agentSource: identity.agentSource,
  };
}

/**
 * Resolves production-visible assets from identity and emits a strict provider
 * allowlist. Gold, Pair, source evidence and reviewer fields are deliberately
 * absent from the return type and object.
 */
export function compileFormalCaseInput(
  contract: FormalWorldContract,
  caseId: string,
): CompiledFormalCaseInput {
  assertFormalWorldContract(contract);
  const input = contract.publicCases.find((candidate) => candidate.caseId === caseId);
  if (!input) throw new Error(`Formal compiler: unknown public case ${caseId}`);

  const resolved = resolveVisibleSnapshot(contract, input.identity);
  const assetIds = visibleAssetIds(resolved);
  const snapshot = contract.snapshots.find((candidate) => candidate.snapshotId === input.snapshotId);
  if (!snapshot) throw new Error(`Formal compiler: unknown snapshot ${input.snapshotId} for ${caseId}`);
  const frozenSet = snapshot.visibleAssetSets.find((candidate) =>
    candidate.teamId === input.identity.teamId
    && candidate.userId === input.identity.userId
    && candidate.agentId === input.identity.agentId,
  );
  if (!frozenSet) throw new Error(`Formal compiler: no frozen visible set for ${caseId}`);
  const actualSha256 = hashVisibleAssetSet({
    teamId: input.identity.teamId,
    userId: input.identity.userId,
    agentId: input.identity.agentId,
    assetIds,
  });
  if (JSON.stringify(assetIds) !== JSON.stringify(
    [...frozenSet.assetIds].sort((left, right) => left.localeCompare(right)),
  )) {
    throw new Error(`Formal compiler: resolved visible assets differ from frozen snapshot for ${caseId}`);
  }
  if (frozenSet.sha256 !== actualSha256 || input.visibleAssetSetSha256 !== actualSha256) {
    throw new Error(`Formal compiler: visible asset hash mismatch for ${caseId}`);
  }

  return {
    caseId,
    provider: toProviderVisibleCase(input),
    sessionInit: sessionInit(input.identity),
    workspace: structuredClone(input.workspace),
    visibleAssets: resolved,
    visibleAssetIds: assetIds,
    visibleAssetSetSha256: actualSha256,
  };
}

/** Compile one split without exposing the other split's provider inputs. */
export function compileFormalSplitInputs(
  contract: FormalWorldContract,
  split: FormalSplit,
): CompiledFormalCaseInput[] {
  assertFormalWorldContract(contract);
  const teamIds = new Set(
    contract.teams.filter((team) => team.split === split).map((team) => team.teamId),
  );
  return contract.publicCases
    .filter((item) => teamIds.has(item.identity.teamId))
    .sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map((item) => compileFormalCaseInput(contract, item.caseId));
}
