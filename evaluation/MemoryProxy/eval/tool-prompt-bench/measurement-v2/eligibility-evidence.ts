import type { PairedIsolationEvidence, RunIsolationEvidence } from "./isolation-evidence.js";
import {
  assessM0EvaluationBoundaryFacts,
  assessM2EvaluationHorizonUsageEvidence,
  type BuildRequestUsageLedgerResult,
  type M0EvaluationBoundaryFacts,
  type M0EvaluationBoundaryGate,
  type M2EvaluationHorizonUsageEvidence,
} from "./request-usage-ledger.js";
import type { TokenLedger } from "./token-ledger.js";

export interface PrepareOnlyEvidence {
  enabled: boolean;
  servicesStarted: boolean;
  codexProcessesStarted: number;
  providerRequestsIssued: number;
  authFilesRead: boolean;
  authFilesCopied: boolean;
}

export type M2EligibilityBlockerCode =
  | "FORMAL_DATA_BLOCKED"
  | "MOCK_LAYER_NOT_FORMAL"
  | "REQUEST_USAGE_LEDGER_BLOCKED"
  | "REQUEST_USAGE_LEDGER_RUN_MISMATCH"
  | "USAGE_HORIZON_BLOCKED"
  | "USAGE_HORIZON_RUN_MISMATCH"
  | "TOKEN_LEDGER_MODULE_MISMATCH"
  | "TOKEN_LEDGER_RUN_MISMATCH"
  | "TOKEN_LEDGER_VARIANT_MISMATCH"
  | "TOKEN_CLASSIFICATION_INTEGRATION_BLOCKED"
  | "RUN_ISOLATION_BLOCKED"
  | "PAIRED_ISOLATION_BLOCKED"
  | "COMPARISON_PURPOSE_MISMATCH"
  | "M0_EVALUATION_BOUNDARY_PENDING"
  | "M0_EVALUATION_BOUNDARY_INVALID"
  | "PREPARE_ONLY_SIDE_EFFECT";

export type M2ComparisonEvidence =
  | { purpose: "none" }
  | {
      purpose: "variant" | "counterfactual" | "repeat";
      evidence: PairedIsolationEvidence;
    };

export interface BuildM2EligibilityEvidenceInput {
  formalDataState: "blocked" | "frozen";
  evaluationLayer: "mock-contract" | "real-chain";
  requestUsageLedger: BuildRequestUsageLedgerResult;
  usageHorizon: M2EvaluationHorizonUsageEvidence | null;
  tokenLedger: TokenLedger;
  runIsolation: RunIsolationEvidence;
  comparison: M2ComparisonEvidence;
  prepareOnly: PrepareOnlyEvidence;
  m0EvaluationBoundary: M0EvaluationBoundaryFacts;
}

export interface M2EligibilityEvidence {
  schemaVersion: 2;
  measurementModuleId: "M2";
  runId: string;
  variantId: string;
  formalDataState: BuildM2EligibilityEvidenceInput["formalDataState"];
  evaluationLayer: BuildM2EligibilityEvidenceInput["evaluationLayer"];
  m2EvidenceStatus: "ready_for_integration" | "blocked";
  blockers: M2EligibilityBlockerCode[];
  noModelGate: {
    status: "ready" | "blocked" | "not_applicable";
    modelRuns: number;
    codexProcessesStarted: number;
    servicesStarted: boolean;
    authFilesRead: boolean;
    authFilesCopied: boolean;
  };
  requestUsageLedgerCanonicalSha256: string | null;
  usageHorizonCanonicalSha256: string | null;
  tokenLedgerCanonicalSha256: string;
  comparisonPurpose: M2ComparisonEvidence["purpose"];
  m0EvaluationBoundary: M0EvaluationBoundaryFacts;
  m0EvaluationBoundaryGate: M0EvaluationBoundaryGate;
  finalEligibilityOwner: "Integration";
  integrationRequirements: [
    "M0_EVALUATION_BOUNDARY",
    "FORMAL_COMPILER_CAPTURE_CONTRACT",
    "INTEGRATION_OWNS_FINAL_ELIGIBILITY",
  ];
}

export function buildM2EligibilityEvidence(
  input: BuildM2EligibilityEvidenceInput,
): M2EligibilityEvidence {
  const blockers: M2EligibilityBlockerCode[] = [];
  if (input.formalDataState !== "frozen") blockers.push("FORMAL_DATA_BLOCKED");
  if (input.evaluationLayer !== "real-chain") blockers.push("MOCK_LAYER_NOT_FORMAL");
  if (input.requestUsageLedger.status !== "ready") {
    blockers.push("REQUEST_USAGE_LEDGER_BLOCKED");
  } else if (input.requestUsageLedger.ledger.runId !== input.runIsolation.runId) {
    blockers.push("REQUEST_USAGE_LEDGER_RUN_MISMATCH");
  }
  if (input.usageHorizon === null
    || assessM2EvaluationHorizonUsageEvidence(input.usageHorizon).status !== "ready") {
    blockers.push("USAGE_HORIZON_BLOCKED");
  } else {
    if (input.usageHorizon.runId !== input.runIsolation.runId) {
      blockers.push("USAGE_HORIZON_RUN_MISMATCH");
    }
    if (
      input.requestUsageLedger.status === "ready"
      && input.usageHorizon.requestUsageLedgerCanonicalSha256
        !== input.requestUsageLedger.ledger.canonicalSha256
    ) {
      blockers.push("USAGE_HORIZON_BLOCKED");
    }
  }
  if (input.tokenLedger.measurementModuleId !== "M2") blockers.push("TOKEN_LEDGER_MODULE_MISMATCH");
  if (input.tokenLedger.runId !== input.runIsolation.runId) blockers.push("TOKEN_LEDGER_RUN_MISMATCH");
  if (input.tokenLedger.variantId !== input.runIsolation.variantId) blockers.push("TOKEN_LEDGER_VARIANT_MISMATCH");
  if (input.tokenLedger.classification.formalCompilerClosure.status !== "ready"
    || input.tokenLedger.classification.formalCompilerClosure.owner !== "Integration") {
    blockers.push("TOKEN_CLASSIFICATION_INTEGRATION_BLOCKED");
  }
  if (input.runIsolation.isolationStatus !== "ready") blockers.push("RUN_ISOLATION_BLOCKED");
  if (input.comparison.purpose !== "none") {
    if (input.comparison.evidence.comparisonPurpose !== input.comparison.purpose) {
      blockers.push("COMPARISON_PURPOSE_MISMATCH");
    }
    if (input.comparison.evidence.pairStatus !== "ready") blockers.push("PAIRED_ISOLATION_BLOCKED");
  }
  const m0EvaluationBoundaryGate = assessM0EvaluationBoundaryFacts(input.m0EvaluationBoundary);
  if (m0EvaluationBoundaryGate.status === "pending") {
    blockers.push("M0_EVALUATION_BOUNDARY_PENDING");
  } else if (m0EvaluationBoundaryGate.status === "blocked") {
    blockers.push("M0_EVALUATION_BOUNDARY_INVALID");
  }

  const prepareOnlySideEffect = input.prepareOnly.enabled && (
    input.prepareOnly.servicesStarted
    || input.prepareOnly.codexProcessesStarted !== 0
    || input.prepareOnly.providerRequestsIssued !== 0
    || input.prepareOnly.authFilesRead
    || input.prepareOnly.authFilesCopied
  );
  if (prepareOnlySideEffect) blockers.push("PREPARE_ONLY_SIDE_EFFECT");

  return {
    schemaVersion: 2,
    measurementModuleId: "M2",
    runId: input.runIsolation.runId,
    variantId: input.runIsolation.variantId,
    formalDataState: input.formalDataState,
    evaluationLayer: input.evaluationLayer,
    m2EvidenceStatus: blockers.length === 0 ? "ready_for_integration" : "blocked",
    blockers,
    noModelGate: {
      status: input.prepareOnly.enabled
        ? (prepareOnlySideEffect ? "blocked" : "ready")
        : "not_applicable",
      modelRuns: input.prepareOnly.providerRequestsIssued,
      codexProcessesStarted: input.prepareOnly.codexProcessesStarted,
      servicesStarted: input.prepareOnly.servicesStarted,
      authFilesRead: input.prepareOnly.authFilesRead,
      authFilesCopied: input.prepareOnly.authFilesCopied,
    },
    requestUsageLedgerCanonicalSha256: input.requestUsageLedger.status === "ready"
      ? input.requestUsageLedger.ledger.canonicalSha256
      : null,
    usageHorizonCanonicalSha256: input.usageHorizon?.canonicalSha256 ?? null,
    tokenLedgerCanonicalSha256: input.tokenLedger.canonicalSha256,
    comparisonPurpose: input.comparison.purpose,
    m0EvaluationBoundary: input.m0EvaluationBoundary,
    m0EvaluationBoundaryGate,
    finalEligibilityOwner: "Integration",
    integrationRequirements: [
      "M0_EVALUATION_BOUNDARY",
      "FORMAL_COMPILER_CAPTURE_CONTRACT",
      "INTEGRATION_OWNS_FINAL_ELIGIBILITY",
    ],
  };
}
