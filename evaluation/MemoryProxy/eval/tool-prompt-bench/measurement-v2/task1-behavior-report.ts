import { aggregateCaseChainFacts } from "./aggregate.js";
import type { CaseChainScoreV2 } from "./types.js";

export interface BehaviorReportRow {
  caseId: string;
  shouldCall: boolean;
  pairId: string | null;
  behaviorEligible: boolean;
  intentComplete?: boolean;
  score: CaseChainScoreV2 | null;
}

const ratio = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });

/** One variant at a time. Unavailable evidence is excluded explicitly, never counted as success. */
export function buildTask1BehaviorReport(rows: readonly BehaviorReportRow[]) {
  if (new Set(rows.map((r) => r.caseId)).size !== rows.length) throw new Error("Duplicate Case in behavior report");
  for (const row of rows) {
    if (row.score && row.score.caseId !== row.caseId) throw new Error("Score Case identity mismatch");
    if (row.score && (row.shouldCall ? row.score.completeChainSuccess === null || row.score.falseCallAttempt !== null : row.score.falseCallAttempt === null || row.score.completeChainSuccess !== null)) throw new Error("Score expectation differs from authoring label");
  }
  const eligible = rows.filter((r) => r.behaviorEligible && r.score?.traceCompleteness);
  const positives = eligible.filter((r) => r.shouldCall);
  const negatives = eligible.filter((r) => !r.shouldCall);
  const pairNegatives = negatives.filter((r) => r.pairId !== null);
  const negativeMetrics = (items: typeof negatives) => ({
    falseCallRate: ratio(items.filter((r) => r.score!.falseCallAttempt).length, items.length),
    acceptedFalseCallRate: ratio(items.filter((r) => r.score!.falseCallAccepted).length, items.length),
    malformedIntentRate: ratio(items.filter((r) => r.score!.malformedFalseIntent).length, items.length),
    attemptCountMean: ratio(items.reduce((sum, r) => sum + r.score!.observedAttemptCount, 0), items.length),
  });
  const pairs = [...new Set(rows.flatMap((r) => r.pairId === null ? [] : [r.pairId]))].map((pairId) => {
    const members = rows.filter((r) => r.pairId === pairId);
    // A sliced batch may contain only one endpoint of a Pair.  Keep it in the
    // diagnostic list, but make it ineligible instead of aborting all scoring.
    // Pair metrics will exclude it; per-Case metrics remain computable.
    if (members.length !== 2 || members.filter((r) => r.shouldCall).length !== 1) {
      return { pairId, eligible: false, boundaryCorrect: null, exact: null, reason: "incomplete-pair" };
    }
    const positive = members.find((r) => r.shouldCall)!;
    const negative = members.find((r) => !r.shouldCall)!;
    if (!eligible.includes(positive) || !eligible.includes(negative)) return { pairId, eligible: false, boundaryCorrect: null, exact: null };
    return { pairId, eligible: true, boundaryCorrect: positive.score!.triggeredAttempt && !negative.score!.falseCallAttempt, exact: negative.intentComplete === false ? null : positive.score!.completeChainSuccess === true && !negative.score!.falseCallAttempt && !negative.score!.malformedFalseIntent };
  });
  const selected = positives.filter((r) => r.score!.firstActionSelectionCorrect).length;
  return {
    eligibleCaseCount: eligible.length,
    excludedCaseIds: rows.filter((r) => !eligible.includes(r)).map((r) => r.caseId),
    ECR: ratio(positives.filter((r) => r.score!.triggeredAttempt).length, positives.length),
    TSR_all: ratio(selected, positives.length),
    TSR_cond: ratio(selected, positives.filter((r) => r.score!.triggeredAttempt).length),
    allNoCall: negativeMetrics(negatives), pairNoCall: negativeMetrics(pairNegatives),
    pairBoundarySwitch: ratio(pairs.filter((p) => p.boundaryCorrect === true).length, pairs.filter((p) => p.eligible).length),
    pairExact: ratio(pairs.filter((p) => p.exact === true).length, pairs.filter((p) => p.eligible && p.exact !== null).length),
    pairs,
    chainDetails: aggregateCaseChainFacts(eligible.map((r) => r.score!)),
  };
}
