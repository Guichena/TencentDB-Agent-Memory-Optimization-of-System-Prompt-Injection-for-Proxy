import type { PrivateMeasurementSplitData } from "../formal-runtime/private-loader.js";
import {
  assertFormalWorldContract,
  type FormalWorldContract,
  type PublicCaseInput,
} from "../worlds/formal-schema.js";
import selectionContract from "./SELECTION-CONTRACT.json";
import { canonicalSha256 } from "./canonical-json.js";
import type {
  FormalPairRunEvidenceBinding,
  FormalPairScoringInput,
} from "./formal-measurement-integration.js";
import {
  buildFrozenPairSlotManifestV2,
  validatePairContractV2,
  type PairCaseProjectionV2,
  type PairJsonValue,
  type PairSplitV2,
  type ValidatedPairContractV2,
} from "./pair-contract.js";
import {
  computeExpectedPairMembershipSha256V2,
  computePairScoringPolicySha256V2,
  type PairSummaryCampaignV2,
} from "./pair-scorer.js";

export type FormalPairRepeatStageV2 =
  | "dev_discovery"
  | "dev_finalist_confirmation"
  | "hidden";

/**
 * Run-level evidence sealed by Integration. Callers provide no Pair mapping,
 * Pair campaign, slot manifest, or pre-scored Pair JSON.
 */
export interface SealedFormalPairRunEvidenceV2 extends FormalPairRunEvidenceBinding {
  readonly caseId: string;
}

export interface BuildFormalPairEvidenceInputV2 {
  readonly privateMeasurement: PrivateMeasurementSplitData;
  readonly formalWorld: FormalWorldContract;
  readonly repeatStage: FormalPairRepeatStageV2;
  readonly variantId: string;
  readonly apiProtocol: string;
  readonly executionIdentitySha256: string;
  readonly runs: readonly SealedFormalPairRunEvidenceV2[];
}

const FROZEN_FORMAL_WORLD_CANONICAL_SHA256 =
  "eb04b26cfe03810030f6b7d0a06f82dfedf7c8011ce11bb181db8af0b94b58b7";
const SHA256 = /^[a-f0-9]{64}$/u;

function nonBlank(label: string, value: string): string {
  if (value.trim().length === 0) throw new Error(`${label} must be non-blank`);
  return value;
}

function sha256(label: string, value: string): string {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function selectionRepeatIds(stage: FormalPairRepeatStageV2): readonly string[] {
  if (stage === "dev_discovery") return selectionContract.repeatPolicy.devDiscovery.repeatIds;
  if (stage === "dev_finalist_confirmation") {
    return selectionContract.repeatPolicy.devFinalistConfirmation.repeatIds;
  }
  return selectionContract.repeatPolicy.hidden.repeatIds;
}

function expectedPairSplit(split: PrivateMeasurementSplitData["split"]): PairSplitV2 {
  return split === "dev" ? "dev" : "hidden";
}

function projectPairCase(
  formalCase: PublicCaseInput,
  split: PairSplitV2,
): PairCaseProjectionV2 {
  const { sessionId: _sessionId, ...stableIdentity } = formalCase.identity;
  void _sessionId;
  const difficulty = (formalCase as Partial<PublicCaseInput>).difficulty;
  const comparisonDocument = {
    identity: stableIdentity,
    snapshotId: formalCase.snapshotId,
    workspace: formalCase.workspace,
    language: formalCase.language,
    ...(difficulty === undefined ? {} : { difficulty }),
    contextMessages: formalCase.contextMessages,
    query: formalCase.query,
    visibleAssetSetSha256: formalCase.visibleAssetSetSha256,
  } as unknown as PairJsonValue;
  canonicalSha256(comparisonDocument);
  return { caseId: formalCase.caseId, split, comparisonDocument };
}

function validatePrivatePairs(
  input: BuildFormalPairEvidenceInputV2,
  split: PairSplitV2,
): readonly ValidatedPairContractV2[] {
  const casesById = new Map(input.formalWorld.publicCases.map((item) => [item.caseId, item]));
  const registryPairsById = new Map(input.formalWorld.pairs.map((pair) => [pair.pairId, pair]));
  return input.privateMeasurement.pairs.map((contract) => {
    const registryPair = registryPairsById.get(contract.pairId);
    const positive = casesById.get(contract.positiveCaseId);
    const negative = casesById.get(contract.negativeCaseId);
    if (!registryPair || !positive || !negative) {
      throw new Error(`${contract.pairId}: private Pair case is absent from the frozen formal World`);
    }
    if (contract.positiveCaseId !== registryPair.positiveCaseId
      || contract.negativeCaseId !== registryPair.negativeCaseId
      || contract.causalFactorId !== `task1:${registryPair.counterfactualKind}`
      || contract.independenceKey !== `${split}:${positive.identity.teamId}`
      || contract.split !== split) {
      throw new Error(
        `${contract.pairId}: private Pair content does not match frozen formal registry`,
      );
    }
    const validation = validatePairContractV2(
      contract,
      projectPairCase(positive, split),
      projectPairCase(negative, split),
    );
    if (!validation.ok) {
      throw new Error(
        `${contract.pairId}: private Pair projection is invalid: ${validation.errors
          .map((error) => error.code)
          .join(",")}`,
      );
    }
    return validation.value;
  });
}

function validateGoldMembership(
  privateMeasurement: PrivateMeasurementSplitData,
  formalWorld: FormalWorldContract,
): void {
  const splitTeamIds = new Set(formalWorld.teams
    .filter((team) => team.split === privateMeasurement.split)
    .map((team) => team.teamId));
  const expected = formalWorld.publicCases
    .filter((formalCase) => splitTeamIds.has(formalCase.identity.teamId))
    .map((formalCase) => formalCase.caseId)
    .sort();
  const observed = privateMeasurement.gold.map((gold) => gold.caseId).sort();
  const observedSet = new Set(observed);
  const expectedSet = new Set(expected);
  const missing = expected.filter((caseId) => !observedSet.has(caseId));
  const unexpected = observed.filter((caseId) => !expectedSet.has(caseId));
  if (observedSet.size !== observed.length) {
    throw new Error("private Gold membership does not match frozen formal World: duplicate caseId");
  }
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing ${missing[0]}`] : []),
      ...(unexpected.length > 0 ? [`unexpected ${unexpected[0]}`] : []),
    ];
    throw new Error(
      `private Gold membership does not match frozen formal World: ${details.join("; ")}`,
    );
  }
}

function validatePairMembership(
  privateMeasurement: PrivateMeasurementSplitData,
  formalWorld: FormalWorldContract,
): void {
  const goldCaseIds = new Set(privateMeasurement.gold.map((gold) => gold.caseId));
  const expected = formalWorld.pairs
    .filter((pair) => goldCaseIds.has(pair.positiveCaseId))
    .map((pair) => pair.pairId)
    .sort();
  const observed = privateMeasurement.pairs.map((pair) => pair.pairId).sort();
  const observedSet = new Set(observed);
  const expectedSet = new Set(expected);
  const missing = expected.filter((pairId) => !observedSet.has(pairId));
  const unexpected = observed.filter((pairId) => !expectedSet.has(pairId));
  if (observedSet.size !== observed.length) {
    throw new Error("private Pair membership does not match frozen formal registry: duplicate pairId");
  }
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing ${missing[0]}`] : []),
      ...(unexpected.length > 0 ? [`unexpected ${unexpected[0]}`] : []),
    ];
    throw new Error(
      `private Pair membership does not match frozen formal registry: ${details.join("; ")}`,
    );
  }
}

function buildRunEvidenceIndex(
  runs: readonly SealedFormalPairRunEvidenceV2[],
): ReadonlyMap<string, SealedFormalPairRunEvidenceV2> {
  const bySlot = new Map<string, SealedFormalPairRunEvidenceV2>();
  for (const run of runs) {
    const key = `${run.caseId}\u0000${run.repeatId}`;
    if (bySlot.has(key)) {
      throw new Error(`duplicate formal case/repeat slot: ${run.caseId}/${run.repeatId}`);
    }
    bySlot.set(key, run);
  }
  return bySlot;
}

function evidenceBinding(
  run: SealedFormalPairRunEvidenceV2 | undefined,
  caseId: string,
  repeatId: string,
): FormalPairRunEvidenceBinding {
  if (!run) throw new Error(`missing sealed Pair evidence for ${caseId}/${repeatId}`);
  return {
    runId: nonBlank("runId", run.runId),
    repeatId,
    rawEvidenceArtifactRef: nonBlank("rawEvidenceArtifactRef", run.rawEvidenceArtifactRef),
    rawEvidenceArtifactSha256: sha256(
      "rawEvidenceArtifactSha256",
      run.rawEvidenceArtifactSha256,
    ),
    localStateId: nonBlank("localStateId", run.localStateId),
  };
}

export function buildFormalPairEvidenceV2(
  input: BuildFormalPairEvidenceInputV2,
): FormalPairScoringInput {
  assertFormalWorldContract(input.formalWorld);
  if (canonicalSha256(input.formalWorld) !== FROZEN_FORMAL_WORLD_CANONICAL_SHA256) {
    throw new Error("formal World contract does not match the frozen Task 1 registry");
  }
  const split = expectedPairSplit(input.privateMeasurement.split);
  if ((split === "hidden") !== (input.repeatStage === "hidden")) {
    throw new Error("Pair repeat stage does not match the private measurement split");
  }
  nonBlank("variantId", input.variantId);
  nonBlank("apiProtocol", input.apiProtocol);
  sha256("executionIdentitySha256", input.executionIdentitySha256);

  validateGoldMembership(input.privateMeasurement, input.formalWorld);
  validatePairMembership(input.privateMeasurement, input.formalWorld);
  const expectedRepeatIds = [...selectionRepeatIds(input.repeatStage)];
  const validatedPairs = validatePrivatePairs(input, split);
  if (canonicalSha256(input.privateMeasurement.pairs)
    !== input.privateMeasurement.hashes.pairCanonicalSha256) {
    throw new Error("private Pair canonical root does not match its frozen loader hash");
  }
  const runsBySlot = buildRunEvidenceIndex(input.runs);
  const expectedCaseIds = new Set(input.privateMeasurement.gold.map((gold) => gold.caseId));
  const expectedRepeats = new Set(expectedRepeatIds);
  for (const run of input.runs) {
    if (!expectedCaseIds.has(run.caseId) || !expectedRepeats.has(run.repeatId)) {
      throw new Error(`unexpected formal case/repeat slot: ${run.caseId}/${run.repeatId}`);
    }
  }
  for (const gold of input.privateMeasurement.gold) {
    for (const repeatId of expectedRepeatIds) {
      if (!runsBySlot.has(`${gold.caseId}\u0000${repeatId}`)) {
        throw new Error(`missing formal case/repeat slot: ${gold.caseId}/${repeatId}`);
      }
    }
  }
  const runEvidence = [...input.runs]
    .sort((left, right) => (
      left.caseId.localeCompare(right.caseId) || left.repeatId.localeCompare(right.repeatId)
    ))
    .map((run): FormalPairRunEvidenceBinding => ({
      runId: run.runId,
      repeatId: run.repeatId,
      rawEvidenceArtifactRef: run.rawEvidenceArtifactRef,
      rawEvidenceArtifactSha256: run.rawEvidenceArtifactSha256,
      localStateId: run.localStateId,
    }));
  const frozenPairSet = {
    revision: selectionContract.formalData.tag,
    sha256: input.privateMeasurement.hashes.pairCanonicalSha256,
  };
  const frozenPairSlotManifest = buildFrozenPairSlotManifestV2(
    validatedPairs.map((validatedPair) => ({
      validatedPair,
      repeats: expectedRepeatIds.map((repeatId) => ({
        repeatId,
        positive: evidenceBinding(
          runsBySlot.get(`${validatedPair.contract.positiveCaseId}\u0000${repeatId}`),
          validatedPair.contract.positiveCaseId,
          repeatId,
        ),
        negative: evidenceBinding(
          runsBySlot.get(`${validatedPair.contract.negativeCaseId}\u0000${repeatId}`),
          validatedPair.contract.negativeCaseId,
          repeatId,
        ),
      })),
    })),
    frozenPairSet,
  );
  const snapshot = input.formalWorld.snapshots.find((candidate) => (
    candidate.split === input.privateMeasurement.split
  ));
  if (!snapshot) throw new Error(`frozen formal World has no ${input.privateMeasurement.split} snapshot`);
  const strictPairExactEnabled = selectionContract.pairPolicy.strictPairExactEnabled;
  const campaignBase = {
    schemaVersion: "pair-summary-campaign-v2" as const,
    split,
    variantId: input.variantId,
    model: selectionContract.executionCohort.model,
    reasoningEffort: selectionContract.executionCohort.reasoningEffort,
    provider: selectionContract.executionCohort.provider,
    apiProtocol: input.apiProtocol,
    adapterVersion: selectionContract.executionCohort.adapterVersion,
    executionIdentitySha256: input.executionIdentitySha256,
    assetSnapshotSha256: snapshot.contentHash,
    expectedPairIds: validatedPairs.map((pair) => pair.contract.pairId).sort(),
    expectedRepeatIds,
    frozenPairSetRevision: frozenPairSet.revision,
    frozenPairSetSha256: frozenPairSet.sha256,
    frozenPairSlotManifest,
    frozenPairSlotEvidenceRootSha256: frozenPairSlotManifest.canonicalSha256,
    strictPairExactEnabled,
    scoringPolicySha256: computePairScoringPolicySha256V2(strictPairExactEnabled),
  };
  const campaign: PairSummaryCampaignV2 = {
    ...campaignBase,
    expectedPairIdsSha256: computeExpectedPairMembershipSha256V2(campaignBase),
  };
  if (campaign.scoringPolicySha256 !== selectionContract.pairPolicy.scoringPolicySha256) {
    throw new Error("Selection Contract Pair scoring policy hash does not match M1");
  }
  return { campaign, validatedPairs, runEvidence };
}
