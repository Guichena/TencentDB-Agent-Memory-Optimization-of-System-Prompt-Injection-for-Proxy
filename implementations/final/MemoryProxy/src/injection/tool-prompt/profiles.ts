import { createHash } from "node:crypto";
import {
  type ToolPromptProfile,
} from "./types.js";

export function isFidelityDerivedProfile(profile: ToolPromptProfile): boolean {
  return profile === "v4-compact";
}

export function parseToolPromptProfile(value: unknown): ToolPromptProfile {
  if (value === "v4-compact") return value;
  throw new Error(`unsupported injection.toolPromptProfile ${JSON.stringify(value)}; this branch supports only v4-compact`);
}

export function toolPromptCacheIdentity(
  hookId: string,
  profile: ToolPromptProfile,
  capabilitySignature: string,
): string | undefined {
  parseToolPromptProfile(profile);
  const capabilityHash = createHash("sha256")
    .update(capabilitySignature)
    .digest("hex")
    .slice(0, 12);
  const revision = "-direct-20260909-3";
  return `${hookId}-tp-${profile}${revision}-${capabilityHash}`;
}

/**
 * Add the session asset mask to profile-sensitive cache entries. A session can
 * be rebound without changing the process-level profile signature, so the
 * persisted hook payload must not be shared across masks. Unknown flags are
 * encoded explicitly so a missing capability object cannot reuse an old entry.
 */
export function toolPromptCapabilityCacheSuffix(
  flags: {
    skill?: boolean;
    llm_wiki?: boolean;
    code_graph?: boolean;
    chat_memory?: boolean;
  } | undefined,
): string {
  return `-caps-${flags?.chat_memory === undefined ? "u" : Number(flags.chat_memory)}`
    + `-${flags?.skill === undefined ? "u" : Number(flags.skill)}`
    + `-${flags?.llm_wiki === undefined ? "u" : Number(flags.llm_wiki)}`
    + `-${flags?.code_graph === undefined ? "u" : Number(flags.code_graph)}`;
}
