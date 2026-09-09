import { describe, expect, it } from "vitest";
import { compileToolPrompt } from "../injection/tool-prompt/compiler.js";
import { assembleFidelityInjectionRegion, lintAssembledFidelityInjectionRegion } from "../injection/tool-prompt/prompt-layout.js";
import { computePromptSemanticDelta, isPromptSemanticDeltaEmpty } from "../injection/tool-prompt/semantic-delta.js";
import { assertFinalRequestEquivalent } from "../injection/tool-prompt/final-artifact.js";

const signature = "memory=1;skill=0;knowledge=0;wiki=0;code_graph=0;skill_write=0;skill_extract=0";
const compiled = compileToolPrompt({ profile: "v4-compact", family: "memory", surface: "memory-tools", capabilitySignature: signature,
  endpointBase: "https://proxy.example.test/memory-bridge/v3", headers: [["x-tdai-service-id", "space"], ["x-conversation-id", "session"]] });
const region = assembleFidelityInjectionRegion([compiled], signature, "v4-compact");

describe("mutations of final rendered rules", () => {
  const mutations: [string, (text: string) => string][] = [
    ["delete CALL", text => text.replace(/^CALL .*\n/m, "")],
    ["reverse CALL", text => text.replace("CALL if enabled", "NO_CALL if enabled")],
    ["weaken memory trigger", text => text.replace("MUST retrieve", "MAY skip retrieving")],
    ["broaden skill trigger", text => text.replace("the task explicitly requests its use or requires a specific team workflow/convention", "the task has any topical relevance")],
    ["drop missing instruction condition", text => text.replace(", and the needed instructions are missing from context", "")],
    ["treat listing as instructions", text => text.replace("A name/description is not the instructions;", "A name/description is the instructions;")],
    ["describe instead of execute", text => text.replace("实际执行 HTTP 请求", "仅描述 HTTP 请求")],
    ["omit runtime headers", text => text.replace("每个 header", "任选一个 header")],
    ["delete NO_CALL", text => text.replace(/^NO_CALL .*\n/m, "")],
    ["reverse NO_CALL", text => text.replace("NO_CALL for self-contained", "CALL for self-contained")],
    ["when", text => text.replace("Missing durable preference", "Always retrieve durable preference")],
    ["avoid", text => text.replace("Never invent path.", "Invent path.")],
    ["contrast", text => text.replace("Exact wording/timeline -> conversation_search.", "Exact wording/timeline -> atomic_query.")],
    ["disabled capability", text => text.replace("</tdai_memory_tools>", '<tool name="skill_delete">bad</tool>\n</tdai_memory_tools>')],
    ["bitmap", text => text.replace("capability-bitmap: memory=1", "capability-bitmap: memory=0")],
    ["parameter source", text => text.replace(/^    input: path from.*\n/m, "")],
    ["handoff", text => text.replace("tdai_scenario_ls.data.entries[].path->path", "tdai_memory_search.data.items[].id->path")],
    ["stop", text => text.replace("otherwise stop.", "otherwise continue.")],
    ["path", text => text.replace("path: /atomic/search", "path: /atomic/delete")],
    ["required parameter", text => text.replace("requires: query", "requires: invented")],
  ];
  it.each(mutations)("detects %s", (_name, mutate) => {
    const changed = mutate(region);
    expect(changed).not.toBe(region);
    expect(() => lintAssembledFidelityInjectionRegion(changed, signature, "v4-compact")).toThrow();
    expect(() => assertFinalRequestEquivalent({ system: region }, { system: changed })).toThrow();
  });

  it("detects cache loss independently of identical prompt text", () => {
    const parent = { system: [{ type: "text", text: region, cache_control: { type: "ephemeral" } }] };
    expect(() => assertFinalRequestEquivalent(parent, { system: [{ type: "text", text: region }] })).toThrow();
  });
  it("permits a specifically reviewed compression, not blanket snapshot approval", () => {
    const after = region.replace("Missing durable preference", "Missing persistent preference");
    expect(() => assertFinalRequestEquivalent({ system: region }, { system: after }, [{ before: "Missing durable preference", after: "Missing persistent preference", reason: "Example reviewed synonym; not enabled in production." }])).not.toThrow();
    expect(() => assertFinalRequestEquivalent({ system: region }, { system: after.replace("NO_CALL", "CALL") }, [{ before: "Missing durable preference", after: "Missing persistent preference", reason: "Only the synonym is approved." }])).toThrow();
  });
  it.each(["must-call", "no-call", "family-route", "stop", "protocol"])("detects global IR mutation %s", key => {
    const child = structuredClone(compiled.promptIr);
    child.globalRules = { ...child.globalRules, [key]: "REVERSED" };
    expect(isPromptSemanticDeltaEmpty(computePromptSemanticDelta(compiled.promptIr, child))).toBe(false);
  });
  it("detects capability mutations even with identical tool specs", () => {
    const child = structuredClone(compiled.promptIr);
    child.capabilitySignature = signature.replace("memory=1", "memory=0");
    expect(computePromptSemanticDelta(compiled.promptIr, child).capability).toContain("capability-bitmap");
  });
});
