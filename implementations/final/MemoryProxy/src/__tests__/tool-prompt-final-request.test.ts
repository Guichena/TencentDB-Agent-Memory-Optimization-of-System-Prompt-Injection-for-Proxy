import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { OpenAIAdapter } from "../injection/adapters/openai.js";
import { AnthropicAdapter } from "../injection/adapters/anthropic.js";
import { InjectionPipeline } from "../injection/pipeline.js";
import { HookRegistryImpl } from "../injection/registry.js";
import { TdaiMemoryToolsInjector } from "../injection/injectors/tdai-tools-injector.js";
import { TdaiProfileMemoryInjector } from "../injection/injectors/tdai-profile-memory-injector.js";
import { SkillToolsInjector } from "../injection/injectors/skill-tools-injector.js";
import { SkillInjector } from "../injection/injectors/skill-injector.js";
import { KnowledgeToolsInjector } from "../injection/injectors/knowledge-tools-injector.js";
import { buildCapabilitySignature } from "../injection/tool-prompt/runtime-contract.js";
import type { CoreSkillClient } from "../skill/core-client.js";
import type { CoreKnowledgeClient, KnowledgeItem } from "../knowledge/core-client.js";
import type { CoreSkillConfig } from "../types.js";

// Only external asset I/O is replaced. All five production hooks execute.
vi.mock("../tdai/client.js", () => ({ TdaiClient: class {
  async readL3ForCtx(ctx: { agentId: string }) { return { content: `Synthetic preferences for ${ctx.agentId}.` }; }
  async listL2ForCtx() { return [{ path: "scenes/review.md", summary: "Review decisions" }]; }
} }));
vi.mock("../injection/injectors/tdai-fixed-asset.js", () => ({
  resolveFixedAssetCtxs: async () => [
    { teamId: "team", userId: "user", agentId: "self", agentName: "Self", isSelf: true },
    { teamId: "team", userId: "user", agentId: "borrowed", agentName: "Borrowed", isSelf: false },
  ],
}));

const coreSkill = { endpoint: "https://core.example.test", serviceId: "space", serviceToken: "synthetic-unused", timeoutMs: 50 } as CoreSkillConfig;
const resources = [
  { knowledge_id: "wiki", type: "wiki", name: "Design", summary: "Design rationale" },
  { knowledge_id: "graph", type: "code-graph", name: "Repository", repo_url: "https://example.test/team/repo.git", branch: "main" },
].map(r => ({ ...r, service_url: "https://knowledge.example.test/v3", team_id: "team", user_id: null, created_at: "2026-01-01", updated_at: "2026-01-01" })) as KnowledgeItem[];

const captures: { protocol: string; signature: string; request: Record<string, unknown> }[] = [];
afterAll(() => {
  if (!process.env.ARCH_ARTIFACT_DIR) return;
  const directory = process.env.ARCH_ARTIFACT_DIR;
  mkdirSync(directory); // Explicit capture only; never overwrite an earlier run.
  const require = createRequire(import.meta.url);
  const encoder = require("tiktoken").get_encoding("o200k_base");
  const costs = captures.map((capture, index) => {
    const json = JSON.stringify(capture.request);
    const text = capture.protocol === "openai" ? (capture.request.messages as { content: string }[])[0]!.content
      : typeof capture.request.system === "string" ? capture.request.system
        : (capture.request.system as { text: string }[]).map(block => block.text).join("\n");
    writeFileSync(join(directory, `${index}.json`), JSON.stringify(capture, null, 2));
    const tokens = (value: string) => encoder.encode(value).length;
    const split = text.indexOf("## Runtime bindings");
    return { protocol: capture.protocol, signature: capture.signature, finalSystemTokens: tokens(text),
      requestJsonTokens: tokens(json), requestSha256: createHash("sha256").update(json).digest("hex"),
      staticPrefixTokens: split < 0 ? null : tokens(text.slice(0, split)),
      separatelyEncodedSegmentSum: split < 0 ? null : tokens(text.slice(0, split)) + tokens(text.slice(split)) };
  });
  writeFileSync(join(directory, "costs.json"), JSON.stringify({ tokenizer: "tiktoken/o200k_base", tokenizerVersion: JSON.parse(readFileSync(join(dirname(require.resolve("tiktoken")), "package.json"), "utf8")).version,
    boundary: "Final provider system text including host and all synthetic L3/L2/listing/resources. Request JSON tokens are serialization diagnostics, not provider billed tokens. Separately encoded segments are non-additive.", costs }, null, 2));
  encoder.free();
});

describe("reviewed 20260909 final provider requests (synthetic assets)", () => {
  const masks = [];
  for (const memory of [false, true]) for (const skill of [false, true])
    for (const wiki of [false, true]) for (const codeGraph of [false, true])
      for (const skillWrite of skill ? [false, true] : [false])
        for (const skillExtract of skill ? [false, true] : [false])
          masks.push({ memory, skill, wiki, codeGraph, knowledge: wiki || codeGraph, skillWrite, skillExtract });

  it.each(masks)("serializes real hooks $memory/$skill/$wiki/$codeGraph/$skillWrite/$skillExtract", async state => {
    const signature = buildCapabilitySignature(state);
    const config = { proxyBaseUrl: "https://proxy.example.test", toolPromptProfile: "v4-compact" as const, capabilitySignature: signature };
    const registry = new HookRegistryImpl();
    registry.register(new TdaiMemoryToolsInjector(config));
    registry.register(new SkillToolsInjector({ ...config, allowLlmWrite: state.skillWrite }));
    registry.register(new SkillInjector({ ...config, coreSkill }, {
      listListing: async () => ({ listing: "<available_skills>\n- review: Review workflow\n</available_skills>", mode: "full", hits: [{ skill_id: "review-id", name: "review", version: 1 }] }),
    } as unknown as CoreSkillClient));
    registry.register(new KnowledgeToolsInjector({ ...config, coreSkill }, {
      listKnowledge: async () => resources,
    } as unknown as CoreKnowledgeClient));
    registry.register(new TdaiProfileMemoryInjector({ enabled: true, endpoint: coreSkill.endpoint, apiKey: "synthetic-unused", serviceId: "space", writeL0: false, recallL1: false, injectL2L3: true, l1Limit: 5, l2Limit: 5, timeoutMs: 50 }, null, "v4-compact", signature));
    for (const protocol of ["openai", "anthropic"] as const) {
      const pipeline = new InjectionPipeline(registry, new Map([[protocol, protocol === "openai" ? new OpenAIAdapter() : new AnthropicAdapter()]]));
      const user = { role: "user", content: "Synthetic self-contained request." };
      const body = protocol === "openai"
        ? { model: "offline", temperature: 0, messages: [{ role: "system", content: "Stable host." }, user] }
        : { model: "offline", temperature: 0, system: "Stable host.", messages: [user] };
      const request = await pipeline.process(body, { protocol, traceId: "offline", keyId: "offline", modelId: "offline", stream: false, agentSource: "offline", sessionKey: "session-a", custom: {
        session: { team_id: "team", user_id: "user", agent_id: "self", session_id: "session-a", space_id: "space" },
        assetCapabilities: { chat_memory: state.memory, skill: state.skill, llm_wiki: state.wiki, code_graph: state.codeGraph },
      } });
      expect(JSON.stringify(request)).not.toContain("synthetic-unused");
      if (state.memory) {
        expect(JSON.stringify(request)).toContain("Synthetic preferences for borrowed");
        expect(JSON.stringify(request)).toContain("scenes/review.md");
      }
      const serialized = JSON.stringify(request);
      if (state.memory || state.skill || state.knowledge) {
        expect(serialized).toContain("## Runtime bindings");
        expect(serialized).toContain("JSON returns envelope");
      }
      expect(serialized.includes('<tdai_memory_tools>')).toBe(state.memory);
      expect(serialized.includes('<skill_tools>')).toBe(state.skill);
      expect(serialized.includes('<knowledge_tools>')).toBe(state.knowledge);
      if (state.memory) {
        expect(serialized).toContain("total ≤ 3 calls per turn");
        expect(serialized).toContain("data.partial=true");
        expect(serialized).toContain("historical version selection is not supported");
      }
      if (state.skill) {
        expect(serialized).toContain("-o saves the JSON, not decoded bytes");
        expect(serialized.includes('name=\\"skill_create\\"')).toBe(state.skillWrite);
        expect(serialized.includes('name=\\"skill_extract\\"')).toBe(state.skillExtract);
      }
      if (state.knowledge) {
        expect(serialized).toContain("per resource per session");
        expect(serialized).toContain("knowledge.example.test/v3");
      }
      expect(request).toMatchSnapshot(`${protocol}:${signature}`);
      captures.push({ protocol, signature, request });
    }
  });
});
