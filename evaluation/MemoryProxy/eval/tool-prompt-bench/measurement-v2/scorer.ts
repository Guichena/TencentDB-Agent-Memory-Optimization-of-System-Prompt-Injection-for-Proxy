import { isDeepStrictEqual } from "node:util";
import { readJsonPath, readJsonValues } from "./json-path.js";
import { normalizeTrace } from "./normalizer.js";
import type {
  AllowedChainSequenceV2,
  CaseChainScoreV2,
  ForbiddenBeforeTerminalV2,
  GoldChainStepV2,
  GoldOperationPredicateV2,
  NormalizedTdaiAttemptV2,
  RawInfrastructureFailureV2,
  RawTraceObservationV2,
  ScoreCaseChainInputV2,
} from "./types.js";

function collectRawInfrastructureFailures(
  observation: RawTraceObservationV2,
): readonly RawInfrastructureFailureV2[] {
  return [
    ...(observation.infrastructureFailures ?? []),
    ...observation.attempts.flatMap((attempt) => (
      attempt.infrastructureFailure ? [attempt.infrastructureFailure] : []
    )),
  ];
}

function assertInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Measurement v2 input invariant: ${message}`);
}

function validateScoreInput(input: ScoreCaseChainInputV2): void {
  const { gold, observation, runtimeContracts } = input;
  assertInvariant(
    observation.evaluationSchemaVersion === 2 && gold.evaluationSchemaVersion === 2,
    "evaluationSchemaVersion must be 2",
  );
  assertInvariant(observation.caseId === gold.caseId, "observation.caseId must equal gold.caseId");
  assertInvariant(
    Number.isInteger(gold.attemptBudget) && gold.attemptBudget >= 0,
    "attemptBudget must be a non-negative integer",
  );

  const contractIds = runtimeContracts.map((contract) => contract.contractId);
  assertInvariant(
    new Set(contractIds).size === contractIds.length,
    "RuntimeToolContract contractId values must be unique",
  );
  const contractsById = new Map(runtimeContracts.map((contract) => [contract.contractId, contract]));
  for (const contract of runtimeContracts) {
    assertInvariant(contract.contractId.length > 0, "RuntimeToolContract contractId must be non-empty");
    assertInvariant(
      contract.acceptedStatusCodes.length > 0
      && contract.acceptedStatusCodes.every((status) => Number.isInteger(status)),
      `RuntimeToolContract ${contract.contractId} must freeze integer acceptedStatusCodes`,
    );
  }

  if (gold.expectation === "no-tool") {
    assertInvariant(gold.allowedSequences.length === 0, "no-tool Gold must not declare allowedSequences");
    return;
  }

  assertInvariant(gold.allowedSequences.length > 0, "tool-positive Gold requires allowedSequences");
  const sequenceIds = gold.allowedSequences.map((sequence) => sequence.sequenceId);
  assertInvariant(
    new Set(sequenceIds).size === sequenceIds.length,
    "allowed sequenceId values must be unique",
  );
  for (const sequence of gold.allowedSequences) {
    assertInvariant(sequence.steps.length > 0, `sequence ${sequence.sequenceId} must not be empty`);
    const stepIds = sequence.steps.map((step) => step.stepId);
    assertInvariant(
      new Set(stepIds).size === stepIds.length,
      `stepId values in sequence ${sequence.sequenceId} must be unique`,
    );
    const terminalIndices = sequence.steps.flatMap((step, index) => step.terminal ? [index] : []);
    assertInvariant(
      terminalIndices.length === 1 && terminalIndices[0] === sequence.steps.length - 1,
      `sequence ${sequence.sequenceId} must have exactly one final terminal step`,
    );
    for (const [stepIndex, step] of sequence.steps.entries()) {
      const runtimeContract = contractsById.get(step.runtimeContractId);
      assertInvariant(
        runtimeContract !== undefined,
        `step ${sequence.sequenceId}/${step.stepId} references unknown contractId ${step.runtimeContractId}`,
      );
      assertInvariant(
        runtimeContract.family === step.family
        && runtimeContract.tool === step.tool
        && runtimeContract.endpoint === step.endpoint
        && runtimeContract.method.toUpperCase() === step.method.toUpperCase(),
        `step ${sequence.sequenceId}/${step.stepId} identity must match its RuntimeToolContract`,
      );
      assertInvariant(
        step.operation.kind === "none"
          ? runtimeContract.operation.kind === "none"
          : runtimeContract.operation.kind === "argument"
            && runtimeContract.operation.value === step.operation.value,
        `step ${sequence.sequenceId}/${step.stepId} operation must match its RuntimeToolContract`,
      );
      for (const binding of step.bindings) {
        const priorStepIndex = sequence.steps.findIndex((candidate) => (
          candidate.stepId === binding.priorStepId
        ));
        assertInvariant(
          priorStepIndex >= 0 && priorStepIndex < stepIndex,
          `binding on ${sequence.sequenceId}/${step.stepId} must reference a prior stepId`,
        );
      }
    }
  }

  for (const forbidden of gold.forbiddenBeforeTerminal ?? []) {
    const runtimeContract = contractsById.get(forbidden.runtimeContractId);
    assertInvariant(
      runtimeContract !== undefined,
      `forbidden wrong-terminal references unknown contractId ${forbidden.runtimeContractId}`,
    );
    assertInvariant(
      runtimeContract.family === forbidden.family
      && runtimeContract.tool === forbidden.tool
      && runtimeContract.endpoint === forbidden.endpoint
      && runtimeContract.method.toUpperCase() === forbidden.method.toUpperCase(),
      "forbidden wrong-terminal identity must match its RuntimeToolContract",
    );
    assertInvariant(
      forbidden.operation.kind === "none"
        ? runtimeContract.operation.kind === "none"
        : runtimeContract.operation.kind === "argument"
          && runtimeContract.operation.value === forbidden.operation.value,
      "forbidden wrong-terminal operation must match its RuntimeToolContract",
    );
  }
}

function matchesOperation(
  attempt: NormalizedTdaiAttemptV2,
  operation: GoldOperationPredicateV2,
): boolean {
  return operation.kind === "none"
    ? attempt.normalizedOperation.kind === "none"
    : attempt.normalizedOperation.kind === "value"
      && attempt.normalizedOperation.value === operation.value;
}

function matchesSelection(attempt: NormalizedTdaiAttemptV2, step: GoldChainStepV2): boolean {
  return attempt.family === step.family
    && attempt.tool === step.tool
    && attempt.endpoint === step.endpoint
    && attempt.method?.toUpperCase() === step.method.toUpperCase()
    && matchesOperation(attempt, step.operation);
}

type SelectionFailureLayer =
  | "selection"
  | "wrong_family"
  | "wrong_tool"
  | "wrong_endpoint"
  | "wrong_operation";

function classifyAttemptAgainstStep(
  attempt: NormalizedTdaiAttemptV2,
  step: GoldChainStepV2,
): SelectionFailureLayer {
  if (attempt.family !== step.family) return "wrong_family";
  if (attempt.tool !== step.tool) return "wrong_tool";
  if (
    attempt.endpoint !== step.endpoint
    || attempt.method?.toUpperCase() !== step.method.toUpperCase()
  ) return "wrong_endpoint";
  const operationMatches = matchesOperation(attempt, step.operation);
  return operationMatches ? "selection" : "wrong_operation";
}

function selectionFailureLayer(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequences: readonly AllowedChainSequenceV2[],
): SelectionFailureLayer {
  const compatibilityRank: Record<SelectionFailureLayer, number> = {
    selection: 0,
    wrong_family: 1,
    wrong_tool: 2,
    wrong_endpoint: 3,
    wrong_operation: 4,
  };
  const candidates = sequences.flatMap((sequence) => {
    let startAttemptIndex = 0;
    let matchedStepCount = 0;
    for (const step of sequence.steps) {
      const relativeMatchIndex = attempts.slice(startAttemptIndex).findIndex((attempt) => (
        matchesSelection(attempt, step)
      ));
      if (relativeMatchIndex < 0) {
        const divergentAttempt = attempts[startAttemptIndex];
        return [{
          sequenceId: sequence.sequenceId,
          matchedStepCount,
          layer: divergentAttempt === undefined
            ? "selection" as const
            : classifyAttemptAgainstStep(divergentAttempt, step),
        }];
      }
      startAttemptIndex += relativeMatchIndex + 1;
      matchedStepCount += 1;
    }
    return [{
      sequenceId: sequence.sequenceId,
      matchedStepCount,
      layer: "selection" as const,
    }];
  });
  const best = candidates.sort((left, right) => (
    right.matchedStepCount - left.matchedStepCount
    || compatibilityRank[right.layer] - compatibilityRank[left.layer]
    || left.sequenceId.localeCompare(right.sequenceId, "en-US")
  ))[0];
  return best?.layer ?? "selection";
}

function matchesForbiddenTerminal(
  attempt: NormalizedTdaiAttemptV2,
  forbidden: ForbiddenBeforeTerminalV2,
): boolean {
  return attempt.family === forbidden.family
    && attempt.tool === forbidden.tool
    && attempt.endpoint === forbidden.endpoint
    && attempt.method?.toUpperCase() === forbidden.method.toUpperCase()
    && matchesOperation(attempt, forbidden.operation)
    && attempt.matchedRuntimeContractIds.includes(forbidden.runtimeContractId);
}

function matchesArguments(attempt: NormalizedTdaiAttemptV2, step: GoldChainStepV2): boolean {
  const body = attempt.arguments ?? {};
  const requiredMatch = (step.arguments?.required ?? []).every((field) => (
    readJsonPath(body, field) !== undefined
  ));
  const forbiddenMatch = (step.arguments?.forbidden ?? []).every((field) => (
    readJsonPath(body, field) === undefined
  ));
  const exactMatch = (step.arguments?.exact ?? []).every((predicate) => (
    isDeepStrictEqual(readJsonPath(body, predicate.path), predicate.value)
  ));
  const stringMatch = (step.arguments?.stringContainsAny ?? []).every((predicate) => {
    const value = readJsonPath(body, predicate.path);
    if (typeof value !== "string") return false;
    const normalized = value.toLocaleLowerCase("en-US");
    return predicate.values.some((term) => (
      normalized.includes(term.toLocaleLowerCase("en-US"))
    ));
  });
  const stringTypes = (step.arguments?.nonEmptyStrings ?? []).every(path => {
    const value = readJsonPath(body, path);
    return typeof value === "string" && value.trim().length > 0;
  });
  const integers = (step.arguments?.positiveIntegersIfPresent ?? []).every(path => {
    const value = readJsonPath(body, path);
    return value === undefined || typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  });
  return requiredMatch && forbiddenMatch && exactMatch && stringMatch && stringTypes && integers;
}

function matchesBehaviorStep(attempt: NormalizedTdaiAttemptV2, step: GoldChainStepV2): boolean {
  return matchesSelection(attempt, step)
    && matchesArguments(attempt, step)
    && attempt.matchedRuntimeContractIds.includes(step.runtimeContractId);
}

interface SequenceMatch {
  sequence: AllowedChainSequenceV2;
  positions: readonly number[];
}

type SequenceMatchMode = "selection" | "terminal_horizon" | "complete";

function matchesBindingsAtPositions(
  attempt: NormalizedTdaiAttemptV2,
  stepIndex: number,
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequence: AllowedChainSequenceV2,
  positions: readonly number[],
): boolean {
  const step = sequence.steps[stepIndex];
  return step.bindings.every((binding) => {
    const priorStepIndex = sequence.steps.findIndex((candidate) => candidate.stepId === binding.priorStepId);
    if (priorStepIndex < 0 || priorStepIndex >= stepIndex) return false;
    const priorAttemptPosition = positions[priorStepIndex];
    const priorAttempt = attempts[priorAttemptPosition];
    const argumentValue = readJsonPath(attempt.arguments, binding.argumentPath);
    if (argumentValue === undefined && binding.optionalArgument) return true;
    if (binding.responseItemFilter) {
      const filter = binding.responseItemFilter;
      const items = readJsonPath(priorAttempt.response, binding.responsePath);
      const key = readJsonPath(attempt.arguments, filter.argumentPath);
      return argumentValue !== undefined && key !== undefined && Array.isArray(items)
        && items.some(item => isDeepStrictEqual(readJsonPath(item, filter.keyField), key) && isDeepStrictEqual(readJsonPath(item, filter.valueField), argumentValue));
    }
    if (binding.comparison === "one_of") return argumentValue !== undefined
      && readJsonValues(priorAttempt.response, binding.responsePath).some(value => value !== undefined && isDeepStrictEqual(value, argumentValue));
    const responseValue = readJsonPath(priorAttempt.response, binding.responsePath);
    return argumentValue !== undefined
      && responseValue !== undefined
      && isDeepStrictEqual(argumentValue, responseValue);
  });
}

function firstBehaviorFailureLayer(
  attempts: readonly NormalizedTdaiAttemptV2[],
  match: SequenceMatch,
): "arguments" | "binding" | null {
  for (const [stepIndex, step] of match.sequence.steps.entries()) {
    const attempt = attempts[match.positions[stepIndex]];
    if (!matchesArguments(attempt, step)) return "arguments";
    if (!matchesBindingsAtPositions(
      attempt,
      stepIndex,
      attempts,
      match.sequence,
      match.positions,
    )) return "binding";
  }
  return null;
}

function runtimeAcceptedForMatch(
  attempts: readonly NormalizedTdaiAttemptV2[],
  match: SequenceMatch,
): boolean {
  return match.sequence.steps.every((step, stepIndex) => (
    attempts[match.positions[stepIndex]].acceptedRuntimeContractIds.includes(step.runtimeContractId)
  ));
}

function findSequenceMatch(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequence: AllowedChainSequenceV2,
  mode: SequenceMatchMode,
): SequenceMatch | null {
  if (sequence.steps.length === 0) return null;
  const declaredTerminalIndex = sequence.steps.findIndex((step) => step.terminal);
  const rankingStepIndex = declaredTerminalIndex >= 0
    ? declaredTerminalIndex
    : sequence.steps.length - 1;

  let bestPositions: number[] | null = null;
  const isEarlierMatch = (candidate: readonly number[]): boolean => {
    if (bestPositions === null) return true;
    const terminalDifference = candidate[rankingStepIndex] - bestPositions[rankingStepIndex];
    if (terminalDifference !== 0) return terminalDifference < 0;
    for (let index = 0; index < candidate.length; index += 1) {
      const positionDifference = candidate[index] - bestPositions[index];
      if (positionDifference !== 0) return positionDifference < 0;
    }
    return false;
  };

  const search = (stepIndex: number, startAttemptIndex: number, positions: number[]): void => {
    if (stepIndex === sequence.steps.length) {
      if (isEarlierMatch(positions)) bestPositions = positions;
      return;
    }
    const step = sequence.steps[stepIndex];
    for (let attemptIndex = startAttemptIndex; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      if (!matchesSelection(attempt, step)) continue;
      const requiresCompleteStep = mode === "complete"
        || (mode === "terminal_horizon" && stepIndex === declaredTerminalIndex);
      if (requiresCompleteStep && (
        !matchesBehaviorStep(attempt, step)
        || !matchesBindingsAtPositions(attempt, stepIndex, attempts, sequence, positions)
      )) continue;
      search(stepIndex + 1, attemptIndex + 1, [...positions, attemptIndex]);
    }
  };

  search(0, 0, []);
  return bestPositions ? { sequence, positions: bestPositions } : null;
}

function terminalStepIndex(sequence: AllowedChainSequenceV2): number {
  return sequence.steps.findIndex((step) => step.terminal);
}

function terminalPosition(match: SequenceMatch): number {
  const stepIndex = terminalStepIndex(match.sequence);
  return stepIndex < 0 ? Number.POSITIVE_INFINITY : match.positions[stepIndex];
}

function isExactSequenceMatch(match: SequenceMatch): boolean {
  const position = terminalPosition(match);
  return Number.isFinite(position)
    && position + 1 === match.sequence.steps.length
    && match.positions.every((attemptPosition, stepIndex) => attemptPosition === stepIndex);
}

function sequenceMatches(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequences: readonly AllowedChainSequenceV2[],
  mode: SequenceMatchMode,
): readonly SequenceMatch[] {
  return sequences.flatMap((sequence) => {
    const match = findSequenceMatch(attempts, sequence, mode);
    return match ? [match] : [];
  });
}

function compareSequenceMatches(left: SequenceMatch, right: SequenceMatch): number {
  const terminalDifference = terminalPosition(left) - terminalPosition(right);
  if (terminalDifference !== 0) return terminalDifference;
  const exactDifference = Number(isExactSequenceMatch(right)) - Number(isExactSequenceMatch(left));
  if (exactDifference !== 0) return exactDifference;
  return left.sequence.sequenceId.localeCompare(right.sequence.sequenceId, "en-US");
}

function earliestSequenceMatch(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequences: readonly AllowedChainSequenceV2[],
  mode: SequenceMatchMode,
  barrierIndices: readonly number[] = [],
): SequenceMatch | null {
  const match = sequenceMatches(attempts, sequences, mode)
    .filter((candidate) => !barrierIndices.some((index) => index < terminalPosition(candidate)))
    .sort(compareSequenceMatches)[0];
  return match ?? null;
}

function hasPrerequisiteSelectionPath(
  attempts: readonly NormalizedTdaiAttemptV2[],
  terminalAttemptIndex: number,
  sequence: AllowedChainSequenceV2,
): boolean {
  const terminalIndex = terminalStepIndex(sequence);
  if (terminalIndex < 0) return false;
  if (terminalIndex === 0) return true;
  const prerequisiteSequence: AllowedChainSequenceV2 = {
    sequenceId: `${sequence.sequenceId}:prerequisites`,
    steps: sequence.steps.slice(0, terminalIndex),
  };
  return findSequenceMatch(
    attempts.slice(0, terminalAttemptIndex),
    prerequisiteSequence,
    "selection",
  ) !== null;
}

function hasValidTerminalBindings(
  terminalAttempt: NormalizedTdaiAttemptV2,
  terminalAttemptIndex: number,
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequence: AllowedChainSequenceV2,
): boolean {
  const terminalIndex = terminalStepIndex(sequence);
  if (terminalIndex < 0) return false;
  const terminalStep = sequence.steps[terminalIndex];
  const referencedStepIndices = [...new Set(terminalStep.bindings.map((binding) => (
    sequence.steps.findIndex((step) => step.stepId === binding.priorStepId)
  )))].sort((left, right) => left - right);
  if (referencedStepIndices.some((stepIndex) => stepIndex < 0 || stepIndex >= terminalIndex)) {
    return false;
  }

  const search = (referenceIndex: number, startAttemptIndex: number): boolean => {
    if (referenceIndex === referencedStepIndices.length) return true;
    const priorStepIndex = referencedStepIndices[referenceIndex];
    const priorStep = sequence.steps[priorStepIndex];
    const bindings = terminalStep.bindings.filter((binding) => (
      binding.priorStepId === priorStep.stepId
    ));
    for (
      let priorAttemptIndex = startAttemptIndex;
      priorAttemptIndex < terminalAttemptIndex;
      priorAttemptIndex += 1
    ) {
      const priorAttempt = attempts[priorAttemptIndex];
      if (!matchesSelection(priorAttempt, priorStep)) continue;
      const bindingsMatch = bindings.every((binding) => {
        const argumentValue = readJsonPath(terminalAttempt.arguments, binding.argumentPath);
        const responseValue = readJsonPath(priorAttempt.response, binding.responsePath);
        return argumentValue !== undefined
          && responseValue !== undefined
          && isDeepStrictEqual(argumentValue, responseValue);
      });
      if (bindingsMatch && search(referenceIndex + 1, priorAttemptIndex + 1)) return true;
    }
    return false;
  };

  return search(0, 0);
}

function earliestBehaviorValidTerminalAttemptIndex(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequences: readonly AllowedChainSequenceV2[],
): number | null {
  const attemptIndex = attempts.findIndex((attempt, index) => sequences.some((sequence) => {
    const terminalIndex = terminalStepIndex(sequence);
    const terminalStep = terminalIndex < 0 ? undefined : sequence.steps[terminalIndex];
    return terminalStep !== undefined
      && matchesBehaviorStep(attempt, terminalStep)
      && hasValidTerminalBindings(attempt, index, attempts, sequence);
  }));
  return attemptIndex < 0 ? null : attemptIndex;
}

function prematureTerminalBarrierIndices(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequences: readonly AllowedChainSequenceV2[],
): readonly number[] {
  return attempts.flatMap((attempt, attemptIndex) => {
    const terminalCandidates = sequences.filter((sequence) => {
      const terminalIndex = terminalStepIndex(sequence);
      const terminalStep = terminalIndex < 0 ? undefined : sequence.steps[terminalIndex];
      return terminalStep !== undefined && matchesBehaviorStep(attempt, terminalStep);
    });
    if (terminalCandidates.length === 0) return [];
    const hasLegalPrerequisites = terminalCandidates.some((sequence) => (
      hasPrerequisiteSelectionPath(attempts, attemptIndex, sequence)
    ));
    return hasLegalPrerequisites ? [] : [attemptIndex];
  });
}

function isExactSelectionPrefix(
  attempts: readonly NormalizedTdaiAttemptV2[],
  sequence: AllowedChainSequenceV2,
): boolean {
  return attempts.length <= sequence.steps.length
    && attempts.every((attempt, index) => matchesSelection(attempt, sequence.steps[index]));
}

export function scoreCaseChain(input: ScoreCaseChainInputV2): CaseChainScoreV2 {
  validateScoreInput(input);
  const { gold, observation } = input;
  const attempts = normalizeTrace(observation, input.runtimeContracts).executorBoundAttempts;
  const shortestAllowedLength = gold.allowedSequences.length === 0
    ? 0
    : Math.min(...gold.allowedSequences.map((sequence) => sequence.steps.length));
  if (gold.expectation === "no-tool") {
    const malformedFalseIntent = observation.attempts.some((attempt) => (
      attempt.recognizableTdaiIntent === true && !attempt.executorBound
    ));
    const rawInfrastructureFailure = collectRawInfrastructureFailures(observation);
    const falseCallAttempt = attempts.length > 0;
    const falseCallAccepted = attempts.some((attempt) => attempt.runtimeAccepted);
    return {
      evaluationSchemaVersion: 2,
      caseId: observation.caseId,
      runId: observation.runId,
      variantId: observation.variantId,
      rawTraceStatus: observation.rawTraceStatus,
      traceCompleteness: observation.rawTraceStatus === "complete",
      rawInfrastructureFailure,
      triggeredAttempt: falseCallAttempt,
      firstActionSelectionCorrect: null,
      terminalSelectionCorrect: null,
      completeChainSuccess: null,
      runtimeAcceptedChain: null,
      strictChainExact: null,
      prerequisiteViolation: null,
      bindingSlotCount: null,
      bindingSlotMatchedCount: null,
      falseCallAttempt,
      falseCallAccepted,
      malformedFalseIntent,
      positiveOvercall: null,
      matchedSequenceId: null,
      shortestAllowedLength: 0,
      matchedSequenceLength: null,
      observedAttemptCount: attempts.length,
      evaluationPrefixAttemptCount: attempts.length,
      behaviorValidTerminalAttemptIndex: null,
      terminalAttemptIndex: null,
      toolSplContribution: null,
      shortestExact: null,
      failureLayer: observation.rawTraceStatus !== "complete"
        ? "trace"
        : rawInfrastructureFailure.length > 0
          ? "infrastructure"
          : falseCallAttempt
            ? "false_call"
            : malformedFalseIntent
              ? "malformed_intent"
              : null,
    };
  }
  const firstActionSelectionCorrect = attempts.length > 0 && gold.allowedSequences.some((sequence) => (
    sequence.steps[0] !== undefined && matchesSelection(attempts[0], sequence.steps[0])
  ));
  const rawFirstTerminalAttemptIndex = attempts.findIndex((attempt) => gold.allowedSequences.some((sequence) => {
    const terminalStep = sequence.steps.find((step) => step.terminal);
    return terminalStep !== undefined
      && matchesSelection(attempt, terminalStep);
  }));
  const allowedFamilies = new Set(gold.allowedSequences.flatMap((sequence) => (
    sequence.steps.map((step) => step.family)
  )));
  const forbiddenWrongFamilyIndices = attempts.flatMap((attempt, attemptIndex) => (
    attempt.family !== undefined && !allowedFamilies.has(attempt.family) ? [attemptIndex] : []
  ));
  const forbiddenWrongTerminalIndices = attempts.flatMap((attempt, attemptIndex) => (
    (gold.forbiddenBeforeTerminal ?? []).some((forbidden) => (
      matchesForbiddenTerminal(attempt, forbidden)
    )) ? [attemptIndex] : []
  ));
  const prematureTerminalIndices = prematureTerminalBarrierIndices(attempts, gold.allowedSequences);
  const allBarrierIndices = [
    ...forbiddenWrongFamilyIndices,
    ...forbiddenWrongTerminalIndices,
    ...prematureTerminalIndices,
  ];
  const behaviorTerminalHorizonMatch = earliestSequenceMatch(
    attempts,
    gold.allowedSequences,
    "terminal_horizon",
    allBarrierIndices,
  );
  const behaviorTerminalHorizonPosition = behaviorTerminalHorizonMatch === null
    ? null
    : terminalPosition(behaviorTerminalHorizonMatch);
  const behaviorValidTerminalAttemptIndex = earliestBehaviorValidTerminalAttemptIndex(
    attempts,
    gold.allowedSequences,
  );
  const prefixLength = input.observationWindow === "full-episode" ? attempts.length : behaviorValidTerminalAttemptIndex !== null
    ? behaviorValidTerminalAttemptIndex + 1
    : Math.min(attempts.length, gold.attemptBudget);
  const evaluationPrefix = attempts.slice(0, prefixLength);
  const rawInfrastructureFailure = collectRawInfrastructureFailures(observation);
  const forbiddenWrongFamilyIndex = forbiddenWrongFamilyIndices.find((index) => index < prefixLength) ?? -1;
  const forbiddenWrongTerminalIndex = [
    ...forbiddenWrongTerminalIndices,
    ...prematureTerminalIndices,
  ].filter((index) => index < prefixLength).sort((left, right) => left - right)[0] ?? -1;
  const forbiddenBarrierIndex = [forbiddenWrongFamilyIndex, forbiddenWrongTerminalIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), Number.POSITIVE_INFINITY);
  const hasForbiddenBarrier = Number.isFinite(forbiddenBarrierIndex);
  const forbiddenBarrierLayer = forbiddenWrongFamilyIndex >= 0
    && forbiddenWrongFamilyIndex === forbiddenBarrierIndex
    ? "wrong_family"
    : "wrong_terminal";
  const prefixBarrierIndices = allBarrierIndices.filter((index) => index < prefixLength);
  const selectionMatch = earliestSequenceMatch(
    evaluationPrefix,
    gold.allowedSequences,
    "selection",
    prefixBarrierIndices,
  );
  const completeMatch = earliestSequenceMatch(
    evaluationPrefix,
    gold.allowedSequences,
    "complete",
    prefixBarrierIndices,
  );
  const terminalAttemptIndex = behaviorTerminalHorizonPosition !== null
    ? behaviorTerminalHorizonPosition
    : completeMatch !== null
      ? terminalPosition(completeMatch)
      : selectionMatch !== null
        ? terminalPosition(selectionMatch)
        : rawFirstTerminalAttemptIndex >= 0 && rawFirstTerminalAttemptIndex < prefixLength
          ? rawFirstTerminalAttemptIndex
          : null;
  const prematureBehaviorTerminal = prematureTerminalIndices.some((index) => index < prefixLength);
  const unexpectedFailurePrefix = completeMatch === null
    && evaluationPrefix.length > 0
    && !gold.allowedSequences.some((sequence) => (
      isExactSelectionPrefix(evaluationPrefix, sequence)
    ));
  const completeChainSuccess = completeMatch !== null;
  const runtimeAcceptedChain = completeMatch === null
    ? null
    : runtimeAcceptedForMatch(evaluationPrefix, completeMatch);
  const strictChainExact = completeMatch !== null
    && evaluationPrefix.length === completeMatch.sequence.steps.length
    && completeMatch.positions.every((position, index) => position === index)
    && (input.observationWindow === "full-episode"
      ? evaluationPrefix.length === shortestAllowedLength
      : evaluationPrefix.length <= gold.attemptBudget);
  const matchedBindingSlotCount = completeMatch === null ? null : completeMatch.sequence.steps.reduce((sum, step) => sum + step.bindings.length, 0);
  const positiveOvercall = hasForbiddenBarrier
    || prematureBehaviorTerminal
    || unexpectedFailurePrefix
    || (completeMatch !== null && !strictChainExact);
  const toolSplContribution = completeChainSuccess
    ? shortestAllowedLength / Math.max(shortestAllowedLength, evaluationPrefix.length)
    : 0;
  const behaviorFailureMatch = behaviorTerminalHorizonMatch
    ?? selectionMatch;
  const behaviorFailureLayer = behaviorFailureMatch === null
    ? null
    : firstBehaviorFailureLayer(evaluationPrefix, behaviorFailureMatch);

  return {
    evaluationSchemaVersion: 2,
    caseId: observation.caseId,
    runId: observation.runId,
    variantId: observation.variantId,
    rawTraceStatus: observation.rawTraceStatus,
    traceCompleteness: observation.rawTraceStatus === "complete",
    rawInfrastructureFailure,
    triggeredAttempt: attempts.length > 0,
    firstActionSelectionCorrect,
    terminalSelectionCorrect: selectionMatch !== null,
    completeChainSuccess,
    runtimeAcceptedChain,
    strictChainExact,
    falseCallAttempt: null,
    falseCallAccepted: null,
    malformedFalseIntent: null,
    positiveOvercall,
    matchedSequenceId: completeMatch?.sequence.sequenceId ?? null,
    shortestAllowedLength,
    matchedSequenceLength: completeMatch?.sequence.steps.length ?? null,
    observedAttemptCount: attempts.length,
    evaluationPrefixAttemptCount: evaluationPrefix.length,
    behaviorValidTerminalAttemptIndex,
    terminalAttemptIndex,
    toolSplContribution,
    shortestExact: strictChainExact && evaluationPrefix.length === shortestAllowedLength,
    failureLayer: observation.rawTraceStatus !== "complete"
      ? "trace"
      : completeChainSuccess
        ? null
        : rawInfrastructureFailure.length > 0
          ? "infrastructure"
          : attempts.length === 0
            ? "trigger"
            : hasForbiddenBarrier
              ? forbiddenBarrierLayer
              : behaviorFailureLayer !== null
                ? behaviorFailureLayer
                : selectionFailureLayer(evaluationPrefix, gold.allowedSequences),
  };
}
