import { RUNTIME_TOOL_CONTRACTS } from "../../contracts/runtime-tool-contracts.js";
import { BRIDGE_CORRELATION_HEADER_NAMES } from "../../../../implementations/final/MemoryProxy/src/bridge-entry-observer.js";

export type TdaiFamily = "memory" | "skill" | "knowledge";

const CORRELATION_HEADER_ALLOWLIST = new Set<string>(BRIDGE_CORRELATION_HEADER_NAMES);

export interface TdaiAttemptInput {
  kind: "tdai_attempt";
  attemptId: string;
  disposition: "dispatchable" | "malformed";
  family?: TdaiFamily;
  tool?: string;
  endpoint?: string;
  malformedReason?: string;
  raw: unknown;
}

export interface TdaiEntryInput {
  kind: "tdai_entry";
  entryId: string;
  attemptId?: string;
  family: TdaiFamily;
  tool?: string;
  endpoint: string;
  method: string;
  requestBody?: unknown;
  correlationHeaders?: Readonly<Record<string, string>>;
  /** Downstream forwarding is evidence, not the canonical outer entry. */
  forwardedEvidence?: RealChainForwardedEvidence;
}

export interface TdaiAcceptedInput {
  kind: "tdai_accepted";
  entryId: string;
  family: TdaiFamily;
  tool?: string;
  endpoint: string;
  status: number;
  responseBody?: unknown;
}

export interface TdaiRejectedInput {
  kind: "tdai_rejected";
  entryId?: string;
  attemptId?: string;
  family?: TdaiFamily;
  tool?: string;
  endpoint?: string;
  status?: number;
  reason: string;
  responseBody?: unknown;
}

export interface InfrastructureErrorInput {
  kind: "infrastructure_error";
  stage: string;
  message: string;
  retryable?: boolean;
  raw?: unknown;
}

export interface TimeoutInput {
  kind: "timeout";
  stage: string;
  budgetMs: number;
}

export interface NonTdaiResponseInput {
  kind: "non_tdai_response";
  text: string;
  raw?: unknown;
}

export interface UsageInput {
  kind: "usage";
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export type RealChainEventInput =
  | TdaiAttemptInput
  | TdaiEntryInput
  | TdaiAcceptedInput
  | TdaiRejectedInput
  | InfrastructureErrorInput
  | TimeoutInput
  | NonTdaiResponseInput
  | UsageInput;

export type RealChainEvent = RealChainEventInput & {
  sequence: number;
  observedAt: string;
};

export interface RealChainLedgerSnapshot {
  schemaVersion: "1.0";
  evaluationLayer: "memory-proxy-real-chain";
  formalMetricEligible: false;
  runId: string;
  caseId: string;
  sessionId: string;
  events: readonly RealChainEvent[];
}

/**
 * Minimal append-only event ledger. It records facts only and has no dataset,
 * private Gold, terminal-tool, or scoring dependency.
 */
export class RealChainLedger {
  private readonly recorded: RealChainEvent[] = [];

  constructor(
    private readonly runId: string,
    private readonly caseId: string,
    private readonly sessionId: string,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    requireNonBlank("runId", runId);
    requireNonBlank("caseId", caseId);
    requireNonBlank("sessionId", sessionId);
  }

  append<T extends RealChainEventInput>(input: T): T & { sequence: number; observedAt: string } {
    validateEvent(input);
    const detached = detachEvidence(input);
    const event = deepFreeze({
      ...detached,
      sequence: this.recorded.length + 1,
      observedAt: requireNonBlank("observedAt", this.clock()),
    }) as unknown as T & { sequence: number; observedAt: string };
    this.recorded.push(event as unknown as RealChainEvent);
    return event;
  }

  snapshot(): RealChainLedgerSnapshot {
    return {
      schemaVersion: "1.0",
      evaluationLayer: "memory-proxy-real-chain",
      formalMetricEligible: false,
      runId: this.runId,
      caseId: this.caseId,
      sessionId: this.sessionId,
      events: Object.freeze([...this.recorded]),
    };
  }
}

export type TerminalMatcher = (
  event: RealChainEvent,
  index: number,
  events: readonly RealChainEvent[],
) => boolean;

export interface EvaluationPrefix {
  terminalMatched: boolean;
  terminalIndex: number | null;
  events: readonly RealChainEvent[];
}

export interface RealChainEntryReplayRequest {
  entryId: string;
  attemptId?: string;
  family: TdaiFamily;
  tool?: string;
  endpoint: string;
  method: string;
  requestBody?: unknown;
}

export interface RealChainEntryReplayResponse {
  status: number;
  responseBody?: unknown;
  /**
   * Receipt emitted by the entry observer after it actually saw the request.
   * Caller-declared dispatch fields are never promoted to entry facts.
   */
  receipt?: RealChainEntryReceipt;
}

export interface RealChainEntryReceipt {
  correlationId: string;
  family: TdaiFamily;
  /** Canonical RuntimeToolContract id for the observed outer entry. */
  tool?: string;
  endpoint: string;
  method: string;
  requestBody?: unknown;
  correlationHeaders?: Readonly<Record<string, string>>;
  forwardedEvidence?: RealChainForwardedEvidence;
}

export interface RealChainForwardedEvidence {
  endpoint: string;
  method: string;
  requestBody?: unknown;
}

export type RealChainEntryReplayExecutor = (
  request: Readonly<RealChainEntryReplayRequest>,
) => Promise<RealChainEntryReplayResponse>;

/** Explicit timeout signal for the evaluation observer seam. */
export class RealChainReplayTimeoutError extends Error {
  constructor(
    readonly stage: string,
    readonly budgetMs: number,
  ) {
    super(`real-chain replay timed out at ${stage} after ${budgetMs}ms`);
    this.name = "RealChainReplayTimeoutError";
  }
}

/**
 * Gold-blind observer for replaying one already-selected TDAI entry. It does
 * not decide whether the entry was correct; it only records the request and
 * classifies factual HTTP rejection separately from infrastructure outcomes.
 */
export async function replayRealChainEntry(
  ledger: RealChainLedger,
  request: RealChainEntryReplayRequest,
  execute: RealChainEntryReplayExecutor,
): Promise<RealChainEvent> {
  let stage = `dispatch:${request.family}:${request.endpoint}`;
  try {
    const detachedRequest = deepFreeze(detachEvidence(request));
    const response = await execute(detachedRequest);
    if (!response || typeof response !== "object") {
      return ledger.append({
        kind: "infrastructure_error",
        stage,
        message: "entry executor returned no response object",
        retryable: false,
      });
    }
    const receipt = validateEntryReceipt(response.receipt);
    if (!receipt) {
      return ledger.append({
        kind: "infrastructure_error",
        stage,
        message: `entry observer returned no valid receipt (status=${String(response.status)})`,
        retryable: Number.isInteger(response.status) && response.status >= 500,
        raw: response.responseBody,
      });
    }
    stage = `entry:${receipt.family}:${receipt.endpoint}`;
    ledger.append({
      kind: "tdai_entry",
      entryId: receipt.correlationId,
      attemptId: request.attemptId,
      family: receipt.family,
      tool: receipt.tool,
      endpoint: receipt.endpoint,
      method: receipt.method,
      requestBody: receipt.requestBody,
      correlationHeaders: receipt.correlationHeaders,
      forwardedEvidence: receipt.forwardedEvidence,
    });
    const status = response.status;
    if (!Number.isInteger(status)) {
      return ledger.append({
        kind: "infrastructure_error",
        stage,
        message: `entry executor returned invalid HTTP status: ${String(status)}`,
        retryable: false,
        raw: response.responseBody,
      });
    }
    if (status >= 200 && status <= 299) {
      return ledger.append({
        kind: "tdai_accepted",
        entryId: receipt.correlationId,
        family: receipt.family,
        tool: receipt.tool,
        endpoint: receipt.endpoint,
        status,
        responseBody: response.responseBody,
      });
    }
    if (status >= 400 && status <= 499) {
      // This is only a factual HTTP rejection. Measurement decides later
      // whether it is model behavior, harness invalidity, or infrastructure.
      return ledger.append({
        kind: "tdai_rejected",
        entryId: receipt.correlationId,
        attemptId: request.attemptId,
        family: receipt.family,
        tool: receipt.tool,
        endpoint: receipt.endpoint,
        status,
        reason: `HTTP ${status}`,
        responseBody: response.responseBody,
      });
    }
    return ledger.append({
      kind: "infrastructure_error",
      stage,
      message: `entry executor returned infrastructure HTTP status ${status}`,
      retryable: status >= 500,
      raw: response.responseBody,
    });
  } catch (error) {
    if (error instanceof RealChainReplayTimeoutError) {
      return ledger.append({
        kind: "timeout",
        stage: error.stage,
        budgetMs: error.budgetMs,
      });
    }
    return ledger.append({
      kind: "infrastructure_error",
      stage,
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }
}

function validateEntryReceipt(receipt: unknown): RealChainEntryReceipt | null {
  if (!receipt || Array.isArray(receipt) || typeof receipt !== "object") return null;
  const value = receipt as Record<string, unknown>;
  if (value.family !== "memory" && value.family !== "skill" && value.family !== "knowledge") return null;
  if (typeof value.correlationId !== "string" || !value.correlationId.trim()) return null;
  if (typeof value.endpoint !== "string" || !value.endpoint.trim()) return null;
  if (typeof value.method !== "string" || !value.method.trim()) return null;
  const correlationHeaders = validateCorrelationHeaders(value.correlationHeaders);
  if (value.correlationHeaders !== undefined && !correlationHeaders) return null;
  const forwardedEvidence = validateForwardedEvidence(value.forwardedEvidence);
  if (value.forwardedEvidence !== undefined && !forwardedEvidence) return null;
  const tool = resolveCanonicalReceiptTool(value.family, value.endpoint, value.method);
  if (value.tool !== undefined && (typeof value.tool !== "string" || value.tool !== tool)) return null;
  return {
    correlationId: value.correlationId,
    family: value.family,
    ...(tool ? { tool } : {}),
    endpoint: value.endpoint,
    method: value.method,
    ...(Object.prototype.hasOwnProperty.call(value, "requestBody")
      ? { requestBody: value.requestBody }
      : {}),
    ...(correlationHeaders ? { correlationHeaders } : {}),
    ...(forwardedEvidence ? { forwardedEvidence } : {}),
  };
}

function validateCorrelationHeaders(value: unknown): Record<string, string> | null {
  if (value === undefined) return null;
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [name, headerValue] of entries) {
    const normalizedName = name.toLowerCase();
    if (!CORRELATION_HEADER_ALLOWLIST.has(normalizedName)) return null;
    if (typeof headerValue !== "string" || !headerValue.trim()) return null;
    normalized[normalizedName] = headerValue;
  }
  return normalized;
}

function validateForwardedEvidence(value: unknown): RealChainForwardedEvidence | null {
  if (value === undefined) return null;
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["endpoint", "method", "requestBody"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
  if (typeof record.endpoint !== "string" || !record.endpoint.trim()) return null;
  if (typeof record.method !== "string" || !record.method.trim()) return null;
  return {
    endpoint: record.endpoint,
    method: record.method,
    ...(Object.prototype.hasOwnProperty.call(record, "requestBody")
      ? { requestBody: record.requestBody }
      : {}),
  };
}

/** Resolve a canonical tool only from an observer's actual outer entry facts. */
export function resolveCanonicalReceiptTool(
  family: TdaiFamily,
  endpoint: string,
  method: string,
): string | undefined {
  const path = normalizeObservedPath(endpoint);
  const normalizedMethod = method.toUpperCase();
  const matches = RUNTIME_TOOL_CONTRACTS.filter((contract) => (
    contract.family === family
    && contract.method === normalizedMethod
    && (contract.path === path || (family === "knowledge" && path.endsWith(contract.path)))
  ));
  return matches.length === 1 ? matches[0].id : undefined;
}

function normalizeObservedPath(endpoint: string): string {
  try {
    return new URL(endpoint).pathname;
  } catch {
    return endpoint.split(/[?#]/, 1)[0];
  }
}

/**
 * Pure metric-horizon projection. The caller supplies the terminal matcher;
 * this module therefore remains blind to private Gold and allowed sequences.
 * The ledger itself is never truncated, so post-terminal raw facts survive.
 */
export function buildEvaluationPrefix(
  events: readonly RealChainEvent[],
  terminalMatcher: TerminalMatcher,
): EvaluationPrefix {
  const terminalIndex = events.findIndex((event, index) => terminalMatcher(event, index, events));
  if (terminalIndex < 0) {
    return {
      terminalMatched: false,
      terminalIndex: null,
      events: Object.freeze([...events]),
    };
  }
  return {
    terminalMatched: true,
    terminalIndex,
    events: Object.freeze(events.slice(0, terminalIndex + 1)),
  };
}

/** R01 no-tool horizon: first material non-TDAI response or first TDAI attempt. */
export function buildNoToolEvaluationPrefix(events: readonly RealChainEvent[]): EvaluationPrefix {
  return buildEvaluationPrefix(
    events,
    (event) => event.kind === "non_tdai_response" || event.kind === "tdai_attempt",
  );
}

function validateEvent(input: RealChainEventInput): void {
  if (!input || typeof input !== "object") throw new Error("real-chain event is required");
  switch (input.kind) {
    case "tdai_attempt":
      requireNonBlank("attemptId", input.attemptId);
      if (input.disposition === "malformed" && !input.malformedReason?.trim()) {
        throw new Error("malformed TDAI attempt requires malformedReason");
      }
      return;
    case "tdai_entry":
      requireNonBlank("entryId", input.entryId);
      requireNonBlank("endpoint", input.endpoint);
      requireNonBlank("method", input.method);
      return;
    case "tdai_accepted":
      requireNonBlank("entryId", input.entryId);
      requireNonBlank("endpoint", input.endpoint);
      if (!Number.isInteger(input.status) || input.status < 200 || input.status > 299) {
        throw new Error("accepted status must be 2xx");
      }
      return;
    case "tdai_rejected":
      requireNonBlank("reason", input.reason);
      if (input.status !== undefined && (!Number.isInteger(input.status) || input.status < 400 || input.status > 499)) {
        throw new Error("rejected status must be 4xx");
      }
      return;
    case "infrastructure_error":
      requireNonBlank("stage", input.stage);
      requireNonBlank("message", input.message);
      return;
    case "timeout":
      requireNonBlank("stage", input.stage);
      validateNonNegative("budgetMs", input.budgetMs);
      return;
    case "non_tdai_response":
      requireNonBlank("text", input.text);
      return;
    case "usage":
      validateNonNegative("inputTokens", input.inputTokens);
      validateNonNegative("cachedInputTokens", input.cachedInputTokens);
      validateNonNegative("cacheWriteInputTokens", input.cacheWriteInputTokens);
      validateNonNegative("outputTokens", input.outputTokens);
      validateNonNegative("reasoningOutputTokens", input.reasoningOutputTokens);
      return;
  }
}

function validateNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
}

function requireNonBlank(name: string, value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function detachEvidence<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (err) {
    throw new Error(
      `real-chain event evidence could not be detached: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (!value || typeof value !== "object") return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
