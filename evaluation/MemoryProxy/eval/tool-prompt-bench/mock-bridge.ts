import { Hono } from "hono";
import type { EvalFixture, EvalFamily } from "./schema.js";
import type { TdaiAttempt } from "./evaluator.js";

export const TOOL_PROMPT_ENDPOINTS: Readonly<Record<string, { tool: string; family: EvalFamily }>> = {
  "/memory-bridge/v3/atomic/search": { tool: "tdai_memory_search", family: "memory" },
  "/memory-bridge/v3/atomic/query": { tool: "tdai_atomic_query", family: "memory" },
  "/memory-bridge/v3/conversation/search": { tool: "tdai_conversation_search", family: "memory" },
  "/memory-bridge/v3/conversation/query": { tool: "tdai_conversation_query", family: "memory" },
  "/memory-bridge/v3/scenario/ls": { tool: "tdai_scenario_ls", family: "memory" },
  "/memory-bridge/v3/scenario/read": { tool: "tdai_read_scene", family: "memory" },
  "/skill-bridge/v3/skill/search": { tool: "skill_search", family: "skill" },
  "/skill-bridge/v3/skill/get-by-name": { tool: "skill_view", family: "skill" },
  "/skill-bridge/v3/skill/get": { tool: "skill_view_by_id", family: "skill" },
  "/skill-bridge/v3/skill/files/read": { tool: "skill_files_read", family: "skill" },
  "/skill-bridge/v3/skill/files/download": { tool: "skill_files_download", family: "skill" },
  "/tools/list": { tool: "knowledge_tools_list", family: "knowledge" },
  "/tools/call": { tool: "knowledge_tools_call", family: "knowledge" },
};

export interface ToolPromptMockBridge {
  app: Hono;
  attempts: TdaiAttempt[];
  reset(): void;
}

export interface ToolPromptMockBridgeOptions {
  runId?: string;
  sessionId?: string;
}

function envelope(data: unknown): Record<string, unknown> {
  return { code: 0, message: "ok", request_id: "tool-prompt-bench", data };
}

function errorEnvelope(message: string): Record<string, unknown> {
  return { code: 40001, message, request_id: "tool-prompt-bench" };
}

function searchTerms(query: unknown): string[] {
  return typeof query === "string"
    ? query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 1)
    : [];
}

function textScore(value: unknown, terms: string[]): number {
  const text = JSON.stringify(value).toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function knowledgeToolRequiredFields(tool: unknown): string[] {
  if (!tool || typeof tool !== "object") return [];
  const params = (tool as Record<string, unknown>).params;
  if (!params || typeof params !== "object") return [];
  return Object.entries(params as Record<string, unknown>)
    .filter(([, definition]) => (
      definition && typeof definition === "object" && (definition as Record<string, unknown>).required === true
    ))
    .map(([field]) => field);
}

function inferTdaiEndpointMeta(endpoint: string): { tool: string; family: EvalFamily } | undefined {
  const exact = TOOL_PROMPT_ENDPOINTS[endpoint];
  if (exact) return exact;
  if (endpoint.startsWith("/memory-bridge/")) {
    return { tool: "unknown_memory_endpoint", family: "memory" };
  }
  if (endpoint.startsWith("/skill-bridge/")) {
    return { tool: "unknown_skill_endpoint", family: "skill" };
  }
  if (endpoint.startsWith("/tools/")) {
    return { tool: "unknown_knowledge_endpoint", family: "knowledge" };
  }
  return undefined;
}

export function createToolPromptMockBridge(
  fixture: EvalFixture,
  options: ToolPromptMockBridgeOptions = {},
): ToolPromptMockBridge {
  const app = new Hono();
  const attempts: TdaiAttempt[] = [];

  app.all("*", async (c) => {
    const endpoint = c.req.path;
    const meta = inferTdaiEndpointMeta(endpoint);
    const correlation = {
      intentId: c.req.header("x-tdai-eval-intent-id"),
      runId: c.req.header("x-tdai-eval-run-id") ?? options.runId,
      sessionId: c.req.header("x-tdai-eval-session-id") ?? options.sessionId,
      timestamp: new Date().toISOString(),
    };
    if (!meta) return c.json(errorEnvelope(`unsupported endpoint: ${endpoint}`), 404);
    if (!(endpoint in TOOL_PROMPT_ENDPOINTS)) {
      attempts.push({
        ...correlation,
        ...meta,
        endpoint,
        method: c.req.method,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
        status: 404,
        malformedReason: "unsupported TDAI endpoint",
      });
      return c.json(errorEnvelope(`unsupported TDAI endpoint: ${endpoint}`), 404);
    }
    if (c.req.method !== "POST") {
      attempts.push({
        ...correlation,
        ...meta,
        endpoint,
        method: c.req.method,
        status: 405,
        malformedReason: "only POST is supported",
      });
      return c.json(errorEnvelope("only POST is supported"), 405);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      const attempt: TdaiAttempt = {
        ...correlation,
        ...meta,
        endpoint,
        method: c.req.method,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
        status: 400,
        malformedReason: "invalid JSON body",
      };
      attempts.push(attempt);
      return c.json(errorEnvelope("invalid JSON body"), 400);
    }

    const attempt: TdaiAttempt = {
      ...correlation,
      ...meta,
      endpoint,
      method: c.req.method,
      body,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
    };

    const fail = (message: string, status = 400): Response => {
      const response = errorEnvelope(message);
      attempt.status = status;
      attempt.response = response;
      attempts.push(attempt);
      return c.json(response, status as 400);
    };
    if (!c.req.header("x-tdai-service-id")) return fail("x-tdai-service-id is required");
    if (meta.family !== "knowledge" && !c.req.header("x-conversation-id")) return fail("x-conversation-id is required");

    let data: unknown;
    if (endpoint === "/memory-bridge/v3/atomic/search") {
      if (typeof body.query !== "string" || !body.query) return fail("query is required");
      const terms = searchTerms(body.query);
      data = { items: [...(fixture.assets.atomicMemories ?? [])].sort((a, b) => textScore(b, terms) - textScore(a, terms)) };
    } else if (endpoint === "/memory-bridge/v3/atomic/query") {
      let items = [...(fixture.assets.atomicMemories ?? [])];
      if (typeof body.type === "string") items = items.filter((item) => item.type === body.type);
      if (typeof body.time_start === "string") items = items.filter((item) => typeof item.timestamp === "string" && item.timestamp >= body.time_start!);
      if (typeof body.time_end === "string") items = items.filter((item) => typeof item.timestamp === "string" && item.timestamp < body.time_end!);
      const offset = typeof body.offset === "number" ? body.offset : 0;
      const limit = typeof body.limit === "number" ? body.limit : 20;
      data = { items: items.slice(offset, offset + limit), total: items.length };
    } else if (endpoint === "/memory-bridge/v3/conversation/search") {
      if (typeof body.query !== "string" || !body.query) return fail("query is required");
      const terms = searchTerms(body.query);
      const messages = (fixture.assets.conversations ?? []).flatMap((session) => (
        (Array.isArray(session.messages) ? session.messages : []).map((message) => ({ session_id: session.session_id, ...message }))
      )).sort((a, b) => textScore(b, terms) - textScore(a, terms));
      data = { messages };
    } else if (endpoint === "/memory-bridge/v3/conversation/query") {
      if (typeof body.session_id !== "string" || !body.session_id) return fail("session_id is required");
      const session = fixture.assets.conversations?.find((item) => item.session_id === body.session_id);
      if (!session) return fail("session not found", 404);
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const offset = typeof body.offset === "number" ? body.offset : 0;
      const limit = typeof body.limit === "number" ? body.limit : 50;
      data = { messages: messages.slice(offset, offset + limit), total: messages.length };
    } else if (endpoint === "/memory-bridge/v3/scenario/ls") {
      const prefix = typeof body.path_prefix === "string" ? body.path_prefix : "";
      data = { items: (fixture.assets.scenes ?? []).filter((scene) => typeof scene.path === "string" && scene.path.startsWith(prefix)).map(({ content: _content, ...scene }) => scene) };
    } else if (endpoint === "/memory-bridge/v3/scenario/read") {
      if (typeof body.path !== "string" || !body.path) return fail("path is required");
      const scene = fixture.assets.scenes?.find((item) => (
        item.path === body.path && (item.agent_id === undefined || item.agent_id === body.agent_id)
      ));
      if (!scene) return fail("scene not found", 404);
      data = scene;
    } else if (endpoint === "/skill-bridge/v3/skill/search") {
      if (typeof body.query !== "string" || !body.query) return fail("query is required");
      const terms = searchTerms(body.query);
      data = { items: [...(fixture.assets.skills?.teamLibrary ?? [])].sort((a, b) => textScore(b, terms) - textScore(a, terms)) };
    } else if (endpoint === "/skill-bridge/v3/skill/get-by-name") {
      if (typeof body.skill_name !== "string" || !body.skill_name) return fail("skill_name is required");
      const skill = fixture.assets.skills?.teamLibrary.find((item) => item.name === body.skill_name);
      if (!skill) return fail("skill not found", 404);
      data = skill;
    } else if (endpoint === "/skill-bridge/v3/skill/get") {
      if (typeof body.skill_id !== "string" || !body.skill_id) return fail("skill_id is required");
      const skill = fixture.assets.skills?.teamLibrary.find((item) => item.skill_id === body.skill_id);
      if (!skill) return fail("skill not found", 404);
      data = skill;
    } else if (endpoint === "/skill-bridge/v3/skill/files/read") {
      if (typeof body.skill_id !== "string" || typeof body.path !== "string") return fail("skill_id and path are required");
      const skill = fixture.assets.skills?.teamLibrary.find((item) => item.skill_id === body.skill_id);
      const files = skill?.files && typeof skill.files === "object" ? skill.files as Record<string, unknown> : {};
      if (!(body.path in files)) return fail("skill file not found", 404);
      data = files[body.path];
    } else if (endpoint === "/skill-bridge/v3/skill/files/download") {
      if (typeof body.skill_id !== "string" || typeof body.path !== "string") return fail("skill_id and path are required");
      const skill = fixture.assets.skills?.teamLibrary.find((item) => item.skill_id === body.skill_id);
      const files = skill?.files && typeof skill.files === "object" ? skill.files as Record<string, unknown> : {};
      if (!(body.path in files)) return fail("skill file not found", 404);
      const file = files[body.path];
      const content = typeof file === "string"
        ? file
        : file && typeof file === "object" && typeof (file as Record<string, unknown>).content === "string"
          ? (file as Record<string, unknown>).content as string
          : null;
      if (content === null) return fail("skill file content is not downloadable", 422);
      attempt.status = 200;
      attempt.response = { bytes: Buffer.byteLength(content, "utf8") };
      attempts.push(attempt);
      return c.body(content, 200, { "content-type": "application/octet-stream" });
    } else if (endpoint === "/tools/list") {
      if (typeof body.knowledge_id !== "string" || !body.knowledge_id) return fail("knowledge_id is required");
      const resource = fixture.assets.knowledge?.find((item) => item.knowledge_id === body.knowledge_id);
      if (!resource) return fail("knowledge resource not found", 404);
      data = resource;
    } else {
      if (typeof body.knowledge_id !== "string" || typeof body.tool_name !== "string" || !body.params || typeof body.params !== "object") {
        return fail("knowledge_id, tool_name, and params are required");
      }
      const resource = fixture.assets.knowledge?.find((item) => item.knowledge_id === body.knowledge_id);
      if (!resource) return fail("knowledge resource not found", 404);
      const tool = Array.isArray(resource.tools)
        ? resource.tools.find((candidate) => candidate && typeof candidate === "object" && candidate.name === body.tool_name)
        : undefined;
      if (!tool) return fail("knowledge tool not found", 403);
      const params = body.params as Record<string, unknown>;
      for (const field of knowledgeToolRequiredFields(tool)) if (!(field in params)) return fail(`${field} is required`);
      if (body.tool_name === "search" && resource.type === "wiki") {
        data = { results: [{ ref: `${resource.knowledge_id}/design.md`, title: String(resource.name), snippet: String(resource.summary ?? "") }] };
      } else if (body.tool_name === "read_page") {
        data = { items: (params.refs as unknown[]).map((ref) => ({ ref, content: String(resource.summary ?? resource.name) })) };
      } else {
        data = { tool_name: body.tool_name, matches: [{ source: String(resource.repo_slug ?? resource.name) }] };
      }
    }

    const response = envelope(data);
    attempt.status = 200;
    attempt.response = response;
    attempts.push(attempt);
    return c.json(response);
  });

  return {
    app,
    attempts,
    reset(): void {
      attempts.length = 0;
    },
  };
}
