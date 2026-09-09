import { canonicalJsonV2, sha256CanonicalJsonV2 } from "./canonical-json.js";
import {
  computePairContractCanonicalSha256V2,
  validateFrozenPairSlotManifestV2,
  type FrozenPairSlotManifestV2,
  type FrozenPairSlotV2,
  type PairSplitV2,
  type ValidatedPairContractV2,
} from "./pair-contract.js";

/**
 * Integration-owned view: M0 supplies chain facts, while the integration
 * layer adds M2 eligibility and frozen execution identity. M1 only consumes
 * this view and never derives ECR or final eligibility from raw traces.
 */
export interface IntegratedCaseOutcomeForPairV2 {
  readonly caseId: string;
  readonly repeatId: string;
  readonly variantId: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly provider: string;
  readonly apiProtocol: string;
  readonly adapterVersion: string;
  readonly executionIdentitySha256: string;
  readonly assetSnapshotSha256: string;
  readonly rawEvidenceArtifactRef: string;
  readonly rawEvidenceArtifactSha256: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly localStateId: string;
  readonly integrationEligible: boolean;
  readonly traceComplete: boolean;
  readonly completeChainSuccess: boolean;
  readonly strictChainExact?: boolean;
  readonly executorBoundAttempt: boolean;
  readonly malformedTdaiDispatchIntent: boolean;
  readonly failureLayer?: string;
}

export interface PairCaseOutcomeValidationErrorV2 {
  readonly code:
    | "INVALID_OUTCOME_SHAPE"
    | "INVALID_REQUIRED_FIELD"
    | "INVALID_SHA256"
    | "STRICT_CHAIN_INVARIANT_VIOLATION";
  readonly pointer: string;
  readonly message: string;
}

export type PairCaseOutcomeValidationResultV2 =
  | { readonly ok: true; readonly value: IntegratedCaseOutcomeForPairV2 }
  | { readonly ok: false; readonly errors: readonly PairCaseOutcomeValidationErrorV2[] };

export interface PairOutcomeRepeatsV2 {
  readonly positive: readonly IntegratedCaseOutcomeForPairV2[];
  readonly negative: readonly IntegratedCaseOutcomeForPairV2[];
}

export type NegativeFalseIntentTypeV2 = "executor_bound" | "malformed_unbound";

export const PAIR_REPEAT_AGGREGATION_POLICY_ID = "all-repeats-pass-v1" as const;

export interface PairRepeatScoreV2 {
  readonly repeatId: string;
  readonly positiveRunId: string;
  readonly negativeRunId: string;
  readonly positiveSessionId: string;
  readonly negativeSessionId: string;
  readonly positiveLocalStateId: string;
  readonly negativeLocalStateId: string;
  readonly positivePass: boolean;
  readonly negativePass: boolean;
  readonly pairExact: boolean;
  readonly boundarySwitchCorrect: boolean;
  readonly strictPairExact: boolean | null;
  readonly negativeFalseIntentTypes: readonly NegativeFalseIntentTypeV2[];
  readonly positiveFailureLayer: string | null;
}

export interface PairScoreCohortV2 {
  readonly split: PairSplitV2;
  readonly variantId: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly provider: string;
  readonly apiProtocol: string;
  readonly adapterVersion: string;
  readonly executionIdentitySha256: string;
  readonly assetSnapshotSha256: string;
}

export interface PairScoreV2 {
  readonly pairId: string;
  readonly positiveCaseId: string;
  readonly negativeCaseId: string;
  readonly independenceKey: string;
  readonly split: PairSplitV2;
  readonly pairContractSha256: string;
  readonly cohort: PairScoreCohortV2 | null;
  readonly eligibility: "eligible" | "incomplete";
  readonly incompleteReasons: readonly string[];
  readonly repeatAggregationPolicyId: typeof PAIR_REPEAT_AGGREGATION_POLICY_ID;
  readonly repeatCount: number;
  readonly repeatIds: readonly string[];
  readonly scoringPolicySha256: string;
  readonly strictPairExactEnabled: boolean;
  readonly repeatInputs: PairOutcomeRepeatsV2;
  readonly repeatResults: readonly PairRepeatScoreV2[];
  readonly positivePass: boolean | null;
  readonly negativePass: boolean | null;
  readonly pairExact: boolean | null;
  readonly boundarySwitchCorrect: boolean | null;
  readonly strictPairExact: boolean | null;
  readonly negativeFalseIntentTypes: readonly NegativeFalseIntentTypeV2[];
  readonly positiveFailureLayers: readonly string[];
}

export interface ScorePairV2Options {
  readonly includeStrictPairExact?: boolean;
}

interface PairScoreIdentityV2 {
  readonly pairId: string;
  readonly positiveCaseId: string;
  readonly negativeCaseId: string;
  readonly independenceKey: string;
  readonly split: PairSplitV2;
  readonly pairContractSha256: string;
}

export interface PairMetricRatioV2 {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
}

export interface PairIndependenceClusterV2 {
  readonly independenceKey: string;
  readonly pairIds: readonly string[];
}

export interface PairScoreSummaryV2 {
  readonly schemaVersion: "pair-score-summary-v2";
  readonly campaignEligibility: "eligible" | "incomplete";
  readonly campaignIncompleteReasons: readonly string[];
  readonly cohort: PairScoreCohortV2;
  readonly frozenPairSetRevision: string;
  readonly frozenPairSetSha256: string;
  readonly frozenPairSlotEvidenceRootSha256: string;
  readonly expectedPairIdsSha256: string;
  readonly expectedPairIds: readonly string[];
  readonly observedPairIds: readonly string[];
  readonly missingPairIds: readonly string[];
  readonly unexpectedPairIds: readonly string[];
  readonly expectedRepeatIds: readonly string[];
  readonly repeatAggregationPolicyId: typeof PAIR_REPEAT_AGGREGATION_POLICY_ID;
  readonly scoringPolicySha256: string;
  readonly strictPairExactEnabled: boolean;
  readonly jFrozen: number;
  readonly jObserved: number;
  readonly jEligible: number;
  readonly jIncomplete: number;
  readonly pairExact: PairMetricRatioV2;
  readonly boundarySwitchAccuracy: PairMetricRatioV2;
  readonly strictPairExact: PairMetricRatioV2 | null;
  readonly independenceClusterCount: number;
  readonly clusterBootstrapReady: boolean;
  readonly independenceClusters: readonly PairIndependenceClusterV2[];
  readonly incompletePairIds: readonly string[];
  readonly incompleteReasonCounts: Readonly<Record<string, number>>;
}

export interface PairSummaryCampaignV2 extends PairScoreCohortV2 {
  readonly schemaVersion: "pair-summary-campaign-v2";
  readonly expectedPairIds: readonly string[];
  readonly expectedRepeatIds: readonly string[];
  readonly frozenPairSetRevision: string;
  readonly frozenPairSetSha256: string;
  readonly frozenPairSlotManifest: FrozenPairSlotManifestV2;
  readonly frozenPairSlotEvidenceRootSha256: string;
  readonly expectedPairIdsSha256: string;
  readonly strictPairExactEnabled: boolean;
  readonly scoringPolicySha256: string;
}

export interface SummarizePairScoresV2Options {
  readonly campaign: PairSummaryCampaignV2;
  readonly includeStrictPairExact?: boolean;
}

export class PairScoreSummaryBoundaryError extends Error {
  readonly code: "INVALID_SCORES_CONTAINER";

  constructor(message: string) {
    super(message);
    this.name = "PairScoreSummaryBoundaryError";
    this.code = "INVALID_SCORES_CONTAINER";
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function hasMultipleValues(values: readonly string[]): boolean {
  return new Set(values).size > 1;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function computePairScoringPolicySha256V2(strictPairExactEnabled: boolean): string {
  return sha256CanonicalJsonV2({
    schemaVersion: "pair-scoring-policy-v2",
    repeatAggregationPolicyId: PAIR_REPEAT_AGGREGATION_POLICY_ID,
    strictPairExactEnabled,
  });
}

type FrozenPairSetIdentityV2 = Omit<
  PairSummaryCampaignV2,
  "frozenPairSetSha256" | "expectedPairIdsSha256" | "scoringPolicySha256"
>;

export function computeExpectedPairMembershipSha256V2(campaign: FrozenPairSetIdentityV2): string {
  return sha256CanonicalJsonV2({
    schemaVersion: "expected-pair-membership-v2",
    split: campaign.split,
    expectedPairIds: uniqueSorted(campaign.expectedPairIds),
  });
}

export function validatePairCaseOutcomeV2(input: unknown): PairCaseOutcomeValidationResultV2 {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{
        code: "INVALID_OUTCOME_SHAPE",
        pointer: "",
        message: "pair outcome must be an object",
      }],
    };
  }
  const outcome = input as Record<string, unknown>;
  const errors: PairCaseOutcomeValidationErrorV2[] = [];
  const requiredStrings = [
    "caseId",
    "repeatId",
    "variantId",
    "model",
    "reasoningEffort",
    "provider",
    "apiProtocol",
    "adapterVersion",
    "rawEvidenceArtifactRef",
    "runId",
    "sessionId",
    "localStateId",
  ] as const;
  for (const field of requiredStrings) {
    if (!isNonBlankString(outcome[field])) {
      errors.push({
        code: "INVALID_REQUIRED_FIELD",
        pointer: `/${field}`,
        message: `${field} must be a non-blank string`,
      });
    }
  }
  for (const field of [
    "executionIdentitySha256",
    "assetSnapshotSha256",
    "rawEvidenceArtifactSha256",
  ] as const) {
    if (!isSha256(outcome[field])) {
      errors.push({
        code: "INVALID_SHA256",
        pointer: `/${field}`,
        message: `${field} must be a lowercase SHA-256 digest`,
      });
    }
  }
  for (const field of [
    "integrationEligible",
    "traceComplete",
    "completeChainSuccess",
    "executorBoundAttempt",
    "malformedTdaiDispatchIntent",
  ] as const) {
    if (typeof outcome[field] !== "boolean") {
      errors.push({
        code: "INVALID_REQUIRED_FIELD",
        pointer: `/${field}`,
        message: `${field} must be an explicit boolean`,
      });
    }
  }
  if (outcome.strictChainExact !== undefined && typeof outcome.strictChainExact !== "boolean") {
    errors.push({
      code: "INVALID_REQUIRED_FIELD",
      pointer: "/strictChainExact",
      message: "strictChainExact must be boolean when present",
    });
  }
  if (outcome.strictChainExact === true && outcome.completeChainSuccess !== true) {
    errors.push({
      code: "STRICT_CHAIN_INVARIANT_VIOLATION",
      pointer: "/strictChainExact",
      message: "strictChainExact cannot be true unless completeChainSuccess is true",
    });
  }
  if (outcome.failureLayer !== undefined && !isNonBlankString(outcome.failureLayer)) {
    errors.push({
      code: "INVALID_REQUIRED_FIELD",
      pointer: "/failureLayer",
      message: "failureLayer must be a non-blank string when present",
    });
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as IntegratedCaseOutcomeForPairV2 };
}

function cohortFromOutcome(
  split: PairSplitV2,
  outcome: IntegratedCaseOutcomeForPairV2,
): PairScoreCohortV2 {
  return {
    split,
    variantId: outcome.variantId,
    model: outcome.model,
    reasoningEffort: outcome.reasoningEffort,
    provider: outcome.provider,
    apiProtocol: outcome.apiProtocol,
    adapterVersion: outcome.adapterVersion,
    executionIdentitySha256: outcome.executionIdentitySha256,
    assetSnapshotSha256: outcome.assetSnapshotSha256,
  };
}

function sameCohort(left: PairScoreCohortV2, right: PairScoreCohortV2): boolean {
  return canonicalJsonV2(left) === canonicalJsonV2(right);
}

function isPairScoreRuntimeContainer(score: unknown): score is PairScoreV2 {
  if (score === null || typeof score !== "object" || Array.isArray(score)) return false;
  const candidate = score as Record<string, unknown>;
  const repeatInputs = candidate.repeatInputs;
  return isNonBlankString(candidate.pairId)
    && isNonBlankString(candidate.positiveCaseId)
    && isNonBlankString(candidate.negativeCaseId)
    && isNonBlankString(candidate.independenceKey)
    && (candidate.split === "dev" || candidate.split === "hidden")
    && isSha256(candidate.pairContractSha256)
    && typeof candidate.strictPairExactEnabled === "boolean"
    && Array.isArray(candidate.incompleteReasons)
    && Array.isArray(candidate.repeatIds)
    && Array.isArray(candidate.repeatResults)
    && Array.isArray(candidate.negativeFalseIntentTypes)
    && Array.isArray(candidate.positiveFailureLayers)
    && repeatInputs !== null
    && typeof repeatInputs === "object"
    && !Array.isArray(repeatInputs)
    && Array.isArray((repeatInputs as Record<string, unknown>).positive)
    && Array.isArray((repeatInputs as Record<string, unknown>).negative);
}

type PairScoreConsistencyV2 = "consistent" | "identity_binding_mismatch" | "inconsistent";

function pairScoreConsistencyUncheckedV2(
  score: unknown,
  trustedSlot: FrozenPairSlotV2,
): PairScoreConsistencyV2 {
  canonicalJsonV2(score);
  if (!isPairScoreRuntimeContainer(score)) return "inconsistent";
  if (score.pairId !== trustedSlot.pairId
    || score.positiveCaseId !== trustedSlot.positiveCaseId
    || score.negativeCaseId !== trustedSlot.negativeCaseId
    || score.independenceKey !== trustedSlot.independenceKey
    || score.split !== trustedSlot.split
    || score.pairContractSha256 !== trustedSlot.pairContractSha256) {
    return "identity_binding_mismatch";
  }
  const positiveValidations = score.repeatInputs.positive.map(validatePairCaseOutcomeV2);
  const negativeValidations = score.repeatInputs.negative.map(validatePairCaseOutcomeV2);
  if (positiveValidations.some((result) => !result.ok)
    || negativeValidations.some((result) => !result.ok)) {
    return "inconsistent";
  }
  const positiveByRepeat = new Map(positiveValidations
    .filter((result): result is { readonly ok: true; readonly value: IntegratedCaseOutcomeForPairV2 } => result.ok)
    .map((result) => [result.value.repeatId, result.value]));
  const negativeByRepeat = new Map(negativeValidations
    .filter((result): result is { readonly ok: true; readonly value: IntegratedCaseOutcomeForPairV2 } => result.ok)
    .map((result) => [result.value.repeatId, result.value]));
  const trustedByRepeat = new Map(trustedSlot.repeats.map((binding) => [binding.repeatId, binding]));
  const evidenceBindingMismatch = [...positiveByRepeat.values()].some((positive) => {
    const binding = trustedByRepeat.get(positive.repeatId);
    return binding !== undefined && (positive.runId !== binding.positive.runId
      || positive.rawEvidenceArtifactRef !== binding.positive.rawEvidenceArtifactRef
      || positive.rawEvidenceArtifactSha256 !== binding.positive.rawEvidenceArtifactSha256);
  }) || [...negativeByRepeat.values()].some((negative) => {
    const binding = trustedByRepeat.get(negative.repeatId);
    return binding !== undefined && (negative.runId !== binding.negative.runId
      || negative.rawEvidenceArtifactRef !== binding.negative.rawEvidenceArtifactRef
      || negative.rawEvidenceArtifactSha256 !== binding.negative.rawEvidenceArtifactSha256);
  });
  if (evidenceBindingMismatch) {
    return "identity_binding_mismatch";
  }
  const derived = scorePairFromIdentityV2(
    trustedSlot,
    score.repeatInputs,
    { includeStrictPairExact: score.strictPairExactEnabled },
  );
  return canonicalJsonV2(derived) === canonicalJsonV2(score) ? "consistent" : "inconsistent";
}

function pairScoreConsistencyV2(
  score: unknown,
  trustedSlot: FrozenPairSlotV2,
): PairScoreConsistencyV2 {
  try {
    return pairScoreConsistencyUncheckedV2(score, trustedSlot);
  } catch {
    // A malformed persisted row must invalidate only its trusted slot; letting
    // arbitrary deserialization failures abort the campaign would make J_frozen attacker-controlled.
    return "inconsistent";
  }
}

export function scorePairV2(
  validated: ValidatedPairContractV2,
  outcomes: PairOutcomeRepeatsV2,
  options: ScorePairV2Options = {},
): PairScoreV2 {
  return scorePairFromIdentityV2(
    {
      pairId: validated.contract.pairId,
      positiveCaseId: validated.contract.positiveCaseId,
      negativeCaseId: validated.contract.negativeCaseId,
      independenceKey: validated.contract.independenceKey,
      split: validated.contract.split,
      pairContractSha256: computePairContractCanonicalSha256V2(validated.contract),
    },
    outcomes,
    options,
  );
}

function scorePairFromIdentityV2(
  identity: PairScoreIdentityV2,
  outcomes: PairOutcomeRepeatsV2,
  options: ScorePairV2Options = {},
): PairScoreV2 {
  const positiveInputs = Array.isArray(outcomes?.positive) ? outcomes.positive : [];
  const negativeInputs = Array.isArray(outcomes?.negative) ? outcomes.negative : [];
  const positiveValidations = positiveInputs.map(validatePairCaseOutcomeV2);
  const negativeValidations = negativeInputs.map(validatePairCaseOutcomeV2);
  const positiveOutcomes = positiveValidations
    .filter((result): result is { readonly ok: true; readonly value: IntegratedCaseOutcomeForPairV2 } => result.ok)
    .map((result) => result.value);
  const negativeOutcomes = negativeValidations
    .filter((result): result is { readonly ok: true; readonly value: IntegratedCaseOutcomeForPairV2 } => result.ok)
    .map((result) => result.value);
  const allOutcomes = [...positiveOutcomes, ...negativeOutcomes];
  const repeatInputs: PairOutcomeRepeatsV2 = {
    positive: [...positiveInputs],
    negative: [...negativeInputs],
  };
  const positiveRepeatIds = positiveOutcomes.map((outcome) => outcome.repeatId);
  const negativeRepeatIds = negativeOutcomes.map((outcome) => outcome.repeatId);
  const repeatSetsMatch = JSON.stringify([...new Set(positiveRepeatIds)].sort())
    === JSON.stringify([...new Set(negativeRepeatIds)].sort());
  const strictPairExactEnabled = options.includeStrictPairExact === true;
  const scoringPolicySha256 = computePairScoringPolicySha256V2(strictPairExactEnabled);
  const shapeInvalid = positiveValidations.some((result) => !result.ok)
    || negativeValidations.some((result) => !result.ok);
  const incompleteReasons = uniqueSorted([
    ...(positiveValidations.some((result) => !result.ok)
      ? ["POSITIVE_OUTCOME_INVALID"]
      : []),
    ...(negativeValidations.some((result) => !result.ok)
      ? ["NEGATIVE_OUTCOME_INVALID"]
      : []),
    ...(positiveOutcomes.some((outcome) => !outcome.integrationEligible)
      ? ["POSITIVE_NOT_INTEGRATION_ELIGIBLE"]
      : []),
    ...(negativeOutcomes.some((outcome) => !outcome.integrationEligible)
      ? ["NEGATIVE_NOT_INTEGRATION_ELIGIBLE"]
      : []),
    ...(positiveOutcomes.some((outcome) => !outcome.traceComplete)
      ? ["POSITIVE_TRACE_INCOMPLETE"]
      : []),
    ...(negativeOutcomes.some((outcome) => !outcome.traceComplete)
      ? ["NEGATIVE_TRACE_INCOMPLETE"]
      : []),
    ...(hasDuplicate(allOutcomes.map((outcome) => outcome.runId))
      ? ["RUN_NOT_ISOLATED"]
      : []),
    ...(hasDuplicate(allOutcomes.map((outcome) => outcome.sessionId))
      ? ["SESSION_NOT_ISOLATED"]
      : []),
    ...(hasDuplicate(allOutcomes.map((outcome) => outcome.localStateId))
      ? ["LOCAL_STATE_NOT_ISOLATED"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.variantId))
      ? ["VARIANT_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.model))
      ? ["MODEL_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.reasoningEffort))
      ? ["REASONING_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.provider))
      ? ["PROVIDER_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.apiProtocol))
      ? ["API_PROTOCOL_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.adapterVersion))
      ? ["ADAPTER_VERSION_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.executionIdentitySha256))
      ? ["EXECUTION_IDENTITY_MISMATCH"]
      : []),
    ...(hasMultipleValues(allOutcomes.map((outcome) => outcome.assetSnapshotSha256))
      ? ["ASSET_SNAPSHOT_MISMATCH"]
      : []),
    ...(positiveRepeatIds.length === 0 || negativeRepeatIds.length === 0
      ? ["REPEAT_SET_EMPTY"]
      : []),
    ...(hasDuplicate(positiveRepeatIds) || hasDuplicate(negativeRepeatIds)
      ? ["REPEAT_ID_DUPLICATE"]
      : []),
    ...(!repeatSetsMatch ? ["REPEAT_SET_MISMATCH"] : []),
    ...(positiveOutcomes.some((outcome) => outcome.caseId !== identity.positiveCaseId)
      || negativeOutcomes.some((outcome) => outcome.caseId !== identity.negativeCaseId)
      ? ["OUTCOME_CASE_ID_MISMATCH"]
      : []),
    ...(options.includeStrictPairExact === true
      && positiveOutcomes.some((outcome) => typeof outcome.strictChainExact !== "boolean")
      ? ["STRICT_OUTCOME_MISSING"]
      : []),
  ]);
  const cohort = !shapeInvalid && allOutcomes.length > 0 && !incompleteReasons.some((reason) => [
    "VARIANT_MISMATCH",
    "MODEL_MISMATCH",
    "REASONING_MISMATCH",
    "PROVIDER_MISMATCH",
    "API_PROTOCOL_MISMATCH",
    "ADAPTER_VERSION_MISMATCH",
    "EXECUTION_IDENTITY_MISMATCH",
    "ASSET_SNAPSHOT_MISMATCH",
  ].includes(reason))
    ? cohortFromOutcome(identity.split, allOutcomes[0])
    : null;
  const repeatIds = uniqueSorted([...positiveRepeatIds, ...negativeRepeatIds]);
  if (incompleteReasons.length > 0) {
    return {
      pairId: identity.pairId,
      positiveCaseId: identity.positiveCaseId,
      negativeCaseId: identity.negativeCaseId,
      independenceKey: identity.independenceKey,
      split: identity.split,
      pairContractSha256: identity.pairContractSha256,
      cohort,
      eligibility: "incomplete",
      incompleteReasons,
      repeatAggregationPolicyId: PAIR_REPEAT_AGGREGATION_POLICY_ID,
      repeatCount: Math.max(positiveInputs.length, negativeInputs.length),
      repeatIds,
      scoringPolicySha256,
      strictPairExactEnabled,
      repeatInputs,
      repeatResults: [],
      positivePass: null,
      negativePass: null,
      pairExact: null,
      boundarySwitchCorrect: null,
      strictPairExact: null,
      negativeFalseIntentTypes: [],
      positiveFailureLayers: [],
    };
  }
  const positiveByRepeat = new Map(positiveOutcomes.map((outcome) => [outcome.repeatId, outcome]));
  const negativeByRepeat = new Map(negativeOutcomes.map((outcome) => [outcome.repeatId, outcome]));
  const repeatResults = [...positiveByRepeat.keys()].sort().map((repeatId): PairRepeatScoreV2 => {
    const positive = positiveByRepeat.get(repeatId) as IntegratedCaseOutcomeForPairV2;
    const negative = negativeByRepeat.get(repeatId) as IntegratedCaseOutcomeForPairV2;
    const negativeFalseIntentTypes = uniqueSorted([
      ...(negative.executorBoundAttempt ? ["executor_bound" as const] : []),
      ...(!negative.executorBoundAttempt && negative.malformedTdaiDispatchIntent
        ? ["malformed_unbound" as const]
        : []),
    ]) as NegativeFalseIntentTypeV2[];
    const positivePass = positive.completeChainSuccess;
    const negativePass = !negative.executorBoundAttempt && !negative.malformedTdaiDispatchIntent;
    const boundarySwitchCorrect = positive.executorBoundAttempt && !negative.executorBoundAttempt;
    return {
      repeatId,
      positiveRunId: positive.runId,
      negativeRunId: negative.runId,
      positiveSessionId: positive.sessionId,
      negativeSessionId: negative.sessionId,
      positiveLocalStateId: positive.localStateId,
      negativeLocalStateId: negative.localStateId,
      positivePass,
      negativePass,
      pairExact: positivePass && negativePass,
      boundarySwitchCorrect,
      strictPairExact: options.includeStrictPairExact === true
        ? positivePass && positive.strictChainExact === true && negativePass
        : null,
      negativeFalseIntentTypes,
      positiveFailureLayer: positivePass ? null : positive.failureLayer ?? null,
    };
  });
  const positivePass = repeatResults.every((repeat) => repeat.positivePass);
  const negativePass = repeatResults.every((repeat) => repeat.negativePass);
  const boundarySwitchCorrect = repeatResults.every((repeat) => repeat.boundarySwitchCorrect);
  const strictPairExact = options.includeStrictPairExact === true
    ? repeatResults.every((repeat) => repeat.strictPairExact === true)
    : null;
  const negativeFalseIntentTypes = uniqueSorted(
    repeatResults.flatMap((repeat) => repeat.negativeFalseIntentTypes),
  ) as NegativeFalseIntentTypeV2[];
  const positiveFailureLayers = uniqueSorted(repeatResults
    .map((repeat) => repeat.positiveFailureLayer)
    .filter((layer): layer is string => layer !== null));

  return {
    pairId: identity.pairId,
    positiveCaseId: identity.positiveCaseId,
    negativeCaseId: identity.negativeCaseId,
    independenceKey: identity.independenceKey,
    split: identity.split,
    pairContractSha256: identity.pairContractSha256,
    cohort,
    eligibility: "eligible",
    incompleteReasons: [],
    repeatAggregationPolicyId: PAIR_REPEAT_AGGREGATION_POLICY_ID,
    repeatCount: repeatResults.length,
    repeatIds,
    scoringPolicySha256,
    strictPairExactEnabled,
    repeatInputs,
    repeatResults,
    positivePass,
    negativePass,
    pairExact: positivePass && negativePass,
    boundarySwitchCorrect,
    strictPairExact,
    negativeFalseIntentTypes,
    positiveFailureLayers,
  };
}

function ratio(values: readonly boolean[]): PairMetricRatioV2 {
  const numerator = values.filter(Boolean).length;
  const denominator = values.length;
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
  };
}

/**
 * Aggregates already pair-level scores. Repeat rows remain nested in each
 * PairScoreV2 and therefore cannot inflate J_frozen, J_eligible, or clusters.
 * Clusters are emitted as indivisible inputs for later matched resampling.
 */
export function summarizePairScoresV2(
  scores: readonly PairScoreV2[],
  options: SummarizePairScoresV2Options,
): PairScoreSummaryV2 {
  if (!Array.isArray(scores)) {
    throw new PairScoreSummaryBoundaryError("PairScoreSummaryV2 scores must be an array");
  }
  const scoreInputs: readonly unknown[] = scores;
  const campaign = options?.campaign;
  if (campaign === null || typeof campaign !== "object") {
    throw new Error("PairScoreSummaryV2 requires a frozen pair-summary campaign contract");
  }
  if (campaign.schemaVersion !== "pair-summary-campaign-v2") {
    throw new Error("unsupported pair-summary campaign schema version");
  }
  if (campaign.split !== "dev" && campaign.split !== "hidden") {
    throw new Error("pair-summary campaign split must be dev or hidden");
  }
  for (const [field, value] of [
    ["variantId", campaign.variantId],
    ["model", campaign.model],
    ["reasoningEffort", campaign.reasoningEffort],
    ["provider", campaign.provider],
    ["apiProtocol", campaign.apiProtocol],
    ["adapterVersion", campaign.adapterVersion],
    ["frozenPairSetRevision", campaign.frozenPairSetRevision],
  ] as const) {
    if (!isNonBlankString(value)) {
      throw new Error(`pair-summary campaign ${field} must be non-blank`);
    }
  }
  for (const [field, value] of [
    ["executionIdentitySha256", campaign.executionIdentitySha256],
    ["assetSnapshotSha256", campaign.assetSnapshotSha256],
    ["frozenPairSetSha256", campaign.frozenPairSetSha256],
    ["frozenPairSlotEvidenceRootSha256", campaign.frozenPairSlotEvidenceRootSha256],
    ["expectedPairIdsSha256", campaign.expectedPairIdsSha256],
    ["scoringPolicySha256", campaign.scoringPolicySha256],
  ] as const) {
    if (!isSha256(value)) throw new Error(`pair-summary campaign ${field} must be SHA-256`);
  }
  if (!Array.isArray(campaign.expectedPairIds)
    || campaign.expectedPairIds.length === 0
    || campaign.expectedPairIds.some((id) => !isNonBlankString(id))
    || hasDuplicate(campaign.expectedPairIds)) {
    throw new Error("pair-summary campaign expectedPairIds must be a non-empty unique string set");
  }
  if (!Array.isArray(campaign.expectedRepeatIds)
    || campaign.expectedRepeatIds.length === 0
    || campaign.expectedRepeatIds.some((id) => !isNonBlankString(id))
    || hasDuplicate(campaign.expectedRepeatIds)) {
    throw new Error("pair-summary campaign expectedRepeatIds must be a non-empty unique string set");
  }
  const slotManifestValidation = validateFrozenPairSlotManifestV2(
    campaign.frozenPairSlotManifest,
  );
  if (!slotManifestValidation.ok) {
    throw new Error(`invalid frozen pair slot manifest: ${slotManifestValidation.errors
      .map((error) => error.code)
      .join(",")}`);
  }
  const frozenPairSlotManifest = slotManifestValidation.value;
  if (campaign.frozenPairSlotEvidenceRootSha256 !== frozenPairSlotManifest.canonicalSha256) {
    throw new Error("frozen pair slot evidence root does not match the trusted campaign root");
  }
  if (frozenPairSlotManifest.frozenPairSetRevision !== campaign.frozenPairSetRevision
    || frozenPairSlotManifest.frozenPairSetSha256 !== campaign.frozenPairSetSha256
    || frozenPairSlotManifest.split !== campaign.split) {
    throw new Error("frozen pair slot manifest does not match the trusted frozen-set root");
  }
  const trustedSlots = [...frozenPairSlotManifest.slots];
  const trustedSlotPairIds = uniqueSorted(trustedSlots.map((slot) => slot.pairId));
  if (canonicalJsonV2(trustedSlotPairIds) !== canonicalJsonV2(uniqueSorted(campaign.expectedPairIds))) {
    throw new Error("frozen pair slots do not match expectedPairIds");
  }
  if (canonicalJsonV2(uniqueSorted(frozenPairSlotManifest.expectedRepeatIds))
    !== canonicalJsonV2(uniqueSorted(campaign.expectedRepeatIds))) {
    throw new Error("frozen pair slots do not match expectedRepeatIds");
  }
  const expectedScoringPolicySha256 = computePairScoringPolicySha256V2(
    campaign.strictPairExactEnabled,
  );
  if (campaign.scoringPolicySha256 !== expectedScoringPolicySha256) {
    throw new Error("pair-summary campaign scoring policy hash does not match its policy");
  }
  const expectedPairIdsSha256 = computeExpectedPairMembershipSha256V2(campaign);
  if (campaign.expectedPairIdsSha256 !== expectedPairIdsSha256) {
    throw new Error("pair-summary campaign membership hash does not match expectedPairIds");
  }
  if ((options.includeStrictPairExact === true) !== campaign.strictPairExactEnabled) {
    throw new Error("PairScoreSummaryV2 StrictPairExact option does not match frozen campaign policy");
  }

  interface ScoreInputRow {
    readonly input: unknown;
    readonly pairId: string | null;
  }
  const scoreRows: readonly ScoreInputRow[] = scoreInputs.map((input): ScoreInputRow => {
    try {
      canonicalJsonV2(input);
    } catch {
      return { input, pairId: null };
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return { input, pairId: null };
    }
    const pairId = (input as Record<string, unknown>).pairId;
    return { input, pairId: isNonBlankString(pairId) ? pairId : null };
  });
  const malformedScoreRowCount = scoreRows.filter((row) => row.pairId === null).length;
  const identifiedScoreRows = scoreRows.filter(
    (row): row is ScoreInputRow & { readonly pairId: string } => row.pairId !== null,
  );
  const pairIds = identifiedScoreRows.map((row) => row.pairId);
  if (hasDuplicate(pairIds)) {
    throw new Error("duplicate pairId in PairScoreSummaryV2 input");
  }
  const expectedPairIds = uniqueSorted(campaign.expectedPairIds);
  const expectedPairSet = new Set(expectedPairIds);
  const observedPairIds = uniqueSorted(pairIds);
  const unexpectedPairIds = observedPairIds.filter((pairId) => !expectedPairSet.has(pairId));
  const expectedRepeatIds = uniqueSorted(campaign.expectedRepeatIds);
  const campaignCohort: PairScoreCohortV2 = {
    split: campaign.split,
    variantId: campaign.variantId,
    model: campaign.model,
    reasoningEffort: campaign.reasoningEffort,
    provider: campaign.provider,
    apiProtocol: campaign.apiProtocol,
    adapterVersion: campaign.adapterVersion,
    executionIdentitySha256: campaign.executionIdentitySha256,
    assetSnapshotSha256: campaign.assetSnapshotSha256,
  };
  const boundScoreRows = trustedSlots.map((slot, index) => ({
    slot,
    row: scoreRows[index] ?? { input: undefined, pairId: null },
  }));
  const missingPairIds = boundScoreRows
    .filter(({ row }) => row.pairId === null)
    .map(({ slot }) => slot.pairId);
  const expectedScoreRows = boundScoreRows.filter(
    (bound): bound is typeof bound & { readonly row: ScoreInputRow & { readonly pairId: string } } => (
      bound.row.pairId !== null
    ),
  );
  const scoreConsistency = expectedScoreRows.map(({ row, slot }) => ({
    row,
    slot,
    consistency: pairScoreConsistencyV2(row.input, slot),
  }));
  const identityBindingMismatchIds = scoreConsistency
    .filter(({ consistency }) => consistency === "identity_binding_mismatch")
    .map(({ slot }) => slot.pairId);
  const inconsistentScoreIds = scoreConsistency
    .filter(({ consistency }) => consistency === "inconsistent")
    .map(({ slot }) => slot.pairId);
  const consistentExpectedScores = scoreConsistency
    .filter(({ consistency }) => consistency === "consistent")
    .map(({ row }) => row.input as PairScoreV2);
  const cohortMismatchIds = consistentExpectedScores
    .filter((score) => score.cohort === null || !sameCohort(score.cohort, campaignCohort))
    .map((score) => score.pairId);
  const repeatMismatchIds = consistentExpectedScores
    .filter((score) => canonicalJsonV2(uniqueSorted(score.repeatIds)) !== canonicalJsonV2(expectedRepeatIds))
    .map((score) => score.pairId);
  const policyMismatchIds = consistentExpectedScores
    .filter((score) => score.scoringPolicySha256 !== campaign.scoringPolicySha256
      || score.strictPairExactEnabled !== campaign.strictPairExactEnabled)
    .map((score) => score.pairId);
  const canonicalIncompleteScoreIds = consistentExpectedScores
    .filter((score) => score.eligibility === "incomplete")
    .map((score) => score.pairId);
  const campaignIncompleteReasons = uniqueSorted([
    ...(missingPairIds.length > 0 ? ["FROZEN_PAIR_SET_INCOMPLETE"] : []),
    ...(malformedScoreRowCount > 0 ? ["MALFORMED_PAIR_SCORE_ROW"] : []),
    ...(unexpectedPairIds.length > 0 ? ["UNEXPECTED_PAIR_SET_MEMBER"] : []),
    ...(cohortMismatchIds.length > 0 ? ["SCORE_COHORT_MISMATCH"] : []),
    ...(repeatMismatchIds.length > 0 ? ["EXPECTED_REPEAT_SET_MISMATCH"] : []),
    ...(policyMismatchIds.length > 0 ? ["SCORING_POLICY_MISMATCH"] : []),
    ...(canonicalIncompleteScoreIds.length > 0 ? ["FROZEN_PAIR_EVIDENCE_INCOMPLETE"] : []),
    ...(identityBindingMismatchIds.length > 0 ? ["PAIR_SCORE_IDENTITY_BINDING_MISMATCH"] : []),
    ...(inconsistentScoreIds.length > 0 ? ["PAIR_SCORE_INCONSISTENT"] : []),
  ]);
  const structurallyEligibleIds = new Set(consistentExpectedScores
    .filter((score) => !cohortMismatchIds.includes(score.pairId))
    .filter((score) => !repeatMismatchIds.includes(score.pairId))
    .filter((score) => !policyMismatchIds.includes(score.pairId))
    .filter((score) => !inconsistentScoreIds.includes(score.pairId))
    .map((score) => score.pairId));
  const eligible = consistentExpectedScores.filter((score) => score.eligibility === "eligible"
    && structurallyEligibleIds.has(score.pairId));
  for (const score of eligible) {
    if (score.pairExact === null || score.boundarySwitchCorrect === null) {
      throw new Error(`eligible pair ${score.pairId} is missing required pair metrics`);
    }
    if (options.includeStrictPairExact === true && score.strictPairExact === null) {
      throw new Error(`eligible pair ${score.pairId} is missing preregistered StrictPairExact`);
    }
  }

  const clusterMap = new Map<string, string[]>();
  for (const score of eligible) {
    const pairIdsInCluster = clusterMap.get(score.independenceKey) ?? [];
    pairIdsInCluster.push(score.pairId);
    clusterMap.set(score.independenceKey, pairIdsInCluster);
  }
  const independenceClusters = [...clusterMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([independenceKey, ids]): PairIndependenceClusterV2 => ({
      independenceKey,
      pairIds: [...ids].sort(),
    }));

  const incompleteReasonCounts: Record<string, number> = {};
  const incrementReason = (reason: string, amount = 1): void => {
    incompleteReasonCounts[reason] = (incompleteReasonCounts[reason] ?? 0) + amount;
  };
  for (const score of consistentExpectedScores
    .filter((candidate) => candidate.eligibility === "incomplete")) {
    for (const reason of score.incompleteReasons) incrementReason(reason);
  }
  if (missingPairIds.length > 0) incrementReason("MISSING_FROZEN_PAIR", missingPairIds.length);
  if (malformedScoreRowCount > 0) incrementReason("MALFORMED_PAIR_SCORE_ROW", malformedScoreRowCount);
  if (unexpectedPairIds.length > 0) incrementReason("UNEXPECTED_PAIR", unexpectedPairIds.length);
  if (cohortMismatchIds.length > 0) incrementReason("SCORE_COHORT_MISMATCH", cohortMismatchIds.length);
  if (repeatMismatchIds.length > 0) {
    incrementReason("EXPECTED_REPEAT_SET_MISMATCH", repeatMismatchIds.length);
  }
  if (policyMismatchIds.length > 0) incrementReason("SCORING_POLICY_MISMATCH", policyMismatchIds.length);
  if (identityBindingMismatchIds.length > 0) {
    incrementReason("PAIR_SCORE_IDENTITY_BINDING_MISMATCH", identityBindingMismatchIds.length);
  }
  if (inconsistentScoreIds.length > 0) {
    incrementReason("PAIR_SCORE_INCONSISTENT", inconsistentScoreIds.length);
  }
  const eligiblePairIds = new Set(eligible.map((score) => score.pairId));
  const incompletePairIds = expectedPairIds.filter((pairId) => !eligiblePairIds.has(pairId));

  return {
    schemaVersion: "pair-score-summary-v2",
    campaignEligibility: campaignIncompleteReasons.length === 0 ? "eligible" : "incomplete",
    campaignIncompleteReasons,
    cohort: campaignCohort,
    frozenPairSetRevision: campaign.frozenPairSetRevision,
    frozenPairSetSha256: campaign.frozenPairSetSha256,
    frozenPairSlotEvidenceRootSha256: frozenPairSlotManifest.canonicalSha256,
    expectedPairIdsSha256: campaign.expectedPairIdsSha256,
    expectedPairIds,
    observedPairIds,
    missingPairIds,
    unexpectedPairIds,
    expectedRepeatIds,
    repeatAggregationPolicyId: PAIR_REPEAT_AGGREGATION_POLICY_ID,
    scoringPolicySha256: campaign.scoringPolicySha256,
    strictPairExactEnabled: campaign.strictPairExactEnabled,
    jFrozen: trustedSlots.length,
    jObserved: expectedScoreRows.length,
    jEligible: eligible.length,
    jIncomplete: trustedSlots.length - eligible.length,
    pairExact: ratio(eligible.map((score) => score.pairExact as boolean)),
    boundarySwitchAccuracy: ratio(
      eligible.map((score) => score.boundarySwitchCorrect as boolean),
    ),
    strictPairExact: options.includeStrictPairExact === true
      ? ratio(eligible.map((score) => score.strictPairExact as boolean))
      : null,
    independenceClusterCount: independenceClusters.length,
    clusterBootstrapReady: independenceClusters.length >= 2,
    independenceClusters,
    incompletePairIds,
    incompleteReasonCounts,
  };
}
