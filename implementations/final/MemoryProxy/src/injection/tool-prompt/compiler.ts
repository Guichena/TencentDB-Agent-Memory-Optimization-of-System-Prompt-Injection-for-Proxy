import { createHash } from "node:crypto";
import { getVisibleRuntimeToolContracts } from "./capability-pruned.js";
import { parseCapabilitySignature } from "./runtime-contract.js";
import { buildPromptIR } from "./prompt-ir.js";
import { lintV4ActionFields, lintV4DecisionFields, renderV4ToolCard } from "./readable-shared-defaults.js";
import { V4_EFFECTIVE_GLOBAL_RULES } from "./prompt-layout.js";
import { V4_KNOWLEDGE_ROUTING } from "./execution-hints.js";
import { parseToolPromptProfile } from "./profiles.js";
import type { CompiledToolPromptProfile, ToolPromptFamily, ToolPromptSurface } from "./types.js";

export const TOOL_PROMPT_COMPILER_VERSION = "v4-direct-3";

export interface CompiledToolPromptSurfaceEntry {
  profile: CompiledToolPromptProfile;
  family: ToolPromptFamily;
  surface: ToolPromptSurface;
  capabilitySignature: string;
  content: string;
}

export interface ToolPromptInput {
  profile?: CompiledToolPromptProfile;
  family: ToolPromptFamily;
  surface: ToolPromptSurface;
  capabilitySignature: string;
  endpointBase?: string;
  headers?: readonly (readonly [string, string])[];
  assets?: string;
}

export const MEMORY_GUIDANCE = [
  "<memory-tools-guide>",
  "## Memory constraints",
  "- If retrieval is empty, say the memory was not found; do not invent it.",
  "</memory-tools-guide>",
  "",
  "## Memory routing",
  "- TDAI memory and local `MEMORY.md` are peer sources; route by the missing evidence. L3 + L2 index are already in system; retrieve TDAI L0/L1 when durable context is missing, and do not assume the local file supersedes TDAI.",
  "- CALL before answering when identity, preference, history, decision, convention, exact wording, or a known scene is needed but absent from context + `<l3_core_memory>`.",
  "- `tdai_memory_search`: self/imported distilled facts. Both atomic and conversation search cover self + imported; source_agent_* identifies the source.",
  "- Never claim the tool, MCP, or slash command is unavailable.",
].join("\n");

export const SKILL_GUIDANCE = [
  "## Available skills",
  "Candidate subset (ranked/Top-K/truncated), not a full inventory.",
  "- CALL listed: `skill_view` for explicitly requested skill use or a required specific team workflow/convention, when the needed instructions are missing from context.",
  "- CALL discovery: `skill_search` for a requested skill or required team workflow with no exact usable name/ID; open a needed team result via `skill_view_by_id`.",
  "- NO_CALL: topical/keyword-only relevance, ordinary coding without a required team workflow, or all required instructions already in context.",
  "- Cloud-only: use `<skill_tools>`, not file tools.",
  "- If the viewed instructions require an attachment missing from context, use `skill_files_read` with that view's skill_id, manifest path and version; download only when raw bytes are needed.",
].join("\n");

export function renderRuntimeBindings(input: Pick<ToolPromptInput, "endpointBase" | "headers">): string {
  const lines: string[] = [];
  if (input.endpointBase !== undefined) {
    const url = new URL(input.endpointBase);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || /[\s<>'"`]/.test(input.endpointBase) || url.search || url.hash) {
      throw new Error("invalid tool endpoint base");
    }
    lines.push(`endpoint-base: ${input.endpointBase}`);
  }
  const seen = new Set<string>();
  const headers = (input.headers ?? []).map(([name, value]) => {
    if (!/^x-[a-z0-9-]+$/.test(name) || seen.has(name) || !value
      || /[\r\n\x00-\x1f;<>]/.test(value)) throw new Error("invalid tool runtime header");
    seen.add(name);
    return `${name}: ${value}`;
  });
  if (headers.length) lines.push(`headers: ${headers.join("; ")}`);
  return lines.join("\n");
}

/** One production representation: runtime contracts plus effective decisions. */
export function compileToolPrompt(input: ToolPromptInput) {
  parseToolPromptProfile(input.profile === undefined ? "v4-compact" : input.profile);
  const state = parseCapabilitySignature(input.capabilitySignature);
  if (!state[input.family] || !input.surface.startsWith(`${input.family}-`)) {
    throw new Error(`disabled or mismatched prompt surface ${input.surface}`);
  }
  const contracts = getVisibleRuntimeToolContracts(input.capabilitySignature, input.family);
  const promptIr = buildPromptIR({
    family: input.family, capabilitySignature: input.capabilitySignature,
    contracts, globalRules: V4_EFFECTIVE_GLOBAL_RULES,
  });
  let content: string;
  if (input.surface === "memory-guide") content = MEMORY_GUIDANCE;
  else if (input.surface === "skill-listing") content = `${SKILL_GUIDANCE}\n${input.assets ?? ""}`;
  else {
    const tag = input.family === "memory" ? "tdai_memory_tools" : `${input.family}_tools`;
    const bindings = renderRuntimeBindings(input);
    const intro = input.family === "knowledge"
      ? "## 知识库专用流程\nendpoint-base: 使用目标 `<knowledge>` 的 `url`；knowledge_id 只放 body，不拼进 URL。"
      : "";
    const footer = input.family === "memory"
      ? "## 调用约束\n- Read-only; mutate memory through the main path.\n- `tdai_memory_search` + `tdai_conversation_search` total ≤ 3 calls per turn."
      : input.family === "skill"
        ? ""
        : "## 约定\n\n- code graph: default to explore for architecture, behavior or locating code; query=natural language, symbols or filenames. It returns source. Use node next for a specific symbol still needed (includeCode=true for source). Do not re-read returned source unless exact/current local code is required.\n- search=symbol locations only, no source; callers/callees/impact=targeted symbol relationships; files=directory overview. Follow cached tools/list descriptions and params.\n- wiki: search -> read_page; no full list.\n- Resources may run in parallel; unavailable -> local search.";
    const closing = input.family === "skill" && !state.skillWrite
      ? `read-only (skill_write=0).\n</${tag}>` : `</${tag}>`;
    content = [`<${tag}>`, bindings, intro, ...promptIr.tools.map(renderV4ToolCard), footer, closing,
      ...(input.family === "knowledge" ? [V4_KNOWLEDGE_ROUTING, input.assets ?? ""] : []),
    ].filter(Boolean).join("\n\n");
  }
  return {
    compilerVersion: TOOL_PROMPT_COMPILER_VERSION, profile: "v4-compact" as const,
    family: input.family, surface: input.surface, capabilitySignature: input.capabilitySignature,
    content, contentSha256: createHash("sha256").update(content).digest("hex"),
    promptIr, contractIds: contracts.map(contract => contract.id),
  };
}

export function lintCompiledToolPromptBundle(entries: readonly CompiledToolPromptSurfaceEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    parseToolPromptProfile(entry.profile);
    if (seen.has(entry.surface)) throw new Error(`duplicate compiled tool prompt surface ${entry.surface}`);
    seen.add(entry.surface);
    if (!entry.surface.startsWith(`${entry.family}-`)) throw new Error("prompt family mismatch");
    lintV4ProviderBundle({ [entry.surface]: entry.content }, entry.capabilitySignature);
  }
}

function lintV4ProviderBundle(
  bundle: Partial<Record<ToolPromptSurface, string>>,
  capabilitySignature: string,
): void {
  const surfaceFamily: Partial<Record<ToolPromptSurface, ToolPromptFamily>> = {
    "memory-tools": "memory",
    "skill-tools": "skill",
    "knowledge-tools": "knowledge",
  };
  const identityArgs = new Set(["user_id", "team_id", "agent_id", "task_id"]);
  for (const [surface, content] of Object.entries(bundle) as Array<[ToolPromptSurface, string]>) {
    const family = surfaceFamily[surface];
    if (!family) continue;
    const contracts = getVisibleRuntimeToolContracts(capabilitySignature, family);
    const ir = buildPromptIR({ family, capabilitySignature, contracts });
    const cards = [...content.matchAll(/  <tool name="([^"]+)">\n([\s\S]*?)  <\/tool>/g)];
    const names = cards.map((card) => card[1]!);
    if (new Set(names).size !== names.length) {
      throw new Error(`${surface} v4 tool names must be unique`);
    }
    const expected = contracts.map((contract) => contract.id);
    if (JSON.stringify([...names].sort()) !== JSON.stringify([...expected].sort())) {
      throw new Error(`${surface} v4 tools diverged from visible runtime contracts`);
    }
    for (const card of cards) {
      const id = card[1]!;
      const body = card[2]!;
      const contract = contracts.find((candidate) => candidate.id === id)!;
      lintV4ActionFields(body, ir.tools.find((tool) => tool.toolId === id)!);
      lintV4DecisionFields(body, ir.tools.find((tool) => tool.toolId === id)!);
      const relativeBase = family === "memory"
        ? "/memory-bridge/v3"
        : family === "skill"
          ? "/skill-bridge/v3/skill"
          : "";
      const expectedPath = relativeBase && contract.path.startsWith(relativeBase)
        ? contract.path.slice(relativeBase.length)
        : contract.path;
      const required = contract.requiredArgs.join(",");
      const optional = contract.optionalArgs.join(",");
      const visibleForbidden = contract.forbiddenArgs
        .filter((arg) => !identityArgs.has(arg))
        .join(",");
      if ((body.match(/^    when: /gm) ?? []).length !== 1
        || !body.includes(`    path: ${expectedPath}\n`)
        || (required ? !body.includes(`    requires: ${required}\n`) : /^    requires:/m.test(body))
        || (optional ? !body.includes(`    optional: ${optional}\n`) : /^    optional:/m.test(body))
        || (contract.id === "knowledge_tools_call"
          && !body.includes("    shape: params=object; empty={}\n"))
        || (visibleForbidden
          ? !body.includes(`    forbidden: ${visibleForbidden}\n`)
          : /^    forbidden:/m.test(body))
        || (contract.responseKind === "json"
          ? /^    response:/m.test(body)
          : !body.includes(`    response: ${contract.responseKind}\n`))) {
        throw new Error(`${id} v4 provider card diverged from its runtime contract`);
      }
    }
  }
}
