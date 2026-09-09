import type {
  CaseChainAggregateV2,
  CaseChainScoreV2,
  MeanV2,
  RatioV2,
} from "./types.js";

function ratio(numerator: number, denominator: number): RatioV2 {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
  };
}

function mean(sum: number, denominator: number): MeanV2 {
  return {
    sum,
    denominator,
    value: denominator === 0 ? null : sum / denominator,
  };
}

export function aggregateCaseChainFacts(
  scores: readonly CaseChainScoreV2[],
): CaseChainAggregateV2 {
  const positives = scores.filter((score) => score.completeChainSuccess !== null);
  const negatives = scores.filter((score) => score.falseCallAttempt !== null);
  const triggeredPositives = positives.filter((score) => score.triggeredAttempt);
  const terminalSuccesses = positives.filter((score) => score.terminalSelectionCorrect === true).length;
  const failureLayerCounts: CaseChainAggregateV2["failureLayerCounts"] = {
    trace: 0,
    trigger: 0,
    selection: 0,
    wrong_family: 0,
    wrong_tool: 0,
    wrong_endpoint: 0,
    wrong_operation: 0,
    wrong_terminal: 0,
    arguments: 0,
    binding: 0,
    infrastructure: 0,
    false_call: 0,
    malformed_intent: 0,
  };
  for (const score of scores) {
    if (score.failureLayer !== null) failureLayerCounts[score.failureLayer] += 1;
  }

  return {
    evaluationSchemaVersion: 2,
    aggregationScope: "provided_trace_facts",
    caseCount: scores.length,
    toolPositiveCount: positives.length,
    noToolCount: negatives.length,
    triggerRecall: ratio(
      positives.filter((score) => score.triggeredAttempt).length,
      positives.length,
    ),
    firstActionSelectionAccuracy: ratio(
      positives.filter((score) => score.firstActionSelectionCorrect === true).length,
      positives.length,
    ),
    terminalSelectionRate: ratio(terminalSuccesses, positives.length),
    completeChainSuccessRate: ratio(
      positives.filter((score) => score.completeChainSuccess === true).length,
      positives.length,
    ),
    runtimeAcceptedChainRate: ratio(
      positives.filter((score) => score.runtimeAcceptedChain === true).length,
      positives.filter((score) => score.runtimeAcceptedChain !== null).length,
    ),
    conditionalTerminalAccuracy: ratio(terminalSuccesses, triggeredPositives.length),
    strictChainExactRate: ratio(
      positives.filter((score) => score.strictChainExact === true).length,
      positives.length,
    ),
    positiveOvercallRate: ratio(
      positives.filter((score) => score.positiveOvercall === true).length,
      positives.length,
    ),
    falseCallAttemptRate: ratio(
      negatives.filter((score) => score.falseCallAttempt === true).length,
      negatives.length,
    ),
    falseCallAcceptedRate: ratio(
      negatives.filter((score) => score.falseCallAccepted === true).length,
      negatives.length,
    ),
    malformedFalseIntentRate: ratio(
      negatives.filter((score) => score.malformedFalseIntent === true).length,
      negatives.length,
    ),
    toolSpl: mean(
      positives.reduce((sum, score) => sum + (score.toolSplContribution ?? 0), 0),
      positives.length,
    ),
    shortestExactRate: ratio(
      positives.filter((score) => score.shortestExact === true).length,
      positives.length,
    ),
    incompleteTraceCount: scores.filter((score) => !score.traceCompleteness).length,
    rawInfrastructureFailureCaseCount: scores.filter((score) => (
      score.rawInfrastructureFailure.length > 0
    )).length,
    failureLayerCounts,
  };
}
