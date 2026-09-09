import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { installFinal5SkillPool } from "./final5-skill-pool.js";
import { decodeFrozenSkillCatalog } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";

export const CAPTURE_HOOK = Symbol.for("task1.final5.http-capture.v1");
export interface CaptureEvent {
  type: string; id: string; sessionId: string; timestamp: string;
  parentId?: string; path?: string; method?: string; body?: unknown; rawBody?: string;
  status?: number; contentType?: string; durationMs?: number; providerRequestId?: string | null;
  streamOutcome?: "eof" | "cancelled" | "error"; firstContentDurationMs?: number;
}
type Context = { id: string; sessionId: string; path: string; bound: boolean;
  frozenSkills?: Array<{ runtimeName: string; description: string }> };
const toolPath = (path: string) => /^\/(memory-bridge|skill-bridge|tools)\//u.test(path);
const providerPath = (path: string) => /\/(responses|messages|chat\/completions)$/u.test(path);
export const sessionCapturePath = (directory: string, sessionId: string) => join(directory, "session-" + createHash("sha256").update(sessionId).digest("hex") + ".jsonl");
const parseBody = (text: string): unknown => { try { return JSON.parse(text); } catch { return text; } };

export function appendFinal5CaptureEvent(directory: string, event: CaptureEvent, secrets: readonly string[] = []): void {
  let line = JSON.stringify(event);
  for (const secret of secrets) line = line.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
  appendFileSync(sessionCapturePath(directory, event.sessionId), line + "\n");
}

export function isFinal5TitleRequest(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  if (Array.isArray(value.tools) && value.tools.length > 0) return false;
  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== "user") return false;
  return JSON.stringify(messages[0].content).includes("Write the title in the predominant language of the session");
}

/** Opt-in, shared passive observer. One incoming bridge attempt may fan out to many Core requests. */
export function createHttpCapture(sink: (event: CaptureEvent) => void, fetchImpl: typeof fetch, verifyInputs = false) {
  const context = new AsyncLocalStorage<Context>();
  function record(type: string, ctx: Context, extra: Partial<CaptureEvent> = {}) {
    sink({ type, id: ctx.id, sessionId: ctx.sessionId, timestamp: new Date().toISOString(), ...extra });
  }
  function observeResponse(response: Response, ctx: Context, type: string, start: number): Response {
    const chunks: Buffer[] = [];
    let finished = false;
    let firstContentDurationMs: number | undefined;
    const finish = (streamOutcome: "eof" | "cancelled" | "error" = "eof") => {
      if (finished) return;
      finished = true;
      record(type, ctx, { streamOutcome, status: response.status, contentType: response.headers.get("content-type") ?? "",
      rawBody: Buffer.concat(chunks).toString("utf8"), durationMs: performance.now() - start,
      ...(firstContentDurationMs !== undefined ? { firstContentDurationMs } : {}),
      providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") });
    };
    if (!response.body) { finish(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { finish(); controller.close(); return; }
          if (firstContentDurationMs === undefined && next.value.byteLength > 0) firstContentDurationMs = performance.now() - start;
          chunks.push(Buffer.from(next.value));
          controller.enqueue(next.value);
        } catch (error) { finish("error"); controller.error(error); }
      },
      async cancel(reason) { finish("cancelled"); await reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const capturedFetch: typeof fetch = async (input, init) => {
    const ctx = context.getStore();
    if (!ctx) return fetchImpl(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    const expectedCorePath = ctx.path.replace(/^\/(memory-bridge|skill-bridge)/u, "");
    if (toolPath(ctx.path) && url.pathname.endsWith(expectedCorePath) && !ctx.bound) {
      ctx.bound = true;
      record("tool.bound", ctx);
    }
    const body = typeof init?.body === "string" ? parseBody(init.body) : input instanceof Request ? parseBody(await input.clone().text()) : undefined;
    const isProvider = body !== null && typeof body === "object" && "model" in body && providerPath(url.pathname);
    if (!isProvider) return fetchImpl(input, init);
    const requestBody = body as Record<string, unknown>;
    const isProbe = JSON.stringify(requestBody.tools ?? []).includes("eval_protocol_probe");
    if (verifyInputs && ctx.frozenSkills && !isFinal5TitleRequest(requestBody) && (requestBody.stream === true || isProbe)) {
      assertFinal5InjectedInput(requestBody, ctx.frozenSkills);
    }
    const request = { ...ctx, id: randomUUID() };
    const start = performance.now();
    record("provider.start", request, { parentId: ctx.id, path: url.origin + url.pathname, method: init?.method ?? "POST", body });
    try { return observeResponse(await fetchImpl(input, init), request, "provider.end", start); }
    catch (error) { record("provider.failed", request, { durationMs: performance.now() - start }); throw error; }
  };
  const middleware = async (c: any, next: () => Promise<void>) => {
    const path: string = c.req.path;
    if (!toolPath(path) && !providerPath(path)) return next();
    const sessionId = c.req.header("x-conversation-id") ?? c.req.header("session-id") ?? c.req.header("x-session-id") ?? c.req.header("x-claude-code-session-id") ?? "";
    const ctx: Context = { id: randomUUID(), sessionId, path, bound: false,
      ...(verifyInputs ? { frozenSkills: decodeFrozenSkillCatalog(c.req.header("x-tdai-skill-catalog"))?.skills } : {}) };
    const start = performance.now();
    return context.run(ctx, async () => {
      const text = await c.req.raw.clone().text();
      record(toolPath(path) ? "tool.start" : "input.start", ctx, { path, method: c.req.method, body: parseBody(text) });
      try { await next(); c.res = observeResponse(c.res, ctx, toolPath(path) ? "tool.end" : "input.end", start); }
      catch (error) { record("input.failed", ctx); throw error; }
    });
  };
  return { middleware, fetch: capturedFetch };
}

export function assertFinal5InjectedInput(body: unknown, skills: Array<{ runtimeName: string; description: string }>) {
  const strings: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(body);
  const text = strings.join("\n");
  if (!text.includes("available_skills") || !text.includes("tdai_memory_tools")
    || skills.some(skill => !text.includes(skill.runtimeName) || !text.includes(skill.description))) {
    throw new Error("FINAL5_INPUT_NOT_READY: provider input lacks frozen catalog or TDAI tools");
  }
}

// Preloaded before server imports so bridge fetcher bindings also use the observer.
if (process.env.FINAL5_CAPTURE_DIRECTORY) {
  const directory = process.env.FINAL5_CAPTURE_DIRECTORY;
  mkdirSync(directory, { recursive: true });
  const secrets = Object.entries(process.env).filter(([key, value]) => /API_KEY|TOKEN|SECRET|PASSWORD|USER_KEY/iu.test(key) && (value?.length ?? 0) >= 8).map(([, value]) => value!);
  const capture = createHttpCapture(
    event => appendFinal5CaptureEvent(directory, event, secrets),
    globalThis.fetch.bind(globalThis),
    Boolean(process.env.FINAL5_ASSET_RUN_ROOT),
  );
  (globalThis as any)[CAPTURE_HOOK] = capture;
  globalThis.fetch = capture.fetch;
  if (process.env.FINAL5_ASSET_RUN_ROOT) {
    if (!process.env.FINAL5_CORE_URL) throw new Error("FINAL5_CORE_URL is required for the frozen Skill pool");
    installFinal5SkillPool(process.env.FINAL5_ASSET_RUN_ROOT, process.env.FINAL5_CORE_URL);
  }
}
