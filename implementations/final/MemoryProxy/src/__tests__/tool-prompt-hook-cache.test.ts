import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { InjectionPipeline } from "../injection/pipeline.js";
import { HookRegistryImpl } from "../injection/registry.js";
import { TdaiMemoryToolsInjector } from "../injection/injectors/tdai-tools-injector.js";
import { AnthropicAdapter } from "../injection/adapters/anthropic.js";
import { compileToolPrompt } from "../injection/tool-prompt/compiler.js";
import type { HookCacheRepo } from "../db/hookCacheRepo.js";
import type { AgentContextMetadata, ContextBlock } from "../injection/types.js";
import { prewarmAll } from "../injection/prewarm.js";

const signature = "memory=1;skill=0;knowledge=0;wiki=0;code_graph=0;skill_write=0;skill_extract=0";
const adapter = new AnthropicAdapter();
const body = { system: [{ type: "text", text: "host", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: "synthetic" }] };
const meta: AgentContextMetadata = { protocol: "anthropic", modelId: "offline", keyId: "offline", traceId: "offline", stream: false, agentSource: "offline", userId: "user", spaceId: "space", custom: {
  session: { session_id: "session", team_id: "team", user_id: "user", agent_id: "self", space_id: "space" }, assetCapabilities: { chat_memory: true, skill: false, llm_wiki: false, code_graph: false },
} };
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] };
};

describe("existing Proxy hook cache and local processing cost", () => {
  it("reuses compilation and isolates tenant, session, capability and template", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const stored = new Map<string, ContextBlock[]>();
      const cache = {
        get: async (...keys: unknown[]) => structuredClone(stored.get(JSON.stringify(keys)) ?? null),
        put: async (...args: unknown[]) => { stored.set(JSON.stringify(args.slice(0, 5)), structuredClone(args[5] as ContextBlock[])); },
        putMany: async (space: string, user: string, source: string, session: string, entries: { hookId: string; blocks: ContextBlock[] }[]) => {
          for (const entry of entries) stored.set(JSON.stringify([space, user, source, session, entry.hookId]), structuredClone(entry.blocks));
        },
      } as unknown as HookCacheRepo;
      const hook = new TdaiMemoryToolsInjector({ proxyBaseUrl: "https://proxy.example.test", toolPromptProfile: "v4-compact", capabilitySignature: signature });
      const executed = vi.spyOn(hook, "execute");
      const registry = new HookRegistryImpl(); registry.register(hook);
      const pipeline = new InjectionPipeline(registry, new Map([["anthropic", adapter]]), { hookCacheRepo: cache, validateToolPrompts: false });
      const warmed = await prewarmAll(registry, cache, {
        keyId: "offline", userId: "user", spaceId: "space", agentSource: "offline",
        sessionInfo: { session_id: "session", team_id: "team", user_id: "user", agent_id: "self", space_id: "space" },
        agentDetail: null, taskDetail: null,
        assetCapabilities: { chat_memory: true, skill: false, llm_wiki: false, code_graph: false },
      });
      expect(warmed.cachedHookIds).toEqual([hook.id]);
      const prewarmedRequest = await pipeline.process(body, structuredClone(meta));
      expect(executed).not.toHaveBeenCalled();
      const previousEntries = [...stored.entries()];
      stored.clear();
      for (const [key, blocks] of previousEntries) {
        const keys = JSON.parse(key) as string[];
        keys[4] = keys[4]!.replace(/-direct-\d{8}-\d+/, "-direct-20260907-1");
        expect(JSON.stringify(keys)).not.toBe(key);
        stored.set(JSON.stringify(keys), blocks.map(block => ({ ...block, content: `STALE-PROMPT\n${block.content}` })));
      }
      const start = performance.now();
      const first = await pipeline.process(body, structuredClone(meta));
      expect(first).toEqual(prewarmedRequest);
      const firstRequestMs = performance.now() - start;
      const repeated = [];
      for (let i = 0; i < 50; i++) {
        const now = performance.now();
        expect(await pipeline.process(body, structuredClone(meta))).toEqual(first);
        repeated.push(performance.now() - now);
      }
      expect(executed).toHaveBeenCalledTimes(1);
      expect((first.system as Record<string, unknown>[])[0]).toEqual(body.system[0]);
      expect((first.system as Record<string, unknown>[])[1]!.cache_control).toBeUndefined();
      const validated = new InjectionPipeline(registry, new Map([["anthropic", adapter]]), { hookCacheRepo: cache, validateToolPrompts: true });
      expect(await validated.process(body, structuredClone(meta))).toEqual(first);

      for (const change of [{ userId: "other-user" }, { spaceId: "other-space" }, { agentSource: "other-host" }]) {
        await pipeline.process(body, { ...structuredClone(meta), ...change });
      }
      const otherSession = structuredClone(meta);
      (otherSession.custom!.session as Record<string, string>).session_id = "other-session";
      const second = await pipeline.process(body, otherSession);
      expect(JSON.stringify(second)).toContain("other-session");
      const prefix = (request: Record<string, unknown>) => (request.system as { text: string }[])[1]!.text.split("## Runtime bindings")[0];
      expect(prefix(second)).toBe(prefix(first));
      expect(executed).toHaveBeenCalledTimes(5);
      hook.cacheIdentity += "-new-template";
      await pipeline.process(body, structuredClone(meta));
      expect(executed).toHaveBeenCalledTimes(6);
      const disabled = structuredClone(meta);
      (disabled.custom!.assetCapabilities as Record<string, boolean>).chat_memory = false;
      const empty = await pipeline.process(body, disabled);
      expect(JSON.stringify(empty)).not.toContain("tdai_memory_tools");
      expect(executed).toHaveBeenCalledTimes(7);

      const input = { profile: "v4-compact" as const, family: "memory" as const, surface: "memory-tools" as const, capabilitySignature: signature,
        endpointBase: "https://proxy.example.test/memory-bridge/v3", headers: [["x-tdai-service-id", "space"], ["x-conversation-id", "session"]] as const };
      expect(compileToolPrompt(input)).not.toHaveProperty("compactPromptIr");
      const compile = [], serialize = [];
      for (let i = 0; i < 50; i++) {
        let now = performance.now(); compileToolPrompt(input); compile.push(performance.now() - now);
        const parsed = adapter.parse(first, meta);
        now = performance.now(); adapter.serialize(parsed); serialize.push(performance.now() - now);
      }
      if (process.env.ARCH_PERFORMANCE_FILE) writeFileSync(process.env.ARCH_PERFORMANCE_FILE, JSON.stringify({
        environment: { node: process.version, platform: process.platform, arch: process.arch },
        scope: "Local synthetic memory-only request; no network/provider. Warm samples after first compile. Repeat time includes test assertion; no model-quality inference.",
        firstRequestMs, repeatedHookCache: stats(repeated), compileWithoutCache: stats(compile), serializationOnly: stats(serialize),
        repeatedRequests: 50, injectorExecutionsBeforeIsolationTests: 1,
      }, null, 2), { flag: "wx" });
    } finally { log.mockRestore(); }
  });
});
