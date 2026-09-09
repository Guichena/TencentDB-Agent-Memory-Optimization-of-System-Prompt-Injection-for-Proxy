export const CODEX_HISTORY_TRANSPORT_HEADER = "x-tdai-history-transport" as const;
export const USER_PLANE_HISTORY_TRANSPORT_V1 = "user-plane-envelope-v1" as const;
export const USER_PLANE_HISTORY_ENVELOPE_TYPE = "task1_user_history_envelope" as const;

export interface CodexHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface UserPlaneHistoryEnvelopeV1 {
  type: typeof USER_PLANE_HISTORY_ENVELOPE_TYPE;
  version: 1;
  history: CodexHistoryMessage[];
  finalQuery: string;
}

export interface CodexNativeHistoryMessage {
  type: "message";
  role: "user" | "assistant";
  content: Array<{ type: "input_text"; text: string }>;
}

/**
 * Expand the opt-in Task 1 stdin envelope into Responses API message items.
 * Requests without the transport header remain byte-for-byte unchanged.
 */
export function expandCodexHistoryTransport(
  body: Record<string, unknown>,
  requestedTransport: string | undefined,
): Record<string, unknown> {
  if (requestedTransport === undefined) return body;
  if (requestedTransport !== USER_PLANE_HISTORY_TRANSPORT_V1) {
    throw new Error(`unsupported Codex history transport: ${requestedTransport}`);
  }
  if (!Array.isArray(body.input)) {
    throw new Error("Codex history transport requires body.input[]");
  }

  const matches = body.input.flatMap((item, index) => {
    const text = exactUserInputText(item);
    if (text === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    if (!isHistoryEnvelopeMarker(parsed)) return [];
    return [{ index, envelope: parseUserPlaneHistoryEnvelope(parsed) }];
  });
  // Codex sends follow-up Responses requests for tool loops with no new
  // user message. The provider header is inherited by those requests, but
  // the first-turn envelope must not be required again. A request that does
  // contain user input still must carry exactly one envelope.
  if (matches.length === 0 && !body.input.some((item) => exactUserInputText(item) !== null)) {
    return body;
  }
  if (matches.length !== 1) {
    throw new Error(`Codex history transport requires exactly one history envelope; got ${matches.length}`);
  }

  const match = matches[0]!;
  return {
    ...body,
    input: [
      ...body.input.slice(0, match.index),
      ...buildCodexNativeHistoryMessages(match.envelope),
      ...body.input.slice(match.index + 1),
    ],
  };
}

export function parseUserPlaneHistoryEnvelope(value: unknown): UserPlaneHistoryEnvelopeV1 {
  if (!isHistoryEnvelopeMarker(value)) {
    throw new Error("invalid Task 1 user history envelope marker");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.history)) {
    throw new Error("Task 1 user history envelope history must be an array");
  }
  return {
    type: USER_PLANE_HISTORY_ENVELOPE_TYPE,
    version: 1,
    history: record.history.map((message, index) => parseHistoryMessage(message, index)),
    finalQuery: requireContent("finalQuery", record.finalQuery),
  };
}

export function buildCodexNativeHistoryMessages(
  envelope: UserPlaneHistoryEnvelopeV1,
): CodexNativeHistoryMessage[] {
  return [
    ...envelope.history.map(toNativeMessage),
    toNativeMessage({ role: "user", content: envelope.finalQuery }),
  ];
}

function exactUserInputText(value: unknown): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type !== "message" || message.role !== "user" || !Array.isArray(message.content)) return null;
  if (message.content.length !== 1) return null;
  const part = message.content[0];
  if (!part || Array.isArray(part) || typeof part !== "object") return null;
  const content = part as Record<string, unknown>;
  return content.type === "input_text" && typeof content.text === "string" ? content.text : null;
}

function isHistoryEnvelopeMarker(value: unknown): boolean {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === USER_PLANE_HISTORY_ENVELOPE_TYPE && record.version === 1;
}

function parseHistoryMessage(value: unknown, index: number): CodexHistoryMessage {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Task 1 user history envelope history[${index}] must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.role !== "user" && record.role !== "assistant") {
    throw new Error(`Task 1 user history envelope history[${index}] has an invalid role`);
  }
  return {
    role: record.role,
    content: requireContent(`history[${index}].content`, record.content),
  };
}

function toNativeMessage(message: CodexHistoryMessage): CodexNativeHistoryMessage {
  return {
    type: "message",
    role: message.role,
    content: [{ type: "input_text", text: message.content }],
  };
}

function requireContent(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
