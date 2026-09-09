import { isDeepStrictEqual } from "node:util";
import type {
  AllowedToolAction,
  ArgumentRules,
  EvalFixture,
  EvalFamily,
  ToolPromptEvalCase,
} from "./schema.js";

export type EvaluationState =
  | "NO_TDAI_INTENT"
  | "TDAI_INTENT_MALFORMED"
  | "WRONG_FAMILY"
  | "WRONG_ENDPOINT"
  | "CORRECT_ENDPOINT_INVALID_ARGS"
  | "CORRECT_CALL"
  | "EXTRA_OR_DUPLICATE_CALL"
  | "INFRASTRUCTURE_ERROR";

export interface TdaiAttempt {
  intentId?: string;
  runId?: string;
  sessionId?: string;
  timestamp?: string;
  tool: string;
  family: EvalFamily;
  endpoint: string;
  method: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  status?: number;
  response?: unknown;
  malformedReason?: string;
  infrastructureError?: string;
}

export interface ToolPromptEvaluation {
  caseId: string;
  state: EvaluationState;
  triggerAttempted: boolean;
  effectiveCall: boolean;
  falseCall: boolean;
  firstActionCorrect: boolean;
  conditionalToolCorrect: boolean | null;
  argumentValid: boolean;
  executionValid: boolean;
  overcall: boolean;
  observedTools: string[];
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined;
}

function containsPriorValue(value: unknown, previousResponse: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => containsPriorValue(item, previousResponse));
  if (typeof value !== "string" && typeof value !== "number") return false;
  if (isDeepStrictEqual(value, previousResponse)) return true;
  if (Array.isArray(previousResponse)) return previousResponse.some((item) => containsPriorValue(value, item));
  if (previousResponse && typeof previousResponse === "object") {
    return Object.values(previousResponse as Record<string, unknown>).some((item) => containsPriorValue(value, item));
  }
  return false;
}

function matchesRules(
  body: Record<string, unknown>,
  rules: ArgumentRules | undefined,
  fixture: EvalFixture,
  previousResponse: unknown,
): boolean {
  if (!rules) return true;
  for (const field of rules.requiredFields ?? []) if (!hasOwn(body, field)) return false;
  for (const field of rules.forbiddenFields ?? []) if (hasOwn(body, field)) return false;
  for (const [field, expected] of Object.entries(rules.exactValues ?? {})) {
    if (!isDeepStrictEqual(body[field], expected)) return false;
  }
  for (const [field, terms] of Object.entries(rules.stringContainsAny ?? {})) {
    const value = body[field];
    if (typeof value !== "string") return false;
    const normalized = value.toLowerCase();
    if (!terms.some((term) => normalized.includes(term.toLowerCase()))) return false;
  }
  if (rules.pathFromFixture) {
    const validPaths = new Set([
      ...(fixture.assets.sceneIndex ?? []).map((entry) => entry.path),
      ...(fixture.assets.scenes ?? []).map((entry) => entry.path),
    ]);
    if (!validPaths.has(body.path)) return false;
  }
  if (rules.valueFromPreviousStep) {
    const candidateFields = (rules.requiredFields ?? []).filter((field) => (
      field !== "include_content" && field !== "include_manifest"
    ));
    if (!candidateFields.some((field) => containsPriorValue(body[field], previousResponse))) return false;
  }
  return true;
}

function matchesAction(
  attempt: TdaiAttempt,
  action: AllowedToolAction,
  fixture: EvalFixture,
  previousResponse?: unknown,
): boolean {
  return attempt.tool === action.tool
    && attempt.endpoint === action.endpoint
    && attempt.method.toUpperCase() === "POST"
    && matchesRules(attempt.body ?? {}, action.argumentRules, fixture, previousResponse);
}

function expectedActionAt(
  item: ToolPromptEvalCase,
  expectedSequence: string[],
  index: number,
): AllowedToolAction | null {
  const expectedTool = expectedSequence[index];
  if (!expectedTool) return null;
  if (index === 0) {
    return item.gold.allowedFirstActions.find((action) => action.tool === expectedTool) ?? null;
  }
  if (item.gold.family !== "knowledge") {
    const action = item.gold.expectedFollowupActions?.[index - 1];
    return action?.tool === expectedTool ? action : null;
  }

  if (expectedTool !== "knowledge_tools_call") return null;

  const expectation = item.gold.expectedKnowledgeCalls?.[index - 1];
  const knowledgeId = item.gold.allowedFirstActions.find((action) => (
    action.tool === expectedSequence[0]
  ))?.argumentRules?.exactValues?.knowledge_id;
  if (!expectation || typeof knowledgeId !== "string") return null;
  return {
    tool: "knowledge_tools_call",
    endpoint: "/tools/call",
    argumentRules: {
      requiredFields: ["knowledge_id", "tool_name", "params"],
      exactValues: { knowledge_id: knowledgeId, tool_name: expectation.toolName },
    },
  };
}

function matchesExpectedAt(
  item: ToolPromptEvalCase,
  fixture: EvalFixture,
  attempts: TdaiAttempt[],
  expectedSequence: string[],
  index: number,
): boolean {
  const expectedTool = expectedSequence[index];
  if (!expectedTool) return false;
  const action = expectedActionAt(item, expectedSequence, index);
  const attempt = attempts[index];
  if (!action || !attempt || !matchesAction(attempt, action, fixture, attempts[index - 1]?.response)) return false;
  if (item.gold.family === "knowledge" && index > 0) {
    const expectation = item.gold.expectedKnowledgeCalls?.[index - 1];
    const params = attempt.body?.params;
    if (!expectation || !params || typeof params !== "object") return false;
    return matchesRules(
      params as Record<string, unknown>,
      expectation.paramRules,
      fixture,
      attempts[index - 1]?.response,
    );
  }
  return true;
}

function hasValidHeaders(attempt: TdaiAttempt): boolean {
  const headers = Object.fromEntries(Object.entries(attempt.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const contentType = headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return false;
  if (!headers["x-tdai-service-id"]) return false;
  if (attempt.family !== "knowledge" && !headers["x-conversation-id"]) return false;
  return true;
}

export function evaluateToolPromptCase(
  item: ToolPromptEvalCase,
  fixture: EvalFixture,
  attempts: TdaiAttempt[],
): ToolPromptEvaluation {
  const base = {
    caseId: item.caseId,
    triggerAttempted: attempts.length > 0,
    falseCall: !item.gold.needTdaiTool && attempts.length > 0,
    observedTools: attempts.map((attempt) => attempt.tool),
  };

  if (attempts.some((attempt) => attempt.infrastructureError)) {
    return {
      ...base,
      state: "INFRASTRUCTURE_ERROR",
      effectiveCall: false,
      firstActionCorrect: false,
      conditionalToolCorrect: null,
      argumentValid: false,
      executionValid: false,
      overcall: false,
    };
  }
  if (attempts.some((attempt) => attempt.malformedReason)) {
    return {
      ...base,
      state: "TDAI_INTENT_MALFORMED",
      effectiveCall: false,
      firstActionCorrect: false,
      conditionalToolCorrect: item.gold.needTdaiTool ? false : null,
      argumentValid: false,
      executionValid: false,
      overcall: attempts.length > item.gold.maxTdaiCalls,
    };
  }
  if (!item.gold.needTdaiTool) {
    return {
      ...base,
      state: attempts.length === 0 ? "NO_TDAI_INTENT" : "EXTRA_OR_DUPLICATE_CALL",
      effectiveCall: false,
      firstActionCorrect: false,
      conditionalToolCorrect: null,
      argumentValid: attempts.length === 0,
      executionValid: attempts.length === 0,
      overcall: attempts.length > 0,
    };
  }
  if (attempts.length === 0) {
    return {
      ...base,
      state: "NO_TDAI_INTENT",
      effectiveCall: false,
      firstActionCorrect: false,
      conditionalToolCorrect: null,
      argumentValid: false,
      executionValid: false,
      overcall: false,
    };
  }

  const firstActionWithValidArgs = item.gold.allowedFirstActions.find((action) => (
    matchesAction(attempts[0], action, fixture)
  ));
  const firstFamilyCorrect = attempts[0].family === item.gold.family;
  const firstToolExpected = item.gold.allowedFirstActions.some((action) => action.tool === attempts[0].tool);
  const firstEndpointExpected = item.gold.allowedFirstActions.some((action) => (
    action.tool === attempts[0].tool
    && action.endpoint === attempts[0].endpoint
    && attempts[0].method.toUpperCase() === "POST"
  ));
  const firstSelectionCorrect = firstFamilyCorrect && firstEndpointExpected;
  const completedSequences = item.gold.allowedSequences.filter((sequence) => (
    sequence.length > 0
    && attempts.length >= sequence.length
    && sequence.every((tool, index) => attempts[index]?.tool === tool)
    && sequence.every((_, index) => matchesExpectedAt(item, fixture, attempts, sequence, index))
  ));
  const matchedSequence = completedSequences.find((sequence) => (
    attempts.length === sequence.length
  ));
  const expectedLength = matchedSequence?.length ?? 0;
  const fullSequenceCorrect = matchedSequence !== undefined;
  const sequenceExecutionValid = (sequence: string[]): boolean => (
    attempts.slice(0, sequence.length).every((attempt) => (
      hasValidHeaders(attempt)
      && typeof attempt.status === "number"
      && attempt.status >= 200
      && attempt.status < 300
    ))
  );
  const overcallAfterCompletedPath = matchedSequence === undefined
    && completedSequences.some((sequence) => (
      attempts.length > sequence.length
    ));
  const overcall = attempts.length > item.gold.maxTdaiCalls || overcallAfterCompletedPath;
  const executionValid = fullSequenceCorrect
    && sequenceExecutionValid(matchedSequence);

  let state: EvaluationState;
  if (!firstFamilyCorrect) state = "WRONG_FAMILY";
  else if (!firstToolExpected || !firstEndpointExpected) state = "WRONG_ENDPOINT";
  else if (overcallAfterCompletedPath) state = "EXTRA_OR_DUPLICATE_CALL";
  else if (!firstActionWithValidArgs || !fullSequenceCorrect) state = "CORRECT_ENDPOINT_INVALID_ARGS";
  else if (overcall) state = "EXTRA_OR_DUPLICATE_CALL";
  else state = "CORRECT_CALL";

  return {
    ...base,
    state,
    effectiveCall: fullSequenceCorrect && !overcall,
    firstActionCorrect: firstSelectionCorrect,
    conditionalToolCorrect: firstSelectionCorrect,
    argumentValid: fullSequenceCorrect,
    executionValid,
    overcall,
  };
}
