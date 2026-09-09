export type ToolFamilyV2 = "memory" | "skill" | "knowledge";
export type RawTraceStatusV2 = "complete" | "partial" | "missing";
export type JsonPrimitiveV2 = string | number | boolean | null;
export type JsonValueV2 = JsonPrimitiveV2 | JsonObjectV2 | readonly JsonValueV2[];
export interface JsonObjectV2 {
  readonly [key: string]: JsonValueV2 | undefined;
}

export interface ArgumentPredicateV2 {
  nonEmptyStrings?: readonly string[];
  positiveIntegersIfPresent?: readonly string[];
  required?: readonly string[];
  forbidden?: readonly string[];
  exact?: readonly {
    path: string;
    value: JsonValueV2;
  }[];
  stringContainsAny?: readonly {
    path: string;
    values: readonly string[];
  }[];
}

export type GoldOperationPredicateV2 =
  | { kind: "none" }
  | { kind: "exact"; value: string };

export type RuntimeOperationContractV2 =
  | { kind: "none" }
  | { kind: "argument"; path: string; value: string };

export interface GoldChainStepV2 {
  stepId: string;
  family: ToolFamilyV2;
  tool: string;
  endpoint: string;
  method: string;
  operation: GoldOperationPredicateV2;
  arguments?: ArgumentPredicateV2;
  bindings: readonly PriorOutputBindingPredicateV2[];
  runtimeContractId: string;
  terminal: boolean;
}

export interface PriorOutputBindingPredicateV2 {
  argumentPath: string;
  priorStepId: string;
  responsePath: string;
  comparison: "exact" | "one_of";
  optionalArgument?: boolean;
  responseItemFilter?: { argumentPath: string; keyField: string; valueField: string };
}

export interface AllowedChainSequenceV2 {
  sequenceId: string;
  steps: readonly GoldChainStepV2[];
}

export interface PrivateChainGoldV2 {
  evaluationSchemaVersion: 2;
  caseId: string;
  expectation: "tool" | "no-tool";
  attemptBudget: number;
  allowedSequences: readonly AllowedChainSequenceV2[];
  forbiddenBeforeTerminal?: readonly ForbiddenBeforeTerminalV2[];
}

export interface ForbiddenBeforeTerminalV2 {
  reason: "wrong_terminal";
  family: ToolFamilyV2;
  tool: string;
  endpoint: string;
  method: string;
  operation: GoldOperationPredicateV2;
  runtimeContractId: string;
}

export interface RawTraceObservationV2 {
  evaluationSchemaVersion: 2;
  caseId: string;
  runId: string;
  variantId: string;
  rawTraceStatus: RawTraceStatusV2;
  attempts: readonly RawTdaiTraceAttemptV2[];
  infrastructureFailures?: readonly RawInfrastructureFailureV2[];
}

export interface RawInfrastructureFailureV2 {
  kind: "provider_5xx" | "bridge_5xx" | "timeout" | "trace_missing" | "other";
  message: string;
  code?: string;
}

export interface RawTdaiTraceAttemptV2 {
  attemptId: string;
  intentId?: string;
  executorBound: boolean;
  family?: ToolFamilyV2;
  tool?: string;
  endpoint?: string;
  method?: string;
  operation?: string;
  arguments?: JsonObjectV2;
  status?: number;
  response?: JsonValueV2;
  infrastructureFailure?: RawInfrastructureFailureV2;
  recognizableTdaiIntent?: boolean;
  malformedReason?: string;
}

export interface RuntimeToolContractV2 {
  contractId: string;
  family: ToolFamilyV2;
  tool: string;
  endpoint: string;
  method: string;
  operation: RuntimeOperationContractV2;
  acceptedStatusCodes: readonly number[];
}

export type NormalizedOperationV2 =
  | { kind: "none" }
  | { kind: "value"; value: string }
  | {
    kind: "conflict";
    explicitValue?: string;
    selectorValues: readonly string[];
  }
  | {
    kind: "invalid";
    explicitValue?: string;
    selectorValues: readonly string[];
    reason: "missing_selector" | "non_string_selector" | "unrecognized_selector";
  };

export type ChainFailureLayerV2 =
  | "trace"
  | "trigger"
  | "selection"
  | "wrong_family"
  | "wrong_tool"
  | "wrong_endpoint"
  | "wrong_operation"
  | "wrong_terminal"
  | "arguments"
  | "binding"
  | "infrastructure"
  | "false_call"
  | "malformed_intent"
  | null;

export interface CaseChainScoreV2 {
  evaluationSchemaVersion: 2;
  caseId: string;
  runId: string;
  variantId: string;
  rawTraceStatus: RawTraceStatusV2;
  traceCompleteness: boolean;
  rawInfrastructureFailure: readonly RawInfrastructureFailureV2[];
  triggeredAttempt: boolean;
  firstActionSelectionCorrect: boolean | null;
  terminalSelectionCorrect: boolean | null;
  completeChainSuccess: boolean | null;
  /** Descriptive only: whether the behavior-valid chain received its frozen accepted statuses. */
  runtimeAcceptedChain: boolean | null;
  strictChainExact: boolean | null;\n  prerequisiteViolation?: boolean | null;\n  bindingSlotCount?: number | null;\n  bindingSlotMatchedCount?: number | null;
  falseCallAttempt: boolean | null;
  falseCallAccepted: boolean | null;
  malformedFalseIntent: boolean | null;
  positiveOvercall: boolean | null;
  matchedSequenceId: string | null;
  shortestAllowedLength: number;
  matchedSequenceLength: number | null;
  observedAttemptCount: number;
  evaluationPrefixAttemptCount: number;
  /** Earliest terminal whose own Gold/runtime identity, args, and prior-output bindings are valid. */
  behaviorValidTerminalAttemptIndex: number | null;
  terminalAttemptIndex: number | null;
  toolSplContribution: number | null;
  shortestExact: boolean | null;
  failureLayer: ChainFailureLayerV2;
}

export interface ScoreCaseChainInputV2 {
  /** Final5 uses the entire episode; old frozen campaigns retain terminal-prefix semantics. */
  observationWindow?: "terminal-prefix" | "full-episode";
  observation: RawTraceObservationV2;
  gold: PrivateChainGoldV2;
  runtimeContracts: readonly RuntimeToolContractV2[];
}

export interface RatioV2 {
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface MeanV2 {
  sum: number;
  denominator: number;
  value: number | null;
}

export interface CaseChainAggregateV2 {
  evaluationSchemaVersion: 2;
  aggregationScope: "provided_trace_facts";
  caseCount: number;
  toolPositiveCount: number;
  noToolCount: number;
  triggerRecall: RatioV2;
  firstActionSelectionAccuracy: RatioV2;
  terminalSelectionRate: RatioV2;
  completeChainSuccessRate: RatioV2;
  runtimeAcceptedChainRate: RatioV2;
  conditionalTerminalAccuracy: RatioV2;
  strictChainExactRate: RatioV2;
  positiveOvercallRate: RatioV2;
  falseCallAttemptRate: RatioV2;
  falseCallAcceptedRate: RatioV2;
  malformedFalseIntentRate: RatioV2;
  toolSpl: MeanV2;
  shortestExactRate: RatioV2;
  incompleteTraceCount: number;
  rawInfrastructureFailureCaseCount: number;
  failureLayerCounts: Record<Exclude<ChainFailureLayerV2, null>, number>;
}

export interface NormalizedTdaiAttemptV2 extends RawTdaiTraceAttemptV2 {
  executorBoundOrdinal: number;
  normalizedOperation: NormalizedOperationV2;
  matchedRuntimeContractIds: readonly string[];
  acceptedRuntimeContractIds: readonly string[];
  runtimeAccepted: boolean;
}

export interface NormalizedTraceV2 {
  observation: RawTraceObservationV2;
  executorBoundAttempts: readonly NormalizedTdaiAttemptV2[];
}
