import { createHash } from "node:crypto";
import {
  buildCodexConfigArgs,
  buildCodexInvocation,
  countInjectionTokens,
  isolateCodexEnvironment,
  type CodexInvocation,
  type CodexReasoningEffort,
  type CodexVerbosity,
} from "./codex-runner.js";
import {
  CODEX_HISTORY_TRANSPORT_HEADER,
  USER_PLANE_HISTORY_ENVELOPE_TYPE,
  USER_PLANE_HISTORY_TRANSPORT_V1,
  buildCodexNativeHistoryMessages,
  parseUserPlaneHistoryEnvelope,
} from "../../../../implementations/final/MemoryProxy/src/common/codex-history-transport.js";

export { USER_PLANE_HISTORY_TRANSPORT_V1 } from "../../../../implementations/final/MemoryProxy/src/common/codex-history-transport.js";

export const REAL_CHAIN_RUN_MODE = "memory-proxy-real-chain" as const;
export const REAL_CHAIN_TDAI_USER_KEY_ENV = "TDAI_EVAL_USER_KEY" as const;

export interface RealChainIdentity {
  spaceId: string;
  sessionId: string;
  teamId: string;
  agentId: string;
  taskId?: string;
}

export interface RealChainHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Gold-blind boundary consumed by R01. Dataset split, snapshots, expected
 * tools, terminal rules, and scoring intentionally do not belong here.
 */
export interface NormalizedRealChainInput {
  identity: RealChainIdentity;
  history: readonly RealChainHistoryMessage[];
  finalQuery: string;
}

export interface RealChainUserPromptTransport {
  readonly id: string;
  serialize(input: Pick<NormalizedRealChainInput, "history" | "finalQuery">): string;
}

/**
 * Codex 0.149.1 cannot preload arbitrary native messages into `exec`. The CLI
 * therefore carries one deterministic envelope to MemoryProxy, which expands
 * it into native Responses API history before production injection/forwarding.
 */
export const userPlaneHistoryEnvelopeV1: RealChainUserPromptTransport = {
  id: USER_PLANE_HISTORY_TRANSPORT_V1,
  serialize(input): string {
    return JSON.stringify({
      type: USER_PLANE_HISTORY_ENVELOPE_TYPE,
      version: 1,
      history: input.history.map((message, index) => ({
        ...(validateHistoryMessage(message, index)),
      })),
      finalQuery: requireContent("finalQuery", input.finalQuery),
    });
  },
};

export interface RealChainProviderMessage {
  type: "message";
  role: "user";
  content: Array<{ type: "input_text"; text: string }>;
}

export function buildRealChainProviderInput(
  input: Pick<NormalizedRealChainInput, "history" | "finalQuery">,
  transport: RealChainUserPromptTransport = userPlaneHistoryEnvelopeV1,
): RealChainProviderMessage[] {
  const text = transport.serialize(input);
  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}

export interface PrepareRealChainRunInput {
  proxyBaseUrl: string;
  input: NormalizedRealChainInput;
  workspaceDir: string;
  authenticatedCodexHome: string;
  isolatedHome: string;
  /** Injectable for tests; production callers normally leave this undefined. */
  environmentSource?: NodeJS.ProcessEnv;
  model: string;
  reasoningEffort: CodexReasoningEffort;
  verbosity: CodexVerbosity;
  tdaiUserKeyEnv?: string;
}

export interface PreparedRealChainRun {
  invocation: CodexInvocation;
  /** Subprocess-only environment. Never serialize this object as an artifact. */
  environment: NodeJS.ProcessEnv;
  stdin: string;
  providerInput: RealChainProviderMessage[];
  providerBaseUrl: string;
  providerHeaders: Record<string, string>;
  providerEnvHeaders: Record<string, string>;
  manifest: {
    schemaVersion: "1.0";
    evaluationLayer: typeof REAL_CHAIN_RUN_MODE;
    formalMetricEligible: false;
    readiness: "adapter-only";
    injectionOwner: "memory-proxy-production-pipeline";
    sessionInitMode: "validated-header-auto-select";
    historyTransport: typeof USER_PLANE_HISTORY_TRANSPORT_V1;
    historyMessageCount: number;
    userPromptSha256: string;
    model: string;
    reasoningEffort: CodexReasoningEffort;
    verbosity: CodexVerbosity;
    identity: RealChainIdentity;
    providerBaseUrl: string;
    tdaiUserKeyEnvironment: string;
    authenticationMode: "shared-codex-home-no-copy";
    isolatedUserHome: string;
    developerInstructionsInjectedByRunner: false;
    mockContractBypassEnabled: false;
  };
}

export interface RealChainTransport {
  request(path: string, init: RequestInit): Promise<Response>;
}

export class HttpRealChainTransport implements RealChainTransport {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  request(path: string, init: RequestInit): Promise<Response> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return this.fetcher(`${this.baseUrl}${normalizedPath}`, init);
  }
}

export interface RealChainProbeInput {
  input: NormalizedRealChainInput;
  model: string;
  /** Provider credential forwarded to the capture upstream. Never persisted. */
  providerAuthorization: string;
  /** TDAI credential consumed by MemoryProxy. Never persisted. */
  tdaiUserKey: string;
}

export interface RealChainProbeResult {
  status: number;
  contentType: string | null;
  userPromptSha256: string;
}

export interface CapturedRealChainAudit {
  wrapperCount: 1;
  injectionSha256: string;
  injectionTokenEncoding: "o200k_base";
  injectionTokenCount: number;
  injectionCharacterCount: number;
  injectionUtf8ByteCount: number;
  hasSessionContext: boolean;
  toolFamilies: Array<"memory" | "skill" | "knowledge">;
  userPromptCount: 1;
  userPromptSha256: string;
}

export class RealChainAdapter {
  constructor(
    private readonly transport?: RealChainTransport,
    private readonly userPromptTransport: RealChainUserPromptTransport = userPlaneHistoryEnvelopeV1,
  ) {}

  prepareCodexRun(input: PrepareRealChainRunInput): PreparedRealChainRun {
    const normalizedInput = validateStandardInput(input.input);
    const model = requireText("model", input.model);
    const workspaceDir = requireText("workspaceDir", input.workspaceDir);
    const authenticatedCodexHome = requireText("authenticatedCodexHome", input.authenticatedCodexHome);
    const isolatedHome = requireText("isolatedHome", input.isolatedHome);
    const tdaiUserKeyEnvironment = validateEnvironmentName(
      input.tdaiUserKeyEnv ?? REAL_CHAIN_TDAI_USER_KEY_ENV,
    );
    if (this.userPromptTransport.id !== USER_PLANE_HISTORY_TRANSPORT_V1) {
      throw new Error(`unsupported real-chain history transport: ${this.userPromptTransport.id}`);
    }
    const providerInput = buildRealChainProviderInput(normalizedInput, this.userPromptTransport);
    const stdin = providerInput[0].content[0].text;
    const providerBaseUrl = buildMemoryProxyCodexBaseUrl(input.proxyBaseUrl, normalizedInput.identity.spaceId);
    const providerHeaders = buildRealChainIdentityHeaders(normalizedInput.identity);
    const providerEnvHeaders = { "x-tdai-user-key": tdaiUserKeyEnvironment };
    const configArgs = buildCodexConfigArgs({
      providerBaseUrl,
      providerHeaders,
      providerEnvHeaders,
      reasoningEffort: input.reasoningEffort,
      verbosity: input.verbosity,
    });

    const serializedArgs = configArgs.join("\n");
    if (/developer_instructions=|x-tdai-eval-mode|mock-contract/i.test(serializedArgs)) {
      throw new Error("real-chain Codex config contains runner-owned injection or Mock bypass");
    }

    return {
      invocation: buildCodexInvocation({ workspaceDir, model, configArgs }),
      environment: isolateCodexEnvironment(
        input.environmentSource ?? process.env,
        authenticatedCodexHome,
        isolatedHome,
      ),
      stdin,
      providerInput,
      providerBaseUrl,
      providerHeaders,
      providerEnvHeaders,
      manifest: {
        schemaVersion: "1.0",
        evaluationLayer: REAL_CHAIN_RUN_MODE,
        formalMetricEligible: false,
        readiness: "adapter-only",
        injectionOwner: "memory-proxy-production-pipeline",
        sessionInitMode: "validated-header-auto-select",
        historyTransport: USER_PLANE_HISTORY_TRANSPORT_V1,
        historyMessageCount: normalizedInput.history.length,
        userPromptSha256: sha256(stdin),
        model,
        reasoningEffort: input.reasoningEffort,
        verbosity: input.verbosity,
        identity: normalizedInput.identity,
        providerBaseUrl,
        tdaiUserKeyEnvironment,
        authenticationMode: "shared-codex-home-no-copy",
        isolatedUserHome: isolatedHome,
        developerInstructionsInjectedByRunner: false,
        mockContractBypassEnabled: false,
      },
    };
  }

  /**
   * No-model production preflight. It stops at a capture upstream and does not
   * synthesize a model decision or claim an entry call occurred.
   */
  async probeProductionChain(input: RealChainProbeInput): Promise<RealChainProbeResult> {
    if (!this.transport) throw new Error("real-chain probe requires a transport");
    const normalizedInput = validateStandardInput(input.input);
    const model = requireText("model", input.model);
    const providerAuthorization = requireText("providerAuthorization", input.providerAuthorization);
    const tdaiUserKey = requireText("tdaiUserKey", input.tdaiUserKey);
    const providerInput = buildRealChainProviderInput(normalizedInput, this.userPromptTransport);
    const userPrompt = providerInput[0].content[0].text;
    const path = `/codex/${encodeURIComponent(normalizedInput.identity.spaceId)}/v1/responses`;
    const headers = {
      ...buildRealChainIdentityHeaders(normalizedInput.identity),
      authorization: providerAuthorization,
      "x-tdai-user-key": tdaiUserKey,
      "content-type": "application/json",
    };
    const body = {
      model,
      stream: false,
      store: false,
      input: [
        {
          type: "message",
          role: "developer",
          content: [],
        },
        ...providerInput,
      ],
      client_metadata: { session_id: normalizedInput.identity.sessionId },
    };

    const response = await this.transport.request(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      userPromptSha256: sha256(userPrompt),
    };
  }
}

export function buildMemoryProxyCodexBaseUrl(proxyBaseUrl: string, spaceId: string): string {
  const base = normalizeBaseUrl(proxyBaseUrl);
  return `${base}/codex/${encodeURIComponent(validateIdentifier("spaceId", spaceId))}/v1`;
}

export function buildRealChainIdentityHeaders(identityInput: RealChainIdentity): Record<string, string> {
  const identity = validateIdentity(identityInput);
  return {
    "session-id": identity.sessionId,
    "x-team-id": identity.teamId,
    "x-agent-id": identity.agentId,
    ...(identity.taskId ? { "x-task-id": identity.taskId } : {}),
    [CODEX_HISTORY_TRANSPORT_HEADER]: USER_PLANE_HISTORY_TRANSPORT_V1,
  };
}

/** Audit the provider-visible request captured after production injection. */
export function auditCapturedRealChainRequest(
  body: unknown,
  expectedUserPrompt?: string,
): CapturedRealChainAudit {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    throw new Error("captured real-chain body must be a JSON object");
  }
  const input = (body as Record<string, unknown>).input;
  if (!Array.isArray(input)) throw new Error("captured real-chain body is missing input[]");
  const instructionTextParts = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = (item as Record<string, unknown>).role;
    return role === "developer" || role === "system" ? extractMessageTexts(item) : [];
  });
  const instructions = (body as Record<string, unknown>).instructions;
  if (typeof instructions === "string") instructionTextParts.push(instructions);
  const injections = instructionTextParts.filter((text) => text.startsWith("<tdai_injections>"));
  if (injections.length !== 1) {
    throw new Error(`captured real-chain request must contain exactly one TDAI wrapper; got ${injections.length}`);
  }
  const runnerOwnedTdaiText = instructionTextParts
    .filter((text) => !text.startsWith("<tdai_injections>"))
    .find((text) => /<tdai_memory_tools>|<memory-tools-guide>|<tdai_profile_memory>|<skill_tools>|<available_skills>|<knowledge_tools>/.test(text));
  if (runnerOwnedTdaiText) {
    throw new Error("captured real-chain request contains TDAI prompt text outside the production wrapper");
  }
  if (expectedUserPrompt === undefined) {
    throw new Error("captured real-chain audit requires the frozen user-plane prompt");
  }
  let expectedEnvelope: unknown = null;
  try {
    expectedEnvelope = JSON.parse(expectedUserPrompt);
  } catch {
    // Non-envelope prompts remain supported for legacy evidence fixtures and
    // non-formal callers. Formal Task 1 inputs always use the typed envelope.
  }
  const isHistoryEnvelope = expectedEnvelope
    && typeof expectedEnvelope === "object"
    && !Array.isArray(expectedEnvelope)
    && (expectedEnvelope as Record<string, unknown>).type === USER_PLANE_HISTORY_ENVELOPE_TYPE;
  if (isHistoryEnvelope) {
    const expectedMessages = buildCodexNativeHistoryMessages(
      parseUserPlaneHistoryEnvelope(expectedEnvelope),
    );
    const observedMessages = input.flatMap((item) => {
      if (!item || Array.isArray(item) || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (record.role !== "user" && record.role !== "assistant") return [];
      const texts = extractMessageTexts(item);
      return texts.length === 1 ? [{ role: record.role, text: texts[0] }] : [];
    });
    const expectedConversation = expectedMessages.map((message) => ({
      role: message.role,
      text: message.content[0]!.text,
    }));
    if (JSON.stringify(observedMessages.slice(0, expectedConversation.length)) !== JSON.stringify(expectedConversation)) {
      throw new Error("captured real-chain native history does not match the frozen user-plane prompt");
    }
  } else {
    const userPrompts = input.flatMap((item) => {
      if (!item || typeof item !== "object" || (item as Record<string, unknown>).role !== "user") return [];
      return extractMessageTexts(item);
    });
    if (userPrompts.length !== 1 || userPrompts[0] !== expectedUserPrompt) {
      throw new Error("captured real-chain user-plane prompt changed before the provider boundary");
    }
  }
  const injection = injections[0];
  const toolFamilies: CapturedRealChainAudit["toolFamilies"] = [];
  if (/<tdai_memory_tools>|<memory-tools-guide>|<tdai_profile_memory>/.test(injection)) toolFamilies.push("memory");
  if (/<skill_tools>|<available_skills>/.test(injection)) toolFamilies.push("skill");
  if (/<knowledge_tools>/.test(injection)) toolFamilies.push("knowledge");
  return {
    wrapperCount: 1,
    injectionSha256: sha256(injection),
    injectionTokenEncoding: "o200k_base",
    injectionTokenCount: countInjectionTokens(injection),
    injectionCharacterCount: injection.length,
    injectionUtf8ByteCount: Buffer.byteLength(injection, "utf8"),
    hasSessionContext: injection.includes("<session_context>"),
    toolFamilies,
    userPromptCount: 1,
    userPromptSha256: sha256(expectedUserPrompt),
  };
}

/** Return only the production-owned provider-visible TDAI wrapper after audit. */
export function extractCapturedRealChainInjection(body: unknown): string {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    throw new Error("captured real-chain body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  const input = record.input;
  if (!Array.isArray(input)) throw new Error("captured real-chain body is missing input[]");
  const instructionTextParts = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = (item as Record<string, unknown>).role;
    return role === "developer" || role === "system" ? extractMessageTexts(item) : [];
  });
  if (typeof record.instructions === "string") instructionTextParts.push(record.instructions);
  const injections = instructionTextParts.filter((text) => text.startsWith("<tdai_injections>"));
  if (injections.length !== 1) {
    throw new Error(
      `captured real-chain request must contain exactly one TDAI wrapper; got ${injections.length}`,
    );
  }
  const runnerOwnedTdaiText = instructionTextParts
    .filter((text) => !text.startsWith("<tdai_injections>"))
    .find((text) => /<tdai_memory_tools>|<memory-tools-guide>|<tdai_profile_memory>|<skill_tools>|<available_skills>|<knowledge_tools>/.test(text));
  if (runnerOwnedTdaiText) {
    throw new Error("captured real-chain request contains TDAI prompt text outside the production wrapper");
  }
  return injections[0];
}

function extractMessageTexts(item: unknown): string[] {
  if (!item || typeof item !== "object") return [];
  const content = (item as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => (
    part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
      ? [(part as Record<string, unknown>).text as string]
      : []
  ));
}

function validateStandardInput(input: NormalizedRealChainInput): NormalizedRealChainInput {
  if (!input || typeof input !== "object") throw new Error("real-chain input is required");
  if (!Array.isArray(input.history)) throw new Error("history must be an array");
  return {
    identity: validateIdentity(input.identity),
    history: input.history.map((message, index) => validateHistoryMessage(message, index)),
    finalQuery: requireContent("finalQuery", input.finalQuery),
  };
}

function validateHistoryMessage(message: unknown, index: number): RealChainHistoryMessage {
  if (!message || Array.isArray(message) || typeof message !== "object") {
    throw new Error(`history[${index}] must be an object`);
  }
  const record = message as Record<string, unknown>;
  return {
    role: validateHistoryRole(record.role),
    content: requireContent(`history[${index}].content`, record.content),
  };
}

function validateHistoryRole(role: unknown): RealChainHistoryMessage["role"] {
  if (role !== "user" && role !== "assistant") {
    throw new Error(`unsupported history role: ${String(role)}`);
  }
  return role;
}

function validateIdentity(input: RealChainIdentity): RealChainIdentity {
  if (!input || typeof input !== "object") throw new Error("identity is required");
  return {
    spaceId: validateIdentifier("spaceId", input.spaceId),
    sessionId: validateIdentifier("sessionId", input.sessionId),
    teamId: validateIdentifier("teamId", input.teamId),
    agentId: validateIdentifier("agentId", input.agentId),
    ...(Object.prototype.hasOwnProperty.call(input, "taskId")
      ? { taskId: validateIdentifier("taskId", input.taskId as string) }
      : {}),
  };
}

function validateIdentifier(name: string, value: string): string {
  const normalized = requireText(name, value);
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return normalized;
}

function validateEnvironmentName(value: string): string {
  const normalized = requireText("tdaiUserKeyEnv", value);
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(normalized)) {
    throw new Error("tdaiUserKeyEnv must be a valid environment variable name");
  }
  return normalized;
}

function requireText(name: string, value: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireContent(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function normalizeBaseUrl(value: string): string {
  const normalized = requireText("baseUrl", value).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("baseUrl must be an absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must use HTTP or HTTPS");
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
