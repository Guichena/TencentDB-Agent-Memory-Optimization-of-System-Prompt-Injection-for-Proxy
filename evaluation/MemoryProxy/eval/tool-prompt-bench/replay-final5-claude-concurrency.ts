import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeFrozenSkillCatalog } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";
import { loadSkillCatalogBindings } from "./final5-workspace-manifest.js";

const root = resolve(process.argv[2]);
const variant = process.argv[3];
const streaming = process.argv.includes("--stream");
if (!["baseline", "final"].includes(variant)) throw new Error("Specify baseline or final");
const source = resolve("../../implementations", variant, "MemoryProxy/src");
const identity = JSON.parse(readFileSync(join(root, "runtime-core/identity.json"), "utf8"));
const runtime = JSON.parse(readFileSync(join(root, "small-validation/runtime-bindings-tasks.json"), "utf8")).teams[0];
const evidence = join(root, "small-validation/execution-v10/claude-code/server_team/execution.json.evidence");
const attempt = readdirSync(evidence).find(name => {
  try { return JSON.parse(readFileSync(join(evidence, name, "attempt-capture.json"), "utf8")).caseId === "DVG-T04-T01-C002"; }
  catch { return false; }
});
if (!attempt) throw new Error("Replay input missing");
const events = readFileSync(join(evidence, attempt, "http-events.jsonl"), "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
const inputs = events.filter(event => event.type === "input.start").map(event => event.body);
if (inputs.length !== 2) throw new Error("Expected two overlapping requests");
const label = (body: any) => JSON.stringify(body.messages).includes("Write the title in the predominant language") ? "title" : "main";
const fetchOriginal = globalThis.fetch.bind(globalThis);
const forwarded: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "replay.invalid") return fetchOriginal(input, init);
  const body = JSON.parse(init!.body as string);
  const name = label(body);
  forwarded.push(name);
  await new Promise(resolve => setTimeout(resolve, name === "title" ? 50 : 1));
  if (streaming) {
    const frames = [
      { type: "message_start", message: { id: `replay-${name}`, type: "message", role: "assistant", model: body.model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: name } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    let index = 0;
    return new Response(new ReadableStream({
      async pull(controller) {
        if (index === frames.length) { controller.close(); return; }
        await new Promise(resolve => setTimeout(resolve, name === "title" ? 5 : 15));
        const frame = frames[index++];
        controller.enqueue(new TextEncoder().encode(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`));
      },
    }), { headers: { "content-type": "text/event-stream" } });
  }
  return Response.json({ id: `replay-${name}`, type: "message", role: "assistant", model: body.model,
    content: [{ type: "text", text: name }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } });
};
const load = (path: string) => import(pathToFileURL(join(source, path)).href);
const { buildConfig } = await load("config.ts");
const { createApp } = await load("server.ts");
const { initAuth } = await load("auth.ts");
const config = buildConfig({ configFile: resolve("config.example.yaml") });
config.upstream = { url: "http://replay.invalid/v1", apiKey: "replay", agents: { "claude-code": { url: "http://replay.invalid/v1", apiKey: "replay" } } };
config.auth = { enabled: true, url: "http://127.0.0.1:8421", timeoutMs: 30000 };
config.coreSkill = { ...config.coreSkill, endpoint: config.auth.url, serviceId: "default", timeoutMs: 30000 };
config.tdai = { ...config.tdai, endpoint: config.auth.url, serviceId: "default", memory: { ...config.tdai.memory, writeL0: false } };
config.storage = { ...config.storage, enabled: true, backend: "memory" };
config.redis.enabled = false;
config.extraction = { enabled: false, extractors: [] };
config.creditPricing.models = [];
config.creditReport.enabled = false;
config.creditReport.url = "";
config.injection.externalGatewayUrl = "http://127.0.0.1:8107";
initAuth(config.auth);
const app = createApp(config);
const catalog = loadSkillCatalogBindings(join(root, "small-validation/case-skill-catalog.jsonl")).get("DVG-T04-T01-C002")!;
const session = `replay-${variant}-${crypto.randomUUID()}`;
const results = await Promise.all(inputs.map(async body => {
  const expected = label(body);
  const response = await app.request("/claude-code/default/v1/messages", { method: "POST", headers: {
    "content-type": "application/json", "x-api-key": "replay", "x-tdai-user-key": identity.userKey,
    "x-conversation-id": session, "session-id": session, "x-team-id": runtime.teamId,
    "x-agent-id": runtime.agentId, "x-task-id": runtime.taskId,
    "x-tdai-skill-catalog": encodeFrozenSkillCatalog(catalog),
  }, body: JSON.stringify({ ...body, stream: streaming }) });
  const text = await response.text();
  if (streaming) {
    const frames = text.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    return { expected, status: response.status,
      actual: frames.filter(frame => frame.type === "content_block_delta").map(frame => frame.delta.text ?? "").join(""),
      terminal: frames.some(frame => frame.type === "message_stop") };
  }
  const actual = JSON.parse(text);
  return { expected, status: response.status, actual: actual.content?.[0]?.text, terminal: true };
}));
console.log(JSON.stringify({ variant, streaming, forwarded, results }));
if (results.some(result => result.status !== 200 || result.expected !== result.actual || !result.terminal)) process.exitCode = 1;
