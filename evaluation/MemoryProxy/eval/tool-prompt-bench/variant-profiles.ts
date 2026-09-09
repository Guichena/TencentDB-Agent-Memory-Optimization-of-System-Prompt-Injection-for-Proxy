import type { ToolPromptProfile } from "../../../../implementations/final/MemoryProxy/src/injection/tool-prompt/types.js";

export const TOOL_PROMPT_VARIANT_PROFILES = {
  V0: "legacy",
  "V0-C": "contract-corrected",
  V1a: "protocol-compact",
  V1: "compact",
  V2: "selection-calibrated",
  V3: "capability-pruned",
} as const satisfies Record<string, ToolPromptProfile>;

/** REPAIR exists only on codex/task1-repair-final and maps to its repaired profile. */
export type ToolPromptVariant = keyof typeof TOOL_PROMPT_VARIANT_PROFILES | "REPAIR";

export interface ResolvedToolPromptVariant {
  variant: ToolPromptVariant;
  profile: ToolPromptProfile;
}

export function resolveToolPromptVariant(value: string): ResolvedToolPromptVariant {
  if (value === "REPAIR") {
    return { variant: "REPAIR", profile: "fidelity-compact" as ToolPromptProfile };
  }
  if (Object.prototype.hasOwnProperty.call(TOOL_PROMPT_VARIANT_PROFILES, value)) {
    const variant = value as keyof typeof TOOL_PROMPT_VARIANT_PROFILES;
    return { variant, profile: TOOL_PROMPT_VARIANT_PROFILES[variant] };
  }
  throw new Error(
    `unsupported tool prompt variant ${JSON.stringify(value)}; expected one of ${[...Object.keys(TOOL_PROMPT_VARIANT_PROFILES), "REPAIR"].join(", ")}`,
  );
}
