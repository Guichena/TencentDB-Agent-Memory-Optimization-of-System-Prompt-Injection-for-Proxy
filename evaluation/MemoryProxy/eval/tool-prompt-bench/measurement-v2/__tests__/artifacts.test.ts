import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as publicApi from "../m0-index.js";
import {
  MEMORY_SEARCH_GOLD,
  MEMORY_SEARCH_SUCCESS_TRACE,
  SYNTHETIC_RUNTIME_CONTRACTS,
} from "../synthetic-fixtures.js";

const FROZEN_FIXTURE_BYTES = 15720;
const FROZEN_FIXTURE_SHA256 = "aab4f994b9fb8aaacbd840977fc651823223aace44c0f3de7a1a219fe2b2bd53";
const SCORE_OUTPUT_FIELDS = [
  "evaluationSchemaVersion",
  "caseId",
  "runId",
  "variantId",
  "rawTraceStatus",
  "traceCompleteness",
  "rawInfrastructureFailure",
  "triggeredAttempt",
  "firstActionSelectionCorrect",
  "terminalSelectionCorrect",
  "completeChainSuccess",
  "runtimeAcceptedChain",
  "strictChainExact",
  "falseCallAttempt",
  "falseCallAccepted",
  "malformedFalseIntent",
  "positiveOvercall",
  "matchedSequenceId",
  "shortestAllowedLength",
  "matchedSequenceLength",
  "observedAttemptCount",
  "evaluationPrefixAttemptCount",
  "behaviorValidTerminalAttemptIndex",
  "terminalAttemptIndex",
  "toolSplContribution",
  "shortestExact",
  "failureLayer",
] as const;
const AGGREGATE_OUTPUT_FIELDS = [
  "evaluationSchemaVersion",
  "aggregationScope",
  "caseCount",
  "toolPositiveCount",
  "noToolCount",
  "triggerRecall",
  "firstActionSelectionAccuracy",
  "terminalSelectionRate",
  "completeChainSuccessRate",
  "runtimeAcceptedChainRate",
  "conditionalTerminalAccuracy",
  "strictChainExactRate",
  "positiveOvercallRate",
  "falseCallAttemptRate",
  "falseCallAcceptedRate",
  "malformedFalseIntentRate",
  "toolSpl",
  "shortestExactRate",
  "incompleteTraceCount",
  "rawInfrastructureFailureCaseCount",
  "failureLayerCounts",
] as const;
const PREREQUISITE_REPAIR_INVARIANT =
  "The evaluation prefix stops at the earliest Gold terminal whose own arguments, binding, and exact referenced RuntimeToolContract identity are valid; a corrected prerequisite before that horizon may complete the chain, while a retry after the horizon cannot repair it.";
const FORMAL_DATA_BLOCKERS = [
  "The exact task1-data-formal-v1.1 freeze is available, but M0 alone cannot make a run formalMetricEligible; R04 Integration must combine scorer facts with runtime, usage, isolation, and infrastructure evidence.",
] as const;

interface PublicSignature {
  function: string;
  inputContracts: string[];
  outputContract: string;
  outputFields: string[];
}

interface InterfaceManifest {
  candidateId: string;
  evaluationSchemaVersion: number;
  publicEntrypoint: string;
  publicFunctions: string[];
  publicSignatures: PublicSignature[];
  inputPreconditions: string[];
  semanticInvariants: string[];
  ownsFormalMetricEligible: boolean;
  formalDataStatus: string;
  formalDataBlockers: string[];
  syntheticFixture: {
    path: string;
    bytes: number;
    sha256: string;
  };
  modelRuns: number;
}

describe("Measurement v2 M0 frozen artifacts", () => {
  it("pins both public signatures and the canonical fixture without claiming formal readiness", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const manifest = JSON.parse(
      readFileSync(new URL("../interface-manifest.json", import.meta.url), "utf8"),
    ) as InterfaceManifest;
    const fixture = readFileSync(new URL(`../${manifest.syntheticFixture.path}`, import.meta.url));
    const score = publicApi.scoreCaseChain({
      observation: MEMORY_SEARCH_SUCCESS_TRACE,
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });
    const aggregate = publicApi.aggregateCaseChainFacts([score]);

    expect(manifest).toMatchObject({
      candidateId: "M0",
      evaluationSchemaVersion: 2,
      publicEntrypoint: "m0-index.ts",
      ownsFormalMetricEligible: false,
      formalDataStatus: "FORMAL_DATA_V1_1_AVAILABLE_METRIC_INELIGIBLE",
      modelRuns: 0,
    });
    expect(Object.keys(publicApi).sort()).toEqual([
      "aggregateCaseChainFacts",
      "scoreCaseChain",
    ]);
    expect(manifest.publicFunctions).toEqual([
      "scoreCaseChain",
      "aggregateCaseChainFacts",
    ]);
    expect(manifest.publicSignatures).toEqual([{
      function: "scoreCaseChain",
      inputContracts: [
        "RawTraceObservationV2",
        "PrivateChainGoldV2",
        "RuntimeToolContractV2[]",
      ],
      outputContract: "CaseChainScoreV2",
      outputFields: [...SCORE_OUTPUT_FIELDS],
    }, {
      function: "aggregateCaseChainFacts",
      inputContracts: ["CaseChainScoreV2[]"],
      outputContract: "CaseChainAggregateV2",
      outputFields: [...AGGREGATE_OUTPUT_FIELDS],
    }]);
    expect(Object.keys(score)).toEqual([...SCORE_OUTPUT_FIELDS]);
    expect(Object.keys(aggregate)).toEqual([...AGGREGATE_OUTPUT_FIELDS]);
    expect(score).not.toHaveProperty("formalMetricEligible");
    expect(aggregate).not.toHaveProperty("formalMetricEligible");
    expect(manifest.inputPreconditions.length).toBeGreaterThan(0);
    expect(manifest.semanticInvariants).toContain(PREREQUISITE_REPAIR_INVARIANT);
    expect(manifest.formalDataBlockers).toEqual([...FORMAL_DATA_BLOCKERS]);
    expect(manifest.syntheticFixture.bytes).toBe(FROZEN_FIXTURE_BYTES);
    expect(fixture.byteLength).toBe(FROZEN_FIXTURE_BYTES);
    expect(manifest.syntheticFixture.sha256).toBe(FROZEN_FIXTURE_SHA256);
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(FROZEN_FIXTURE_SHA256);
    expect(root.endsWith("measurement-v2\\") || root.endsWith("measurement-v2/")).toBe(true);
  });
});
