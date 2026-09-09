import { describe, expect, it } from "vitest";
import { OpenAIAdapter } from "../injection/adapters/openai.js";
import { AnthropicAdapter } from "../injection/adapters/anthropic.js";
import { InjectionPipeline } from "../injection/pipeline.js";
import { HookRegistryImpl } from "../injection/registry.js";
import { MEMORY_TOOLS_GUIDE } from "../injection/injectors/tdai-profile-memory-injector.js";
import { wrapAvailableSkillsBlock } from "../injection/injectors/skill-injector.js";
import { renderKnowledgeToolsBlock } from "../injection/injectors/knowledge-tools-injector.js";
import type { KnowledgeItem } from "../knowledge/core-client.js";
import { compileToolPrompt, lintCompiledToolPromptBundle, type CompiledToolPromptSurfaceEntry } from "../injection/tool-prompt/compiler.js";
import { assembleFidelityInjectionRegion, lintAssembledFidelityInjectionRegion } from "../injection/tool-prompt/prompt-layout.js";
import { buildCapabilitySignature } from "../injection/tool-prompt/runtime-contract.js";
import { getVisibleRuntimeToolContracts } from "../injection/tool-prompt/capability-pruned.js";
import type { ToolPromptCapabilityState, ToolPromptFamily, ToolPromptSurface } from "../injection/tool-prompt/types.js";

const FULL: ToolPromptCapabilityState = { memory: true, skill: true, knowledge: true, wiki: true, codeGraph: true, skillWrite: true, skillExtract: true };
const resources: KnowledgeItem[] = [
  { knowledge_id: "graph", type: "code-graph" as const, name: "Repository", repo_url: "https://example.test/team/repo.git", branch: "main" },
  { knowledge_id: "wiki", type: "wiki" as const, name: "Design", summary: "Design rationale and team definitions" },
].map(resource => ({ ...resource, summary: resource.summary ?? null, service_url: "http://localhost:8421/v3", team_id: "team", user_id: null, created_at: "2026-01-01", updated_at: "2026-01-01" }));

function render(state = FULL, session = "session-a", host = "http://localhost:8096") {
  const signature = buildCapabilitySignature(state);
  const entries: CompiledToolPromptSurfaceEntry[] = [];
  const add = (family: ToolPromptFamily, surface: ToolPromptSurface, assets = "") => {
    const compiled = compileToolPrompt({ profile: "v4-compact", family, surface, capabilitySignature: signature,
      assets, endpointBase: family === "knowledge" ? undefined : `${host}/${family === "memory" ? "memory-bridge/v3" : "skill-bridge/v3/skill"}`, headers: [["x-tdai-service-id", "space"], ["x-conversation-id", session]] });
    entries.push({ ...compiled });
    expect(compiled.promptIr).toBeDefined();
  };
  if (state.memory) {
    add("memory", "memory-tools", "");
    add("memory", "memory-guide", MEMORY_TOOLS_GUIDE);
  }
  if (state.skill) {
    add("skill", "skill-tools", "");
    entries.push({ profile: "v4-compact", family: "skill", surface: "skill-listing", capabilitySignature: signature,
      content: wrapAvailableSkillsBlock("<available_skills>\n- review: Review workflow\n</available_skills>") });
  }
  if (state.knowledge) {
    add("knowledge", "knowledge-tools", renderKnowledgeToolsBlock(resources.filter(r => r.type === "wiki" ? state.wiki : state.codeGraph), "space", { sessionKey: session })!.assets);
  }
  const region = entries.length ? assembleFidelityInjectionRegion(entries, signature, "v4-compact") : "";
  return { signature, entries, region };
}

async function pipeline(entries: CompiledToolPromptSurfaceEntry[], protocol: "openai" | "anthropic", query = "Self-contained coding.") {
  const registry = new HookRegistryImpl();
  for (const [index, entry] of entries.entries()) {
    registry.register({ id: `fixture-${entry.surface}`, point: "system.suffix", priority: index, description: "Offline fixture",
      execute: () => [{ type: "text", content: entry.content, metadata: {
        toolPromptProfile: entry.profile, toolPromptFamily: entry.family, toolPromptSurface: entry.surface, capabilitySignature: entry.capabilitySignature,
      } }],
    });
  }
  const instance = new InjectionPipeline(registry, new Map([[protocol, protocol === "openai" ? new OpenAIAdapter() : new AnthropicAdapter()]]));
  const body = protocol === "openai" ? { messages: [{ role: "system", content: "Stable host." }, { role: "user", content: query }] }
    : { system: "Stable host.", messages: [{ role: "user", content: query }] };
  const result = await instance.process(body, { protocol, traceId: "offline", keyId: "offline", modelId: "offline", stream: false, agentSource: "offline" });
  return protocol === "openai" ? JSON.stringify((result.messages as unknown[])[0]) : JSON.stringify(result.system);
}

const masks: ToolPromptCapabilityState[] = [];
for (const memory of [false, true]) for (const skill of [false, true]) for (const wiki of [false, true]) for (const codeGraph of [false, true]) {
  for (const skillWrite of skill ? [false, true] : [false]) for (const skillExtract of skill ? [false, true] : [false]) {
    masks.push({ memory, skill, wiki, codeGraph, knowledge: wiki || codeGraph, skillWrite, skillExtract });
  }
}

describe("V4 candidate without the eval framework", () => {
  it.each(masks.map(state => [buildCapabilitySignature(state), state] as const))("keeps all enabled tools and the pipeline for %s", async (_label, state) => {
    const { entries, region, signature } = render(state);
    if (entries.length) {
      expect(region).not.toBe("");
      expect(() => lintCompiledToolPromptBundle(entries)).not.toThrow();
      expect(() => lintAssembledFidelityInjectionRegion(region, signature, "v4-compact")).not.toThrow();
      expect([...region.matchAll(/<tool name="([^"]+)">/g)].map(match => match[1]).sort())
        .toEqual(getVisibleRuntimeToolContracts(signature).map(contract => contract.id).sort());
    }
    for (const protocol of ["openai", "anthropic"] as const) {
      const first = await pipeline(entries, protocol);
      expect(first).toContain("Stable host.");
      if (entries.length) expect(first).toContain("task1_prompt_injection");
      expect(await pipeline(entries, protocol, "A different query.")).toBe(first);
    }
  });

  it("rejects missing and duplicate routes after final assembly", () => {
    const { region, signature } = render();
    const route = region.match(/^Route:.*$/m)?.[0];
    expect(route).toBeTruthy();
    expect(() => lintAssembledFidelityInjectionRegion(region.replace(route!, ""), signature)).toThrow();
    expect(() => lintAssembledFidelityInjectionRegion(region.replace(route!, `${route}\n${route}`), signature)).toThrow();
  });

  it("retains baseline routing details and executable parameter shapes", () => {
    const { region } = render();
    expect(region).toContain("git remote");
    expect(region).toContain("about");
    expect(region).toContain("imported_from");
    expect(region).toContain("data.manifest[].path");
    expect(region).toContain("is_executable");
    expect(region).toContain("utf-8|base64");
    expect(region).toContain("params values");
    expect(region).not.toContain("data.tools[].params->params");
  });

  it("is deterministic over three renderings and isolates session bindings", () => {
    const first = render().region;
    for (let i = 0; i < 3; i++) expect(render().region).toBe(first);
    const changed = render(FULL, "session-b").region;
    const staticPart = (s: string) => s.slice(0, s.indexOf("## Runtime bindings"));
    expect(staticPart(first).length).toBeGreaterThan(1000);
    expect(staticPart(changed)).toBe(staticPart(first));
    expect(changed).not.toBe(first);
  });
});
