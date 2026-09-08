import { parseCapabilitySignature, buildCapabilitySignature } from "./runtime-contract.js";
import { getVisibleRuntimeToolContracts } from "./capability-pruned.js";
import type { ToolPromptSurface } from "./types.js";
import type { CompiledToolPromptProfile } from "./types.js";
const GLOBAL_STOP_ERROR_RULES = [
  "## Global stop and error rules",
  "- 4xx: no retry; 5xx: once.",
  "- Stop when the user's goal is answerable.",
  "- Read each L2 path at most once/turn.",
] as const;
import { buildPromptIR } from "./prompt-ir.js";
import { lintV4ActionFields, lintV4DecisionFields, renderV4ToolCard, V4_SHARED_DEFAULTS } from "./readable-shared-defaults.js";

export interface FidelityPromptSurfaceEntry {
  surface: ToolPromptSurface;
  content: string;
}

const TOOL_SURFACE_ORDER = ["memory-tools", "skill-tools", "knowledge-tools"] as const;
const DYNAMIC_SURFACES = new Set<ToolPromptSurface>([
  "memory-guide",
  "skill-listing",
]);

/**
 * The fidelity profile keeps these two shared sections byte-stable across
 * capability signatures. Capability-specific facts belong after the bitmap.
 */
const V4_SHARED_PROTOCOL = [
  "## 统一工具调用协议",
  "这些不是原生函数；需要时用可用的 Shell 工具执行 curl。",
  "- CALL 时必须实际执行 HTTP 请求并检查响应；只输出工具名/path/body 或描述准备调用不等于执行，不得编造结果。",
  "- POST JSON；endpoint=family `endpoint-base`+`path`（Knowledge 用资源 `url`+`path`）。",
  "- 只传卡片参数；身份只走 Runtime bindings，除非列为 optional。",
  "- `<bindings>` 展开为当前 family 的 Runtime bindings 中每个 header 的 `-H 'name: value'`；不要遗漏 header、照抄占位符或把 header 填进 body。",
  "- Types: limit/offset/version/expected_version=integer; time_start/time_end=ISO-8601; type=episodic|persona|instruction; include_content/include_manifest/replace_all/is_executable=boolean.",
  "- 成功条件：HTTP 成功且 JSON `code=0`；否则读 `message`。",
  "- `response: bytes` 才是原始字节；仅落盘时用 `-o`。",
  "canonical form: `curl -sSk -X POST '<endpoint>' -H 'content-type: application/json' <bindings> -d '<body>'`",
  "- PowerShell 使用 `curl.exe`；JSON 有引号/换行等转义风险时，先写入 UTF-8 无 BOM 文件，再用 `--data-binary '@<json-file>'` 代替 `-d '<body>'`。",
].join("\n");

/** Canonical global rules used by both final layout and the effective IR.
 * Compatibility surface gates are transport placeholders, not V4 truth. */
export const V4_EFFECTIVE_GLOBAL_RULES: Readonly<Record<string, string>> = Object.freeze({
  "must-call": [
    "CALL if enabled persistent assets supply missing required context, or a requested supported write/lifecycle action matches a card.",
    "- Memory enabled: MUST retrieve required user history, preferences, prior decisions, exact wording or scene content missing from current context/L3 before answering. An L2 path or summary is not the scene body.",
    "- Skill enabled: load a matching skill only when the task explicitly requests its use or requires a specific team workflow/convention, and the needed instructions are missing from context. A name/description is not the instructions; topical relevance or ordinary coding alone does not require loading.",
  ].join("\n"),
  "no-call": "NO_CALL for self-contained coding/general knowledge with no missing asset-dependent facts or workflow, or when all required facts/instructions are already in context (including L3 and prior tool results). Keyword overlap alone never triggers a call.",
  "family-route": [
    "Asset source routing: route by the missing evidence, not by a topic keyword.",
    "- Remembered decision, agreement, or rationale -> Memory first; executable workflow, ordered procedure, checklist, or required Skill resource -> Skill first; cross-file structure or design rationale -> Knowledge first.",
    "- A convention can belong to either family: use Memory for its history/rationale and Skill for applying its operational steps.",
    "- If Memory results still lack required steps, consult a relevant Skill instead of repeating the same search.",
    "- These are priorities, not exclusive ownership. Use another family only when the required evidence remains unresolved.",
    "- A repository name, filename, identifier, acronym, or technical term alone does not determine the source.",
    "- A keyword, summary, Skill name, or description alone is not sufficient evidence for a required workflow.",
    "- For a Skill-shaped task, obtain the Skill body first; read or download an attachment only when the task or Skill body requires that attachment.",
  ].join("\n"),
  selection: "Choose the narrowest matching `when`; obey `avoid`/`contrast`; keep all families available and stop only when the required evidence is sufficient.",
  protocol: V4_SHARED_PROTOCOL,
  defaults: V4_SHARED_DEFAULTS.join("\n"),
  stop: GLOBAL_STOP_ERROR_RULES.join("\n"),
});

const V4_SHARED_GATE = ["## Tool / no-tool gate", ...["must-call", "no-call", "family-route", "selection"]
  .map(key => V4_EFFECTIVE_GLOBAL_RULES[key])].join("\n");

/** Stable physical order for the provider-visible fidelity injection area. */
export function assembleFidelityInjectionRegion(
  entries: readonly FidelityPromptSurfaceEntry[],
  capabilitySignature: string,
  profile: CompiledToolPromptProfile = "v4-compact",
): string {
  const state = parseCapabilitySignature(capabilitySignature);
  const bySurface = new Map<ToolPromptSurface, string>();
  for (const entry of entries) {
    if (bySurface.has(entry.surface)) {
      throw new Error(`fidelity prompt layout received duplicate ${entry.surface}`);
    }
    bySurface.set(entry.surface, entry.content);
  }

  const shared = { grammar: "", gate: "" };
  const toolContents: string[] = [];
  const staticGuidance: string[] = [];
  const runtimeBindings: string[] = [];
  const skillAssets: string[] = [];
  const knowledgeAssets: string[] = [];
  const memoryAssets: string[] = [];

  for (const surface of TOOL_SURFACE_ORDER) {
    const source = bySurface.get(surface);
    if (source === undefined) continue;
    let content = source;
    const bindings = takeRuntimeBindings(content);
    content = bindings.content;
    runtimeBindings.push(...bindings.lines.map((line) => `- ${surface}: ${line}`));
    if (surface === "knowledge-tools") {
      const resources = takeKnowledgeResources(content);
      content = resources.content;
      knowledgeAssets.push(...resources.resources);
    }
    toolContents.push(content.trim().replace(/\n{3,}/g, "\n\n"));
  }

  for (const surface of ["memory-guide", "skill-listing"] as const) {
    const source = bySurface.get(surface);
    if (source === undefined) continue;
    const extracted = surface === "memory-guide"
      ? takeMemoryProfile(source)
      : takeSkillListing(source);
    staticGuidance.push(extracted.content.trim());
    if (extracted.dynamic) {
      if (surface === "skill-listing") skillAssets.push(extracted.dynamic);
      else memoryAssets.push(extracted.dynamic);
    }
  }

  if (toolContents.length > 0) {
    shared.grammar = `${V4_EFFECTIVE_GLOBAL_RULES.protocol}\n${V4_EFFECTIVE_GLOBAL_RULES.stop}`;
    shared.gate = V4_SHARED_GATE;
    const opening = toolContents[0]!.indexOf("\n");
    toolContents[0] = toolContents[0]!.slice(0, opening)
      + "\n\n" + V4_SHARED_DEFAULTS.join("\n") + toolContents[0]!.slice(opening);
  }

  const bitmap = [
    `memory=${Number(state.memory)}`,
    `skill=${Number(state.skill)}`,
    `knowledge=${Number(state.knowledge)}`,
    `wiki=${Number(state.wiki)}`,
    `code_graph=${Number(state.codeGraph)}`,
    `skill_write=${Number(state.skillWrite)}`,
    `skill_extract=${Number(state.skillExtract)}`,
  ].join(";");
  const visibleBindings = groupRuntimeBindings(runtimeBindings);
  const sections = [
    "<task1_prompt_injection>",
    shared.grammar,
    shared.gate,
    "## Capability bitmap",
    `capability-bitmap: ${bitmap}`,
    ...toolContents,
    ...staticGuidance,
    ...(visibleBindings.length > 0
      ? ["## Runtime bindings", ...visibleBindings]
      : []),
    ...([...skillAssets, ...knowledgeAssets, ...memoryAssets].length > 0
      ? ["## Runtime assets", ...skillAssets, ...knowledgeAssets, ...memoryAssets]
      : []),
    "</task1_prompt_injection>",
  ];
  return sections.filter((line) => line !== "").join("\n\n");
}

function groupRuntimeBindings(rows: readonly string[]): string[] {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const match = /^- ([^:]+): (.+)$/.exec(row);
    if (!match) throw new Error(`malformed runtime binding row: ${row}`);
    const surfaces = grouped.get(match[2]!) ?? [];
    surfaces.push(match[1]!);
    grouped.set(match[2]!, surfaces);
  }
  return [...grouped].map(([binding, surfaces]) => `- ${surfaces.join(",")}: ${binding}`);
}

/** Validate the exact provider-visible region after shared sections are moved. */
export function lintAssembledFidelityInjectionRegion(
  region: string,
  capabilitySignature: string,
  profile: CompiledToolPromptProfile = "v4-compact",
): void {
  const state = parseCapabilitySignature(capabilitySignature);
  if (countLiteral(region, "<task1_prompt_injection>") !== 1
    || countLiteral(region, "</task1_prompt_injection>") !== 1) {
    throw new Error("fidelity assembled region must have exactly one wrapper");
  }

  const grammar = region.indexOf("## 统一工具调用协议");
  const gate = region.indexOf("## Tool / no-tool gate");
  const bitmap = region.indexOf("## Capability bitmap");
  if (grammar < 0 || gate < 0 || bitmap < 0 || grammar > gate || gate > bitmap) {
    throw new Error("fidelity assembled region has invalid shared-section order");
  }

  const activeFamilies = [
    ...(state.memory ? ["memory"] : []),
    ...(state.skill ? ["skill"] : []),
    ...(state.knowledge ? ["knowledge"] : []),
  ];
  const expectedSharedCount = activeFamilies.length > 0 ? 1 : 0;
  for (const marker of ["## 统一工具调用协议", "## Tool / no-tool gate"]) {
    if (countLiteral(region, marker) !== expectedSharedCount) {
      throw new Error(`${marker} expected ${expectedSharedCount} in assembled region`);
    }
  }
  // V4 compact emits `Route:`; older snapshots used `Route first:`. Keep the
  // linter tolerant of this cosmetic label while still requiring one complete
  // family route.
  const compactRoute = region.match(/^Route(?: first)?:.*$/gm) ?? [];
  for (const family of ["memory", "skill", "knowledge"] as const) {
    const rowCount = [...region.matchAll(new RegExp(`^- ${family}:`, "gm"))].length;
    const hasCompactFamily = compactRoute.length === 1 && compactRoute[0]!.includes(`${family}=`);
    const expected = expectedSharedCount;
    if (rowCount + Number(hasCompactFamily) !== expected) {
      throw new Error(`${family} family route expected ${expected} in assembled region`);
    }
  }

  const toolSurfaceFamilies: Array<readonly [string, "memory" | "skill" | "knowledge"]> = [
    ["<tdai_memory_tools>", "memory"],
    ["<skill_tools>", "skill"],
    ["<knowledge_tools>", "knowledge"],
  ];
  const presentToolFamilies = new Set(
    toolSurfaceFamilies
      .filter(([tag]) => region.includes(tag))
      .map(([, family]) => family),
  );
  for (const family of presentToolFamilies) {
    if (!state[family]) {
      throw new Error(`disabled ${family} capability produced a fidelity tool surface`);
    }
  }
  const actualToolIds = [...region.matchAll(/<tool name="([^"]+)">/g)].map((match) => match[1]);
  const expectedToolIds = getVisibleRuntimeToolContracts(capabilitySignature)
    .filter((contract) => presentToolFamilies.has(contract.family))
    .map((contract) => contract.id);
  if (JSON.stringify([...actualToolIds].sort()) !== JSON.stringify([...expectedToolIds].sort())) {
    throw new Error(
      `assembled fidelity tool surface mismatch: expected ${expectedToolIds.join(",")}; got ${actualToolIds.join(",")}`,
    );
  }

  const firstTool = region.indexOf("<tdai_memory_tools>") >= 0
    ? region.indexOf("<tdai_memory_tools>")
    : region.indexOf("<skill_tools>") >= 0
      ? region.indexOf("<skill_tools>")
      : region.indexOf("<knowledge_tools>");
  if (firstTool >= 0 && bitmap > firstTool) {
    throw new Error("fidelity capability bitmap must precede tool surfaces");
  }
  const orderedToolTags = ["<tdai_memory_tools>", "<skill_tools>", "<knowledge_tools>"]
    .map((tag) => region.indexOf(tag))
    .filter((index) => index >= 0);
  if (orderedToolTags.some((index, position) => position > 0 && index < orderedToolTags[position - 1])) {
    throw new Error("fidelity tool surfaces are out of order");
  }
  const listing = region.indexOf("## Available skills");
  const bindings = region.indexOf("## Runtime bindings");
  const assets = region.indexOf("## Runtime assets");
  if (listing >= 0 && firstTool >= 0 && listing < firstTool) {
    throw new Error("fidelity static guidance must follow tool surfaces");
  }
  if (bindings >= 0 && listing >= 0 && bindings < listing) {
    throw new Error("fidelity runtime bindings must follow static guidance");
  }
  if (assets >= 0 && bindings < 0) {
    throw new Error("fidelity runtime assets require a runtime bindings section");
  }
  if (assets >= 0 && bindings >= 0 && assets < bindings) {
    throw new Error("fidelity runtime assets must follow runtime bindings");
  }
  if (profile === "v4-compact") {
    // Validate the output after layout, including the defaults that make sparse cards meaningful.
    if (countLiteral(region, `capability-bitmap: ${buildCapabilitySignature(state)}\n`) !== 1) {
      throw new Error("v4 final capability bitmap changed");
    }
    for (const section of [V4_SHARED_PROTOCOL, V4_SHARED_GATE, V4_SHARED_DEFAULTS.join("\n"), GLOBAL_STOP_ERROR_RULES.join("\n")]) {
      if (countLiteral(region, section) !== 1) {
        throw new Error("v4 assembled shared rules are missing, duplicated or changed");
      }
    }
    const prefix = bindings < 0 ? region : region.slice(0, bindings);
    if (/^endpoint-base: https?:\/\//m.test(prefix)) {
      throw new Error("v4 endpoint binding leaked into static prefix");
    }
    const tools = [...presentToolFamilies].flatMap((family) => buildPromptIR({
      family, capabilitySignature,
      contracts: getVisibleRuntimeToolContracts(capabilitySignature, family),
    }).tools);
    for (const card of region.matchAll(/  <tool name="([^"]+)">\n([\s\S]*?)  <\/tool>/g)) {
      const tool = tools.find((tool) => tool.toolId === card[1]);
      if (!tool) throw new Error(`v4 assembled unexpected tool ${card[1]}`);
      lintV4ActionFields(card[2]!, tool);
      lintV4DecisionFields(card[2]!, tool);
      if (card[0] !== renderV4ToolCard(tool)) throw new Error(`${tool.toolId} final card contract changed`);
    }
  }
}

function countLiteral(source: string, fragment: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(fragment, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + fragment.length;
  }
}

function takeRuntimeBindings(source: string): { content: string; lines: string[] } {
  const lines = [...source.matchAll(/^headers: (.+)$/gm)].map((match) => match[1]);
  // Concrete addresses are session/deployment bindings; Knowledge's resource rule is static.
  const endpoints = [...source.matchAll(/^endpoint-base: https?:\/\/\S+\r?$/gm)];
  return {
    content: endpoints.reduce((text, match) => text.replace(match[0], ""), source.replace(/^headers: .+\n?/gm, "")),
    lines: [...endpoints.map((match) => match[0].trim()), ...lines],
  };
}

function takeKnowledgeResources(source: string): {
  content: string;
  resources: string[];
} {
  const resources = [...source.matchAll(/^<knowledge type="(?:wiki|code-graph)"[\s\S]*? \/>$/gm)]
    .map((match) => match[0]);
  return {
    content: source
      .replace(/^<knowledge type="(?:wiki|code-graph)"[\s\S]*? \/>\n?/gm, "")
      .replace(/^## 已绑定资源\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n"),
    resources,
  };
}

function takeMemoryProfile(source: string): { content: string; dynamic: string | null } {
  const matches = [...source.matchAll(/<tdai_profile_memory>[\s\S]*?<\/tdai_profile_memory>/g)];
  if (matches.length > 1) throw new Error("fidelity prompt layout found duplicate memory profile");
  if (matches.length === 0) return { content: source, dynamic: null };
  const dynamic = matches[0][0];
  return {
    content: source.replace(dynamic, "").replace(/\n{3,}/g, "\n\n"),
    dynamic,
  };
}

function takeSkillListing(source: string): { content: string; dynamic: string | null } {
  const matches = [...source.matchAll(/^<available_skills>[\s\S]*?^<\/available_skills>$/gm)];
  if (matches.length > 1) throw new Error("fidelity prompt layout found duplicate skill listing");
  if (matches.length === 0) return { content: source, dynamic: null };
  const dynamic = matches[0][0];
  return {
    content: source.replace(dynamic, "").replace(/\n{3,}/g, "\n\n"),
    dynamic,
  };
}

export const FIDELITY_TOOL_SURFACE_ORDER = TOOL_SURFACE_ORDER;
export const FIDELITY_DYNAMIC_SURFACES = DYNAMIC_SURFACES;
