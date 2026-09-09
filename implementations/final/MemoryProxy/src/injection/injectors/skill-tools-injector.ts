/**
 * Skill Tools Injector — injects a static `<skill_tools>` block describing
 * cloud-skill operations as curl recipes.
 *
 * Why static: the LLM does NOT see these as native tools (we don't push to
 * `body.tools` — the agent host wouldn't know how to handle them). Instead
 * the LLM uses its existing Bash tool to curl `<proxy_base>/skill-bridge/...`,
 * which the proxy's `/skill-bridge/*` reverse proxy then forwards to core
 * with auth + IdFields injected from the session.
 *
 * The block is rendered once per session (at session_init prewarm) — its
 * content depends only on the proxy base URL, which is stable for the
 * session.
 *
 * Tools injected:
 *   Always (read-only): skill_search, skill_view, skill_files_read,
 *                       skill_extract
 *   Only when allowLlmWrite=true: skill_create, skill_update, skill_patch,
 *                                skill_delete, skill_files_write, skill_files_remove
 *
 * Note: skill_list is intentionally omitted — the <available_skills> block
 * already provides the agent's owned skill catalogue at session init.
 *
 * Sister hook: `skill-injector.ts` produces the dynamic `<available_skills>`
 * block (agent-owned skill listing from /v3/skill/listing).
  *
 * See `docs/design/2026-06-17-team-skill-proxy-runtime.md` §4.
 */

import type {
  AgentContext,
  AnchorTarget,
  AssetCapabilityFlags,
  CacheStrategy,
  ContextBlock,
  HookPriority,
  InjectionHook,
  PrewarmInput,
} from "../types.js";
import { HOOK_PRIORITY } from "../types.js";
import { compileToolPrompt } from "../tool-prompt/compiler.js";
import {
  isFidelityCapabilityEnabled,
  resolveSessionCapabilitySignature,
} from "../tool-prompt/capability-pruned.js";
import { toolPromptCacheIdentity } from "../tool-prompt/profiles.js";
import { parseCapabilitySignature } from "../tool-prompt/runtime-contract.js";
import type { ToolPromptProfile } from "../tool-prompt/types.js";

export interface SkillToolsInjectorConfig {
  /**
   * Base URL the LLM should curl. Filled into every `<tool>` recipe.
   * E.g. `http://127.0.0.1:8096`. Trailing slash trimmed.
   */
  proxyBaseUrl: string;
  /**
   * 是否允许主模型创建/修改 skill。默认 false。
   * false 时只注入只读工具（search/list/view/files_read）。
   * 显式设为 true 后注入全部 10 个工具。
   */
  allowLlmWrite?: boolean;
  toolPromptProfile?: ToolPromptProfile;
  capabilitySignature?: string;
}

export class SkillToolsInjector implements InjectionHook {
  id = "skill-tools-injector";
  point = "system.before_tools" as const;
  /** Place ahead of `<available_skills>` (which uses slot=skills, before). */
  anchor: AnchorTarget = { slot: "skills", relation: "before" };
  /** Slightly higher priority than SkillInjector so this block precedes it. */
  priority: HookPriority = HOOK_PRIORITY.SKILL - 1;
  description = "Inject the static <skill_tools> curl-recipe block.";
  /** Block content depends only on proxy base URL — fully session-static. */
  cacheStrategy: CacheStrategy = "session_init";
  cacheIdentity?: string;

  constructor(private config: SkillToolsInjectorConfig) {
    this.cacheIdentity = toolPromptCacheIdentity(
      this.id,
      config.toolPromptProfile ?? "v4-compact",
      config.capabilitySignature ?? "unconfigured",
    );
  }

  async execute(ctx: AgentContext): Promise<ContextBlock[]> {
    const caps = ctx.metadata.custom?.assetCapabilities as AssetCapabilityFlags | undefined;
    if (caps?.skill === false) return [];
    return this.renderBlocks(ctx, undefined, undefined, caps);
  }

  async prewarm(input: PrewarmInput): Promise<ContextBlock[]> {
    if (input.assetCapabilities?.skill === false) return [];
    return this.renderBlocks(
      undefined,
      input.sessionInfo.session_id,
      input.sessionInfo.space_id,
      input.assetCapabilities,
    );
  }

  private renderBlocks(
    ctx?: AgentContext,
    prewarmSessionId?: string,
    prewarmSpaceId?: string,
    assetCapabilities?: AssetCapabilityFlags,
  ): ContextBlock[] {
    const allowLlmWrite = this.config.allowLlmWrite ?? false;

    let sessionId = prewarmSessionId;
    let spaceId = prewarmSpaceId;
    if (ctx) {
      const custom = ctx.metadata.custom as Record<string, unknown> | undefined;
      const session = custom?.session as Record<string, unknown> | undefined;
      const sid = session?.session_id;
      if (typeof sid === "string" && sid.length > 0) {
        sessionId = sid;
      }
      const sp = session?.space_id;
      if (typeof sp === "string" && sp.length > 0) {
        spaceId = sp;
      }
    }

    const profile = this.config.toolPromptProfile ?? "v4-compact";
    const baseSignature = this.config.capabilitySignature ?? "unconfigured";
    if (!isFidelityCapabilityEnabled("skill", assetCapabilities)) {
      return [];
    }
    const capabilitySignature = resolveSessionCapabilitySignature(baseSignature, assetCapabilities);
    if (parseCapabilitySignature(capabilitySignature).skillWrite && !allowLlmWrite) {
      throw new Error("skill_write capability requires allowLlmWrite");
    }
    const content = compileToolPrompt({
      family: "skill", surface: "skill-tools", capabilitySignature,
      endpointBase: this.config.proxyBaseUrl.replace(/\/$/, "") + "/skill-bridge/v3/skill",
      headers: [
        ...(spaceId ? [["x-tdai-service-id", spaceId] as const] : []),
        ...(sessionId ? [["x-conversation-id", sessionId] as const] : []),
      ],
    }).content;
    return [{
      type: "text",
      content,
      metadata: {
        source: this.id,
        // Stable cache-dedup key — varies by allowLlmWrite to avoid stale cache
        cacheKey: `skill-tools-injector:catalog:${allowLlmWrite ? "rw" : "ro"}`
          + `:${capabilitySignature}`,
        toolPromptProfile: profile,
        toolPromptFamily: "skill",
        toolPromptSurface: "skill-tools",
        capabilitySignature,
      },
    }];
  }
}
