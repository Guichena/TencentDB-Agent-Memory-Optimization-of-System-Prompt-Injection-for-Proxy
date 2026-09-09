export const TOOL_PROMPT_FAMILIES = ["memory", "skill", "knowledge"] as const;

export type ToolPromptFamily = (typeof TOOL_PROMPT_FAMILIES)[number];

export const TOOL_PROMPT_SURFACES = [
  "memory-tools",
  "memory-guide",
  "skill-tools",
  "skill-listing",
  "knowledge-tools",
] as const;

export type ToolPromptSurface = (typeof TOOL_PROMPT_SURFACES)[number];

export const TOOL_PROMPT_PROFILES = ["v4-compact"] as const;
export type ToolPromptProfile = "v4-compact";
export type CompiledToolPromptProfile = ToolPromptProfile;

export type ToolPromptPhase = "read" | "lifecycle" | "write";
export type ToolPromptResponseKind = "json" | "bytes" | "dynamic-schema";

/** The primary responsibility of a prompt unit. A unit has one owner plane. */
export type PromptPlane = "decision" | "execution" | "runtime-binding";

/** Runtime truth derived from Bridge allowlists and downstream schemas. */
export interface RuntimeToolContract {
  id: string;
  family: ToolPromptFamily;
  phase: ToolPromptPhase;
  method: "POST";
  path: string;
  requiredHeaders: readonly string[];
  requiredArgs: readonly string[];
  optionalArgs: readonly string[];
  forbiddenArgs: readonly string[];
  responseKind: ToolPromptResponseKind;
  capability: string;
  sourceRefs: readonly string[];
}

export interface ToolPromptCapabilityState {
  memory: boolean;
  skill: boolean;
  knowledge: boolean;
  wiki: boolean;
  codeGraph: boolean;
  skillWrite: boolean;
  skillExtract: boolean;
}
