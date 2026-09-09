import { createHash } from "node:crypto";
import type { V2RouterDeps } from "./v2-router.js";
import type { ApiResponseEnvelope, V2AuthContext } from "./v2-schemas.js";
import type { MemoryRecord, MemoryType } from "../core/record/l1-writer.js";
import type { L0Record } from "../core/store/types.js";

const memoryTypes = new Set<MemoryType>([
  "persona", "episodic", "instruction", "work_fact", "work_task", "work_method", "work_artifact",
]);

/** Explicit restore-only endpoint; never enabled on ordinary Core startup. */
export function makeFinal5MemoryImportRoutes(enabled = process.env.FINAL5_ASSET_IMPORT === "1") {
  return enabled ? { "/v3/formal-bench/import-memory": importFinal5Memory } : {};
}

export async function importFinal5Memory(
  body: unknown, _auth: V2AuthContext, requestId: string, deps: V2RouterDeps,
): Promise<ApiResponseEnvelope> {
  const fail = (code: number, message: string): ApiResponseEnvelope => ({ code, message, request_id: requestId });
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Expected restore object");
  const value = body as Record<string, unknown>;
  const kind = value.kind ?? (value.layer === "l1" ? "l1" : undefined);
  const formalId = typeof value.formal_asset_id === "string" ? value.formal_asset_id : value.id;
  const expectedHash = value.expected_asset_content_hash ?? value.content_sha256;
  const teamId = value.team_id;
  const agentId = value.agent_id;
  const userId = value.user_id;
  if (typeof formalId !== "string" || !formalId.trim() || typeof expectedHash !== "string"
    || typeof teamId !== "string" || typeof agentId !== "string" || typeof userId !== "string") {
    return fail(400, "Missing restore identity or asset hash");
  }
  const payload = value.payload && typeof value.payload === "object" ? value.payload as Record<string, any> : value;
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : payload.session_id;
  if (kind === "l0") {
    if (typeof sessionId !== "string" || !Array.isArray(payload.messages) || payload.messages.length === 0) return fail(400, "Invalid L0 payload");
    const digest = createHash("sha256").update(JSON.stringify({ sessionId, messages: payload.messages.map((message: any) => ({ role: message.role, content: message.content })) })).digest("hex");
    if (digest !== expectedHash) return fail(400, "Memory L0 content digest mismatch");
    const store = deps.getStore();
    if (!store) return fail(503, "Store unavailable");
    const acceptedIds: string[] = [];
    for (const [index, message] of payload.messages.entries()) {
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || !message.content) return fail(400, "Invalid L0 message");
      const record: L0Record = { id: `${formalId}:${index + 1}`, sessionKey: sessionId, sessionId, teamId: teamId as string, agentId: agentId as string, userId: userId as string, role: message.role, messageText: message.content, recordedAt: new Date().toISOString(), timestamp: Date.now() + index };
      await store.upsertL0(record, undefined);
      acceptedIds.push(record.id);
    }
    return { code: 0, message: "ok", request_id: requestId, data: { kind: "l0", formal_asset_id: formalId, expected_asset_content_hash: expectedHash, content_sha256: digest, runtime_locator: { kind: "conversation", sessionId, messageIds: acceptedIds }, accepted_ids: acceptedIds, verified: true } };
  }
  if (kind !== "l1" || typeof payload.content !== "string" || !memoryTypes.has(payload.memory_type as MemoryType)) return fail(400, "Unsupported Memory layer/type");
  const content = payload.content as string;
  // Matches the frozen restore bundle's JSON-string digest convention.
  const contentSha256 = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  if (contentSha256 !== expectedHash) return fail(400, "Memory content digest mismatch");
  const store = deps.getStore();
  if (!store) return fail(503, "Store unavailable");
  const id = formalId as string;
  const matches = (row: Record<string, unknown>) => row.record_id === id && row.content === content
    && row.type === payload.memory_type && row.team_id === teamId && row.agent_id === agentId && row.user_id === userId;
  const existing = await store.queryL1Records({ recordIds: [id] });
  if (existing.length > 0 && (existing.length !== 1 || !matches(existing[0] as unknown as Record<string, unknown>))) {
    return fail(409, "Existing Memory differs from requested restore; refusing overwrite");
  }
  if (existing.length === 0) {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id, content, type: payload.memory_type as MemoryType, priority: 50, scene_name: "",
      source_message_ids: [], metadata: {}, timestamps: [now], createdAt: now, updatedAt: now,
      version: 1, sessionKey: (sessionId as string | undefined) ?? "final5-restore", sessionId: (sessionId as string | undefined) ?? "final5-restore",
      teamId: teamId as string, agentId: agentId as string, userId: userId as string,
    };
    const embedding = deps.getEmbedding();
    // An embedding failure must not silently produce a different search corpus.
    const vector = embedding ? await embedding.embed(content) : undefined;
    if (!await store.upsertL1(record, vector)) return fail(500, "Memory restore write failed");
  }
  const restored = await store.queryL1Records({ recordIds: [id] });
  if (restored.length !== 1 || !matches(restored[0] as unknown as Record<string, unknown>)) {
    return fail(500, `Memory restore readback failed: ${JSON.stringify(restored[0] ?? null)}`);
  }
  return { code: 0, message: "ok", request_id: requestId, data: {
    kind: "l1", formal_asset_id: id, expected_asset_content_hash: expectedHash, id, content_sha256: contentSha256, verified: true, reused: existing.length === 1,
  } };
}
