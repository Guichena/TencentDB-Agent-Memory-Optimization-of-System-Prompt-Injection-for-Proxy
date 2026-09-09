import type { AgentContext, AnchorTarget, AssetCapabilityFlags, CacheStrategy, ContextBlock, InjectionHook, HookPriority, PrewarmInput } from "../types.js";
import { HOOK_PRIORITY } from "../types.js";
import { TdaiClient } from "../../tdai/client.js";
import type { TdaiMemoryConfig } from "../../tdai/types.js";
import { getTdaiIdentity } from "../../tdai/identity.js";
import type { CoreSkillConfig } from "../../types.js";
import { getMetadataClient } from "../../meta/client.js";
import { resolveFixedAssetCtxs, type FixedAssetCtx } from "./tdai-fixed-asset.js";
import { compileToolPrompt, MEMORY_GUIDANCE } from "../tool-prompt/compiler.js";
import {
  isFidelityCapabilityEnabled,
  resolveSessionCapabilitySignature,
} from "../tool-prompt/capability-pruned.js";
import { toolPromptCacheIdentity } from "../tool-prompt/profiles.js";
import type { ToolPromptProfile } from "../tool-prompt/types.js";

/**
 * L2/L3 注入（按 openclaw / hermes 官方做法重构）：
 *   - L3 (persona) → 注入完整内容（稳定且通常较短，作为长期画像）
 *   - L2 (scenarios) → **只注入 Scene Navigation 索引（路径列表 + summary）**，
 *     不预读全文。LLM 需要细节时主动调 `tdai_read_scene` 工具按 path 拉取。
 *   - 同时附 memory-tools-guide 文案，告诉 LLM 怎么用工具 + 调用上限。
 *
 * 这样可以：
 *   1. 大幅降低首轮 token 消耗（L2 全文经常上千 chars × N 个）
 *   2. 让 LLM 按需取文，而不是被无关的场景污染上下文
 *
 * 跨 agent："自有 + 借入"按 agent 分段；每段下面 L3 + Scene 索引并列。
 *
 * 控制面不可达时降级：仅注入当前 agent 的 L3 + Scene 索引。
 */
export class TdaiProfileMemoryInjector implements InjectionHook {
  id = "tdai-profile-memory-injector";
  point = "system.suffix" as const;
  anchor: AnchorTarget = { slot: "memory", relation: "inside_append" };
  priority: HookPriority = HOOK_PRIORITY.MEMORY + 10;
  description = "Inject TDAI L3 (persona) + L2 scene index (path-only, agent reads via tool)";
  /** L2/L3 profile snapshot is injected once after session registration, like skill listing. */
  cacheStrategy: CacheStrategy = "session_init";
  cacheIdentity?: string;

  /**
   * @param baseConfig  starter TdaiClient config; per-request `serviceId` will
   *   be overridden with `session.space_id` in `renderBlocksForContext`. This
   *   config's `serviceId` acts as a fallback when no `space_id` is present.
   * @param coreSkillCfg  kernel gateway config for MetadataClient (fixed-asset
   *   agent resolution).
   */
  constructor(
    private baseConfig: TdaiMemoryConfig,
    private coreSkillCfg: Pick<CoreSkillConfig, "endpoint" | "serviceToken" | "serviceId" | "timeoutMs"> | null = null,
    private toolPromptProfile: ToolPromptProfile = "v4-compact",
    private capabilitySignature = "unconfigured",
  ) {
    this.cacheIdentity = toolPromptCacheIdentity(
      this.id,
      this.toolPromptProfile,
      this.capabilitySignature,
    );
  }

  async execute(ctx: AgentContext): Promise<ContextBlock[]> {
    const caps = ctx.metadata.custom?.assetCapabilities as { chat_memory?: boolean } | undefined;
    if (caps?.chat_memory === false) return [];
    return this.renderBlocksForContext(ctx);
  }

  async prewarm(input: PrewarmInput): Promise<ContextBlock[]> {
    if (input.assetCapabilities?.chat_memory === false) return [];
    return this.renderBlocksForContext(createPrewarmAgentContext(input));
  }

  private async renderBlocksForContext(ctx: AgentContext): Promise<ContextBlock[]> {
    const identity = getTdaiIdentity(ctx.metadata.custom);
    if (!identity) return [];

    const session = (ctx.metadata.custom as any)?.session as { user_key?: string; space_id?: string } | undefined;
    const userKey = session?.user_key;
    // spaceId 来自 session 注册时保存的 URL path 中的 `/proxy/<spaceId>/...`；
    // 用作内核的 `x-tdai-service-id` 头做租户路由。空字符串会被内核拒绝（invalid_user_key）
    // —— caller 已在 session-init 阶段做 bypass 处理。
    const spaceId = session?.space_id ?? "";
    const mc = this.coreSkillCfg && userKey
      ? getMetadataClient(this.coreSkillCfg, spaceId, userKey)
      : null;
    const ctxs = await resolveFixedAssetCtxs(ctx, identity, mc);

    // Build a per-request TdaiClient with the correct tenant. Falls back to
    // baseConfig.serviceId (config value) when spaceId is empty.
    const client = new TdaiClient({
      ...this.baseConfig,
      serviceId: spaceId || this.baseConfig.serviceId,
    });

    // 对每个 agent 独立拉 L3 + L2 索引（不读 L2 全文）
    const groups = await Promise.all(ctxs.map((c) => loadAgentProfile(
      client,
      c,
    )));

    const assetCapabilities = ctx.metadata.custom?.assetCapabilities as
      | AssetCapabilityFlags
      | undefined;
    if (!isFidelityCapabilityEnabled("memory", assetCapabilities)) {
      return [];
    }
    const capabilitySignature = resolveSessionCapabilitySignature(this.capabilitySignature, assetCapabilities);
    const guide = compileToolPrompt({
      family: "memory", surface: "memory-guide", capabilitySignature,
    }).content;
    const block = renderTdaiProfileMemoryBlock(groups.map((group) => ({
      agentName: group.ctx.agentName,
      agentId: group.ctx.agentId,
      isSelf: group.ctx.isSelf,
      l3Content: group.l3?.content,
      l2Entries: group.l2Entries,
    })), guide);
    block.metadata = {
      ...block.metadata,
      cacheKey: `tdai-profile-memory-injector:${capabilitySignature}`,
      toolPromptProfile: this.toolPromptProfile,
      toolPromptFamily: "memory",
      toolPromptSurface: "memory-guide",
      capabilitySignature,
    };
    return [block];
  }
}

export interface TdaiProfileRenderGroup {
  agentName: string;
  agentId: string;
  isSelf: boolean;
  l3Content?: string;
  l2Entries: Array<{ path: string; summary?: string }>;
}

/** Production renderer shared by the live injector and fixture-backed evals. */
export function renderTdaiProfileMemoryBlock(
  groups: TdaiProfileRenderGroup[],
  guide = MEMORY_TOOLS_GUIDE,
): ContextBlock {
  const populated = groups.filter((group) => group.l3Content || group.l2Entries.length > 0);
  if (populated.length === 0) {
    return {
      type: "text",
      content: guide,
      metadata: { source: "tdai-profile-memory-injector", agentCount: 0, l3Count: 0, l2Count: 0, mode: "tools-only" },
    };
  }

  const lines: string[] = [
    "<tdai_profile_memory>",
    "以下是 TDAI 为当前 agent 维护的长期工作记忆（自有 + 借入分段；L2 仅给索引，按需用工具读全文）：",
  ];
  let l2TotalCount = 0;
  let l3Count = 0;
  for (const group of populated) {
    const role = group.isSelf ? "self" : "imported_from";
    lines.push(`<agent name="${xmlAttrEscape(group.agentName)}" role="${role}" agent_id="${xmlAttrEscape(group.agentId)}">`);
    if (group.l3Content) {
      l3Count++;
      lines.push("<l3_core_memory>", escapePromptData(truncate(group.l3Content, 6000)), "</l3_core_memory>");
    }
    if (group.l2Entries.length > 0) {
      lines.push("<l2_scene_index>");
      for (const entry of group.l2Entries) {
        l2TotalCount++;
        lines.push(entry.summary
          ? `- \`${escapePromptData(entry.path)}\` — ${escapePromptData(truncate(entry.summary, 200))}`
          : `- \`${escapePromptData(entry.path)}\``);
      }
      lines.push("</l2_scene_index>");
    }
    lines.push("</agent>");
  }
  lines.push("</tdai_profile_memory>", "", guide);
  return {
    type: "text",
    content: lines.join("\n"),
    metadata: {
      source: "tdai-profile-memory-injector",
      agentCount: groups.length,
      l3Count,
      l2IndexCount: l2TotalCount,
      mode: "index+tools",
    },
  };
}

function xmlAttrEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Keep backend/user memory data inside the intended text fields. */
function escapePromptData(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "\\`");
}

function createPrewarmAgentContext(input: PrewarmInput): AgentContext {
  return {
    messages: [],
    tools: [],
    requestParams: {},
    metadata: {
      protocol: "anthropic",
      traceId: `prewarm:${input.keyId}`,
      keyId: input.keyId,
      modelId: "prewarm",
      stream: false,
      agentSource: "session-init",
      custom: {
        session: input.sessionInfo,
        assetCapabilities: input.assetCapabilities,
      },
    },
  };
}

/** 记忆使用指南：L0/L1 按需用工具检索（不再自动召回），L3 直注、L2 索引直注。 */
export const MEMORY_TOOLS_GUIDE = MEMORY_GUIDANCE;

interface AgentProfileBundle {
  ctx: FixedAssetCtx;
  l3: { content: string } | null;
  /** L2 索引：仅 path + 可选 summary，**不**读全文。 */
  l2Entries: Array<{ path: string; summary?: string }>;
}

async function loadAgentProfile(
  client: TdaiClient,
  c: FixedAssetCtx,
): Promise<AgentProfileBundle> {
  const tdaiCtx = { teamId: c.teamId, userId: c.userId, agentId: c.agentId, agentName: c.agentName };
  const [l3, l2Entries] = await Promise.all([
    client.readL3ForCtx(tdaiCtx),
    client.listL2ForCtx(tdaiCtx),
  ]);
  // L3(persona) 可能在尾部内嵌一份「Scene Navigation」场景索引（plugin 侧 read 会带导航段）。
  // 我们已经单独注入 <l2_scene_index>，必须剥掉 persona 尾部这份，避免 L2 索引重复注入。
  const l3Stripped = l3 ? stripSceneNavigation(l3.content) : "";
  return {
    ctx: c,
    l3: l3Stripped.trim() ? { content: l3Stripped } : null,
    l2Entries: sortTdaiL2Entries(l2Entries ?? [])
      .map((e) => ({ path: e.path, summary: e.summary })),
  };
}

/** Return L2 entries in deterministic path order without mutating the input. */
export function sortTdaiL2Entries(
  entries: readonly { path: string; summary?: string }[],
): { path: string; summary?: string }[] {
  return [...entries].sort((left, right) => {
    if (left.path === right.path) return 0;
    return left.path < right.path ? -1 : 1;
  });
}

/**
 * 剥离 persona 尾部的「Scene Navigation (Scene Index)」段。
 * 与 plugin 端 scene-navigation.ts 的 NAV_HEADER 对齐（带或不带前置 `---` 都能命中）。
 */
export function stripSceneNavigation(personaContent: string): string {
  const idx = personaContent.indexOf("## 🗺️ Scene Navigation");
  if (idx === -1) return personaContent;
  // 连同紧邻的 `---` 分隔符与前后空白一起去掉
  let cut = personaContent.slice(0, idx);
  cut = cut.replace(/\s*-{3,}\s*$/, "");
  return cut.trimEnd();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]` : s;
}
