import { describe, expect, it } from "vitest";
import { aggregateCaseChainFacts } from "../aggregate.js";
import { scoreCaseChain } from "../scorer.js";
import {
  MEMORY_SEARCH_GOLD,
  MEMORY_SEARCH_SUCCESS_TRACE,
  NO_TOOL_GOLD,
  SYNTHETIC_RUNTIME_CONTRACTS,
} from "../synthetic-fixtures.js";

describe("Measurement v2 trace-fact aggregation", () => {
  it("reports CTA as 0/0/NA while fixed-denominator positive metrics remain defined", () => {
    const untriggered = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: MEMORY_SEARCH_GOLD.caseId,
        runId: "run-aggregate-untriggered",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    const aggregate = aggregateCaseChainFacts([untriggered]);

    expect(aggregate).toMatchObject({
      evaluationSchemaVersion: 2,
      aggregationScope: "provided_trace_facts",
      toolPositiveCount: 1,
      triggerRecall: { numerator: 0, denominator: 1, value: 0 },
      terminalSelectionRate: { numerator: 0, denominator: 1, value: 0 },
      completeChainSuccessRate: { numerator: 0, denominator: 1, value: 0 },
      runtimeAcceptedChainRate: { numerator: 0, denominator: 0, value: null },
      conditionalTerminalAccuracy: { numerator: 0, denominator: 0, value: null },
    });
    expect(aggregate).not.toHaveProperty("formalMetricEligible");
  });

  it("aggregates ToolSPL failures as zero and keeps no-tool attempt, acceptance, and malformed rates separate", () => {
    const successfulPositive = scoreCaseChain({
      observation: MEMORY_SEARCH_SUCCESS_TRACE,
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });
    const failedPositive = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-aggregate-failed-positive",
        attempts: [],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });
    const acceptedNegative = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        caseId: NO_TOOL_GOLD.caseId,
        runId: "run-aggregate-accepted-negative",
      },
      gold: NO_TOOL_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });
    const malformedNegative = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: NO_TOOL_GOLD.caseId,
        runId: "run-aggregate-malformed-negative",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "malformed-negative-intent",
          executorBound: false,
          recognizableTdaiIntent: true,
          malformedReason: "invalid dispatch",
        }],
      },
      gold: NO_TOOL_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    const aggregate = aggregateCaseChainFacts([
      successfulPositive,
      failedPositive,
      acceptedNegative,
      malformedNegative,
    ]);

    expect(aggregate).toMatchObject({
      firstActionSelectionAccuracy: { numerator: 1, denominator: 2, value: 0.5 },
      strictChainExactRate: { numerator: 1, denominator: 2, value: 0.5 },
      positiveOvercallRate: { numerator: 0, denominator: 2, value: 0 },
      falseCallAttemptRate: { numerator: 1, denominator: 2, value: 0.5 },
      falseCallAcceptedRate: { numerator: 1, denominator: 2, value: 0.5 },
      malformedFalseIntentRate: { numerator: 1, denominator: 2, value: 0.5 },
      toolSpl: { sum: 1, denominator: 2, value: 0.5 },
      shortestExactRate: { numerator: 1, denominator: 2, value: 0.5 },
      runtimeAcceptedChainRate: { numerator: 1, denominator: 1, value: 1 },
    });
  });

  it("counts incomplete traces, raw infrastructure facts, and failure layers without filtering eligibility", () => {
    const traceFailure = { kind: "trace_missing", message: "trace ended before turn completion" } as const;
    const incomplete = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: MEMORY_SEARCH_GOLD.caseId,
        runId: "run-aggregate-incomplete",
        variantId: "synthetic",
        rawTraceStatus: "partial",
        attempts: [],
        infrastructureFailures: [traceFailure],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });
    const triggerFailure = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: MEMORY_SEARCH_GOLD.caseId,
        runId: "run-aggregate-trigger-failure",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    const aggregate = aggregateCaseChainFacts([incomplete, triggerFailure]);

    expect(aggregate).toMatchObject({
      caseCount: 2,
      incompleteTraceCount: 1,
      rawInfrastructureFailureCaseCount: 1,
      failureLayerCounts: {
        trace: 1,
        trigger: 1,
      },
    });
    expect(aggregate.toolPositiveCount).toBe(2);
  });
});
