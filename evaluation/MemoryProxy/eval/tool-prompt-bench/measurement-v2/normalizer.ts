import { readJsonPath } from "./json-path.js";
import type {
  NormalizedOperationV2,
  NormalizedTdaiAttemptV2,
  NormalizedTraceV2,
  RawTdaiTraceAttemptV2,
  RawTraceObservationV2,
  RuntimeToolContractV2,
} from "./types.js";

function matchesBaseIdentity(
  attempt: RawTdaiTraceAttemptV2,
  contract: RuntimeToolContractV2,
): boolean {
  return attempt.family === contract.family
    && attempt.tool === contract.tool
    && attempt.endpoint === contract.endpoint
    && attempt.method?.toUpperCase() === contract.method.toUpperCase();
}

function normalizedOperation(
  attempt: RawTdaiTraceAttemptV2,
  runtimeContracts: readonly RuntimeToolContractV2[],
): NormalizedOperationV2 {
  const baseContracts = runtimeContracts.filter((contract) => (
    matchesBaseIdentity(attempt, contract)
  ));
  const operationContracts = baseContracts.filter((contract) => (
    contract.operation.kind === "argument"
  ));
  const hasNonStringSelector = operationContracts.some((contract) => {
    if (contract.operation.kind !== "argument") return false;
    const value = readJsonPath(attempt.arguments, contract.operation.path);
    return value !== undefined && typeof value !== "string";
  });
  const selectorValues = [...new Set(operationContracts.flatMap((contract) => {
    if (contract.operation.kind !== "argument") return [];
    const value = readJsonPath(attempt.arguments, contract.operation.path);
    return typeof value === "string" ? [value] : [];
  }))];
  const matchingValues = [...new Set(operationContracts.flatMap((contract) => (
    contract.operation.kind === "argument"
    && readJsonPath(attempt.arguments, contract.operation.path) === contract.operation.value
      ? [contract.operation.value]
      : []
  )))];

  if (hasNonStringSelector) {
    return {
      kind: "invalid",
      explicitValue: attempt.operation,
      selectorValues,
      reason: "non_string_selector",
    };
  }

  if (attempt.operation !== undefined) {
    if (operationContracts.length === 0) {
      return { kind: "value", value: attempt.operation };
    }
    if (selectorValues.length === 0) {
      return {
        kind: "invalid",
        explicitValue: attempt.operation,
        selectorValues,
        reason: "missing_selector",
      };
    }
    if (
      matchingValues.includes(attempt.operation)
      && selectorValues.every((value) => value === attempt.operation)
    ) return { kind: "value", value: attempt.operation };
    return {
      kind: "conflict",
      explicitValue: attempt.operation,
      selectorValues,
    };
  }
  if (matchingValues.length === 1) return { kind: "value", value: matchingValues[0] };
  if (matchingValues.length > 1) return { kind: "conflict", selectorValues };
  if (selectorValues.length > 0) {
    return { kind: "invalid", selectorValues, reason: "unrecognized_selector" };
  }
  if (
    baseContracts.some((contract) => contract.operation.kind === "none")
    || operationContracts.length === 0
  ) return { kind: "none" };
  return { kind: "invalid", selectorValues, reason: "missing_selector" };
}

function matchesRuntimeIdentity(
  attempt: RawTdaiTraceAttemptV2,
  contract: RuntimeToolContractV2,
): boolean {
  return matchesBaseIdentity(attempt, contract)
    && (contract.operation.kind === "none"
      ? attempt.operation === undefined
      : readJsonPath(attempt.arguments, contract.operation.path) === contract.operation.value
        && (attempt.operation === undefined || attempt.operation === contract.operation.value));
}

export function normalizeTrace(
  observation: RawTraceObservationV2,
  runtimeContracts: readonly RuntimeToolContractV2[],
): NormalizedTraceV2 {
  const executorBoundAttempts = observation.attempts
    .filter((attempt) => attempt.executorBound)
    .map((attempt, executorBoundOrdinal): NormalizedTdaiAttemptV2 => {
      const operation = normalizedOperation(attempt, runtimeContracts);
      const matchingContracts = runtimeContracts.filter((contract) => (
        matchesRuntimeIdentity(attempt, contract)
      ));
      const acceptedContracts = matchingContracts.filter((contract) => (
        attempt.status !== undefined && contract.acceptedStatusCodes.includes(attempt.status)
      ));
      return {
        ...attempt,
        executorBoundOrdinal,
        normalizedOperation: operation,
        matchedRuntimeContractIds: matchingContracts.map((contract) => contract.contractId),
        acceptedRuntimeContractIds: acceptedContracts.map((contract) => contract.contractId),
        runtimeAccepted: acceptedContracts.length > 0,
      };
    });

  return { observation, executorBoundAttempts };
}
