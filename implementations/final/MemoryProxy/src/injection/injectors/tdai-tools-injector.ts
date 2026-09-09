/**
 * TdaiMemoryToolsInjector — inject a static `<tdai_memory_tools>` text block
 * that teaches the LLM to curl `<proxy>/memory-bridge/v3/*` for TDAI memory
 * read operations.
 *
 * 设计与 skill-tools-injector 完全同形（参见 docs/design/2026-06-17-team-skill-proxy-runtime.md §4）：
 *
 *   Why static (NOT native tool defs):
 *     agent host (IDE / Claude Code) 不识别 native tool；改让 LLM 用现有 Bash
 *     工具去 curl 一个 proxy 路径，proxy 端反向代理到 tdai gateway，期间注入
 *     IdFields + Bearer，rules out LLM 伪造身份 + 防止 token 进入 prompt。
 *
 *   Tools 集合（**只读**，静态注入 system prompt，cache 友好）：
 *     - tdai_memory_search       L1 双路 hybrid search（atomic/search）
 *     - tdai_atomic_query        L1 按 type / 时间 / 分页（atomic/query）
 *     - tdai_conversation_search L0 对话 hybrid search（conversation/search）
 *     - tdai_conversation_query  L0 按 session 取历史（conversation/query）
 *     - tdai_scenario_ls         L2 列出 scene_blocks 路径索引
 *     - tdai_read_scene          L2 按 path 读全文
 *
 *   设计取舍：
 *     - L0/L1 **不再每轮自动召回**注入到 user prompt（会破坏 KV/prompt cache），
 *       改为静态工具按需检索；system prompt 稳定 → 命中 prompt cache。
 *     - L3（persona）由 tdai-profile-memory-injector **直接注入** system，无需工具。
 *     - L2 索引也直接注入 system（`<l2_scene_index>`），正文按需用 read_scene。
 *
 *   写操作 (atomic/update / conversation/delete / scenario/write / scenario/rm / core/write)
 *   不在 bridge allowlist 里；写入由主链路注入器控制。
 *
 *   注入点：`system.suffix`（不像 skill 是 `tools.append`，因为我们不再用
 *   native tool）。在 system prompt 末尾贴一段说明，告诉 LLM 这些 endpoint
 *   存在以及调用方法。
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
import { getTdaiIdentity } from "../../tdai/identity.js";
import { compileToolPrompt } from "../tool-prompt/compiler.js";
import {
  isFidelityCapabilityEnabled,
  resolveSessionCapabilitySignature,
} from "../tool-prompt/capability-pruned.js";
import { toolPromptCacheIdentity } from "../tool-prompt/profiles.js";
import type { ToolPromptProfile } from "../tool-prompt/types.js";

export interface TdaiMemoryToolsInjectorConfig {
  /**
   * Base URL the LLM should curl. Filled into every curl recipe.
   * E.g. `http://127.0.0.1:8096`. Trailing slash trimmed.
   */
  proxyBaseUrl: string;
  toolPromptProfile?: ToolPromptProfile;
  capabilitySignature?: string;
}

export class TdaiMemoryToolsInjector implements InjectionHook {
  id = "tdai-memory-tools-injector";
  point = "system.suffix" as const;
  anchor: AnchorTarget = { slot: "memory", relation: "before" };
  priority: HookPriority = HOOK_PRIORITY.MEMORY + 5;
  description = "Inject <tdai_memory_tools> curl recipes block into system prompt";
  /** Static tool instructions are session-stable; render once at session_init. */
  cacheStrategy: CacheStrategy = "session_init";
  cacheIdentity?: string;

  constructor(private cfg: TdaiMemoryToolsInjectorConfig) {
    this.cacheIdentity = toolPromptCacheIdentity(
      this.id,
      cfg.toolPromptProfile ?? "v4-compact",
      cfg.capabilitySignature ?? "unconfigured",
    );
  }

  execute(ctx: AgentContext): ContextBlock[] {
    const caps = ctx.metadata.custom?.assetCapabilities as AssetCapabilityFlags | undefined;
    if (caps?.chat_memory === false) return [];
    // 没识别身份 → 不注入（即便 LLM 调 curl，bridge 也会 401）
    const identity = getTdaiIdentity(ctx.metadata.custom);
    if (!identity) return [];
    const session = (ctx.metadata.custom as Record<string, unknown> | undefined)?.session as
      | Record<string, unknown>
      | undefined;
    const spaceId = typeof session?.space_id === "string" ? session.space_id : undefined;
    return this.renderBlocks(identity.sessionId, spaceId, caps);
  }

  prewarm(input: PrewarmInput): ContextBlock[] {
    if (input.assetCapabilities?.chat_memory === false) return [];
    return this.renderBlocks(
      input.sessionInfo.session_id,
      input.sessionInfo.space_id,
      input.assetCapabilities,
    );
  }

  private renderBlocks(
    sessionId: string,
    spaceId?: string,
    assetCapabilities?: AssetCapabilityFlags,
  ): ContextBlock[] {
    const profile = this.cfg.toolPromptProfile ?? "v4-compact";
    const baseSignature = this.cfg.capabilitySignature ?? "unconfigured";
    if (!isFidelityCapabilityEnabled("memory", assetCapabilities)) {
      return [];
    }
    const capabilitySignature = resolveSessionCapabilitySignature(baseSignature, assetCapabilities);
    const content = compileToolPrompt({
      family: "memory", surface: "memory-tools", capabilitySignature,
      endpointBase: this.cfg.proxyBaseUrl.replace(/\/$/, "") + "/memory-bridge/v3",
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
        sessionId,
        cacheKey: "tdai-memory-tools-injector:tools"
          + `:${capabilitySignature}`,
        toolPromptProfile: profile,
        toolPromptFamily: "memory",
        toolPromptSurface: "memory-tools",
        capabilitySignature,
      },
    }];
  }
}
