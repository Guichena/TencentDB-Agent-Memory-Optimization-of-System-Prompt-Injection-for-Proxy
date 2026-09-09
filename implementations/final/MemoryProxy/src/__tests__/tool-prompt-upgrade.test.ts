import { describe, expect, it } from "vitest";
import { compileToolPrompt, lintCompiledToolPromptBundle } from "../injection/tool-prompt/compiler.js";
import { assembleFidelityInjectionRegion, lintAssembledFidelityInjectionRegion } from "../injection/tool-prompt/prompt-layout.js";
import { renderKnowledgeToolsBlock } from "../injection/injectors/knowledge-tools-injector.js";
import { toolPromptCacheIdentity } from "../injection/tool-prompt/profiles.js";

const SIGNATURE = "memory=1;skill=1;knowledge=1;wiki=1;code_graph=1;skill_write=1;skill_extract=1";

function compile(host = "http://localhost:8096", session = "session-a") {
  const knowledge = renderKnowledgeToolsBlock([{
    knowledge_id: "repo", type: "code-graph", name: "Repository", summary: "Design",
    service_url: "http://localhost:8421/v3", team_id: "team", user_id: null,
    repo_url: "https://example.test/team/repo.git", branch: "main",
    created_at: "2026-01-01", updated_at: "2026-01-01",
  }], "space", { sessionKey: session });
  if (!knowledge) throw new Error("knowledge fixture is empty");
  const fixtures = [
    ["memory", "memory-tools", ""],
    ["skill", "skill-tools", ""],
    ["knowledge", "knowledge-tools", knowledge.assets],
  ] as const;
  return fixtures.map(([family, surface, content]) => compileToolPrompt({
    profile: "v4-compact", family, surface, capabilitySignature: SIGNATURE,
    assets: content, endpointBase: family === "knowledge" ? undefined : `${host}/${family === "memory" ? "memory-bridge/v3" : "skill-bridge/v3/skill"}`, headers: [["x-tdai-service-id", "space"], ["x-conversation-id", session]],
  }));
}

describe("V4 upgrade provider contract", () => {
  it("keeps the prefix stable when both endpoint and session change", () => {
    const first = assembleFidelityInjectionRegion(compile(), SIGNATURE, "v4-compact");
    const changed = assembleFidelityInjectionRegion(compile("http://proxy-b.test:9000", "session-b"), SIGNATURE, "v4-compact");
    const prefix = (text: string) => text.slice(0, text.indexOf("## Runtime bindings"));
    expect(prefix(first)).toBe(prefix(changed));
    expect(prefix(first)).not.toContain("http://localhost:8096");
    expect(changed).toContain("memory-tools: endpoint-base: http://proxy-b.test:9000/memory-bridge/v3");
    expect(changed).toContain("skill-tools: endpoint-base: http://proxy-b.test:9000/skill-bridge/v3/skill");
    expect(changed).toContain("session-b");
  });

  it("uses a single default for answer results without dropping explicit result kinds", () => {
    const text = assembleFidelityInjectionRegion(compile(), SIGNATURE, "v4-compact");
    expect(text).toContain("produces = answer");
    expect(text).not.toContain("    produces: answer");
    expect(text).toContain("    produces: discovery");
    expect(text).toContain("    produces: instructions");
    expect(text).toContain("    produces: content");
    expect(text).toContain("Never guess replacement IDs or paths");
    expect(text).not.toMatch(/^    recover-once.*never guess/gm);
    expect(text).not.toContain("; direct allowed");
    expect(text).toContain("; direct only if available");
  });

  it.each([
    ["handoff", (text: string) => text.replace(/^    handoff.*\n/gm, "")],
    ["recovery", (text: string) => text.replace(/^    recover-once.*\n/gm, "")],
    ["goal result", (text: string) => text.replace(/^    produces.*\n/gm, "")],
    ["input hint", (text: string) => text.replace(/^    input.*\n/gm, "")],
    ["unbounded direct", (text: string) => text.replace(/; direct only if available/g, "; direct allowed")],
    ["recovery condition", (text: string) => text.replace(/; only if known type\/time filters are available/g, "")],
  ] as const)("rejects loss or drift of %s after rendering", (_label, mutate) => {
    const entries = compile();
    const changed = entries.map(entry => ({ ...entry, content: mutate(entry.content) }));
    expect(changed.some((entry, index) => entry.content !== entries[index].content)).toBe(true);
    expect(() => lintCompiledToolPromptBundle(changed)).toThrow();
  });

  it("rejects duplicate action fields rather than accepting a correct substring", () => {
    const entries = compile();
    const changed = entries.map(entry => ({ ...entry,
      content: entry.content.replace(/(^    handoff.*$)/m, "$1\n$1"),
    }));
    expect(() => lintCompiledToolPromptBundle(changed)).toThrow();
  });

  it("invalidates the previous V4 hook cache while keeping identity deterministic and scoped", () => {
    const identity = toolPromptCacheIdentity("tools", "v4-compact", SIGNATURE)!;
    expect(identity).toContain("-direct-20260909-3-");
    expect(toolPromptCacheIdentity("tools", "v4-compact", SIGNATURE)).toBe(identity);
    expect(toolPromptCacheIdentity("other-hook", "v4-compact", SIGNATURE)).not.toBe(identity);
    expect(toolPromptCacheIdentity("tools", "v4-compact", SIGNATURE.replace("memory=1", "memory=0"))).not.toBe(identity);
  });

  it.each([
    /^Omitted .*\n/m,
    /^Recovery permits .*\n/m,
    /^NO_CALL .*\n/m,
    /^    handoff.*\n/gm,
    /^    recover-once.*\n/gm,
  ])("protects shared rules and action fields after layout: %s", (pattern) => {
    const region = assembleFidelityInjectionRegion(compile(), SIGNATURE, "v4-compact");
    const changed = region.replace(pattern, "");
    expect(changed).not.toBe(region);
    expect(() => lintAssembledFidelityInjectionRegion(region, SIGNATURE, "v4-compact")).not.toThrow();
    expect(() => lintAssembledFidelityInjectionRegion(changed, SIGNATURE, "v4-compact")).toThrow();
  });
});
