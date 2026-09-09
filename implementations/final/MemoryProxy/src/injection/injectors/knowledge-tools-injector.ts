/**
 * Knowledge Tools Injector — injects a `<knowledge_tools>` block listing
 * team knowledge resources (wiki / code-graph) with a two-step self-discovery
 * flow (tools/list → tools/call).
 *
 * v7 progressive exposure: prompt only contains resource list + discovery
 * entry points. Agent calls tools/list to discover available tools, then
 * tools/call to execute. Tool definitions live in the knowledge service,
 * not in the proxy.
 *
 * Strategy:
 *   - cacheStrategy: "session_init" — knowledge list fetched once at prewarm,
 *     reused for all turns in the session.
 *   - **Per-agent** (设计 §0.6): 读 meta agent-fixed-asset 绑定（过滤
 *     llm_wiki/code_graph）→ asset_ids(=knowledge_id) → 按 id 联查 entity_knowledge
 *     取渲染字段。绑定权威在 meta；明细缺失（未 ready）则不注入。
 *   - Fallback: 无 caller user-key / 无 agent → 退回 team 全量 list（过渡兼容）。
 *   - Failure / empty → 0 blocks (graceful degradation).
 *
 * See `docs/design/knowledge-injection-v7.md`。
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
import {
  CoreKnowledgeClient,
  getCoreKnowledgeClient,
  type KnowledgeItem,
} from "../../knowledge/core-client.js";
import type { CoreSkillConfig } from "../../types.js";
import { compileToolPrompt } from "../tool-prompt/compiler.js";
import {
  isFidelityCapabilityEnabled,
  resolveSessionCapabilitySignature,
} from "../tool-prompt/capability-pruned.js";
import { toolPromptCacheIdentity } from "../tool-prompt/profiles.js";
import type { ToolPromptProfile } from "../tool-prompt/types.js";

const TAG = "[knowledge-tools-injector]";

export interface KnowledgeToolsInjectorConfig {
  /** Core kernel config (same endpoint as skill — 8420). */
  coreSkill: CoreSkillConfig;
  toolPromptProfile?: ToolPromptProfile;
  capabilitySignature?: string;
}

export interface KnowledgeTelemetryContext {
  sessionKey?: string;
  userId?: string;
  teamId?: string;
  agentId?: string;
  agentSource?: string;
  spaceId?: string;
}

function toCompositeSessionKey(sessionKey?: string, agentSource?: string): string | undefined {
  if (!sessionKey) return undefined;
  if (!agentSource) return sessionKey;
  const prefix = `${agentSource}:`;
  return sessionKey.startsWith(prefix) ? sessionKey : `${prefix}${sessionKey}`;
}

/**
 * Render the `<knowledge_tools>` block from a list of knowledge resources.
 * Pure function for ease of testing.
 *
 * `service_url` is the tools self-discovery base (already includes the API
 * prefix, e.g. `http://host:8421/v3`). The tools endpoints are service-level
 * (`{service_url}/tools/list` | `/tools/call`); the target resource is selected
 * via the `knowledge_id` field in the body, NOT via the URL path.
 *
 * `serviceId` is the tenant identity (= `x-tdai-service-id`, unified with the
 * kernel routing key). The knowledge service REQUIRES it as a header on every
 * tools call, so we bake it into the curl examples the agent runs. Optional
 * telemetry context headers let the service attribute calls without embedding
 * secrets; header values are validated by the direct prompt compiler.
 */
function filterResourcesByCapabilities(
  resources: KnowledgeItem[],
  caps: AssetCapabilityFlags | undefined,
): KnowledgeItem[] {
  if (!caps) return resources;
  return resources.filter((r) => {
    if (r.type === "wiki") return caps.llm_wiki !== false;
    if (r.type === "code-graph") return caps.code_graph !== false;
    return true;
  });
}

/**
 * Escape a value for use inside a double-quoted XML attribute. Resource names
 * and repo slugs are operator-supplied, so a stray `"` would otherwise break
 * the `<knowledge .../>` tag structure the agent parses.
 */
function xmlAttrEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validateKnowledgeId(value: string): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("knowledge resource id contains control characters or is empty");
  }
  return value;
}

function validateServiceUrl(value: string): string {
  if (!value || /\s|[\u0000-\u001f\u007f"'`<>\\;|&$()]/.test(value)) {
    throw new Error("knowledge service URL contains unsafe shell or markup characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("knowledge service URL is invalid");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("knowledge service URL must be an http(s) URL without credentials");
  }
  return value;
}

/** Render `\n  name="escaped"`, or "" when the value is absent/blank. */
function attr(name: string, value: string | undefined | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `\n  ${name}="${xmlAttrEscape(trimmed)}"`;
}

/**
 * Derive a repo slug (`<org>/.../<repo>`) from a clone URL, used as the anchor
 * hint the agent matches against the local workspace's git remote.
 *
 * Handles both `https://host/a/b/c.git` and `git@host:a/b/c.git`. Returns
 * undefined when the URL is absent or yields no usable path (e.g. wiki
 * resources, which have no repo).
 */
function deriveRepoSlug(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) return undefined;
  const withoutScheme = repoUrl.replace(/^[a-z0-9+.-]+:\/\//i, "");
  // scp-like syntax (`git@host:org/repo.git`) — split on the first colon.
  const afterHost = withoutScheme.includes(":")
    ? withoutScheme.slice(withoutScheme.indexOf(":") + 1)
    : withoutScheme.slice(withoutScheme.indexOf("/") + 1);
  const slug = afterHost.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  return slug.length > 0 ? slug : undefined;
}

export function renderKnowledgeToolsBlock(
  resources: KnowledgeItem[],
  serviceId: string,
  telemetryContext: KnowledgeTelemetryContext = {},
): { assets: string; headers: readonly (readonly [string, string])[] } | null {
  if (!resources || resources.length === 0) return null;

  const validResources = resources.flatMap((resource, index) => {
    try {
      return [{
        ...resource,
        knowledge_id: validateKnowledgeId(resource.knowledge_id),
        service_url: validateServiceUrl(resource.service_url),
      }];
    } catch (err) {
      console.warn(`${TAG} skipping invalid knowledge resource at index ${index}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });
  if (validResources.length === 0) return null;
  const orderedResources = sortKnowledgeResources(validResources);

  const telemetryHeaders: Array<[string, string | undefined]> = [
    ["x-conversation-id", telemetryContext.sessionKey],
    ["x-tdai-user-id", telemetryContext.userId],
    ["x-tdai-team-id", telemetryContext.teamId],
    ["x-tdai-agent-id", telemetryContext.agentId],
    ["x-tdai-agent-source", telemetryContext.agentSource],
    ["x-tdai-space-id", telemetryContext.spaceId],
  ];
  const headers: Array<readonly [string, string]> = [
    ["x-tdai-service-id", serviceId],
    ...telemetryHeaders.filter((entry): entry is [string, string] => Boolean(entry[1])),
  ];

  const resourceTags = orderedResources
    .map((r) => {
      // `match` 是 code-graph 的锚点判定依据：agent 拿它比对当前工作区的 git
      // remote，命中才调用。优先用后端下发的 repo_slug；缺失时从 repo_url 降级
      // 提取 `<org>/.../<repo>`。wiki 无 repo，不渲染该属性。
      const matchAttr = attr("match", r.repo_slug ?? deriveRepoSlug(r.repo_url));
      const branchAttr = attr("branch", r.repo_url ? (r.branch ?? "main") : undefined);
      // wiki 的 summary 是 LLM 依据页面标题生成的内容概述，是 agent 判断"该不该
      // 查这个 wiki"的唯一线索，必须保留。code-graph 的 summary 只是
      // "N 个文件、M 个符号节点"一类计数，对调用决策无帮助，不注入。
      const summaryAttr = r.type === "wiki" ? attr("about", r.summary) : "";
      const knowledgeId = r.knowledge_id;
      const serviceUrl = r.service_url;
      return `<knowledge type="${r.type}" id="${xmlAttrEscape(knowledgeId)}"\n  url="${xmlAttrEscape(serviceUrl)}"\n  name="${xmlAttrEscape(r.name)}"${matchAttr}${branchAttr}${summaryAttr} />`;
    })
    .join("\n\n");

  return { assets: resourceTags, headers };
}

/** Stable type/id ordering for dynamic knowledge assets. */
export function sortKnowledgeResources(resources: readonly KnowledgeItem[]): KnowledgeItem[] {
  return [...resources].sort((left, right) => {
    const typeOrder = compareStable(left.type, right.type);
    if (typeOrder !== 0) return typeOrder;
    const idOrder = compareStable(left.knowledge_id, right.knowledge_id);
    if (idOrder !== 0) return idOrder;
    return compareStable(left.name, right.name);
  });
}

function compareStable(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Knowledge tools injector.
 *
 * Anchor: lands in the `knowledge` semantic slot, co-located just AFTER the
 * memory region on each profile — CodeBuddy's <memories> tag / Claude Code's
 * # Memory section. Knowledge tools (wiki + code-graph) are a "cloud reference"
 * pairing naturally with memory, not with executable skills, so we deliberately
 * avoid sharing the `skills` slot.
 * Priority: HOOK_PRIORITY.WIKI (300).
 */
export class KnowledgeToolsInjector implements InjectionHook {
  id = "knowledge-tools-injector";
  point = "system.before_tools" as const;
  anchor: AnchorTarget = { slot: "knowledge", relation: "after" };
  priority: HookPriority = HOOK_PRIORITY.WIKI;
  description = "Inject the <knowledge_tools> block with team knowledge resources.";
  cacheStrategy: CacheStrategy = "session_init";
  cacheIdentity?: string;

  constructor(
    private config: KnowledgeToolsInjectorConfig,
    /** Optional override (tests). */
    private clientOverride?: CoreKnowledgeClient,
  ) {
    this.cacheIdentity = toolPromptCacheIdentity(
      this.id,
      config.toolPromptProfile ?? "v4-compact",
      config.capabilitySignature ?? "unconfigured",
    );
  }

  async execute(ctx: AgentContext): Promise<ContextBlock[]> {
    const ids = this.resolveSession(ctx);
    if (!ids.teamId) return [];
    return this.fetchBlocks(
      ids.teamId,
      ids.agentId,
      ids.userKey,
      ids.spaceId,
      ids.assetCapabilities,
      "execute",
      {
        sessionKey: toCompositeSessionKey(ctx.metadata.sessionKey, ctx.metadata.agentSource),
        userId: ids.userId ?? undefined,
        teamId: ids.teamId,
        agentId: ids.agentId ?? undefined,
        agentSource: ctx.metadata.agentSource,
        spaceId: ids.spaceId ?? undefined,
      },
    );
  }

  async prewarm(input: PrewarmInput): Promise<ContextBlock[]> {
    const teamId = input.sessionInfo.team_id;
    if (!teamId) return [];
    return this.fetchBlocks(
      teamId,
      input.sessionInfo.agent_id ?? null,
      input.callerUserKey ?? null,
      input.sessionInfo.space_id ?? null,
      input.assetCapabilities,
      "prewarm",
      {
        sessionKey: toCompositeSessionKey(input.keyId, input.agentSource),
        userId: input.sessionInfo.user_id || input.userId,
        teamId,
        agentId: input.sessionInfo.agent_id,
        agentSource: input.agentSource,
        spaceId: input.sessionInfo.space_id,
      },
    );
  }

  private resolveSession(ctx: AgentContext): {
    teamId: string | null;
    agentId: string | null;
    userId: string | null;
    userKey: string | null;
    spaceId: string | null;
    assetCapabilities?: AssetCapabilityFlags;
  } {
    const custom = ctx.metadata.custom as Record<string, unknown> | undefined;
    const session = custom?.session as Record<string, unknown> | undefined;
    const teamId = typeof session?.team_id === "string" && session.team_id.length > 0 ? session.team_id : null;
    const agentId = typeof session?.agent_id === "string" && session.agent_id.length > 0 ? session.agent_id : null;
    const userId = typeof session?.user_id === "string" && session.user_id.length > 0 ? session.user_id : null;
    const userKey = typeof custom?.userKey === "string" && custom.userKey.length > 0 ? custom.userKey : null;
    const spaceId = typeof session?.space_id === "string" && session.space_id.length > 0 ? session.space_id : null;
    const assetCapabilities = custom?.assetCapabilities as AssetCapabilityFlags | undefined;
    return { teamId, agentId, userId, userKey, spaceId, assetCapabilities };
  }

  private async fetchBlocks(
    teamId: string,
    agentId: string | null,
    userKey: string | null,
    spaceId: string | null,
    assetCapabilities: AssetCapabilityFlags | undefined,
    phase: "prewarm" | "execute",
    telemetryContext: KnowledgeTelemetryContext,
  ): Promise<ContextBlock[]> {
    try {
      const client = this.clientOverride ?? getCoreKnowledgeClient(this.config.coreSkill);

      console.log(`${TAG} ${phase} team=${teamId} agent=${agentId ?? "(none)"} userKey=${userKey ? "(set)" : "(none)"} space=${spaceId ?? "(none)"}`);

      // Per-agent（首选）：meta 绑定 → asset_ids → 按 id 联查明细。
      // serviceId 透传 spaceId（与 SkillInjector 一致：`/{agent}/{spaceId}/...`）。
      let resources: KnowledgeItem[];
      let scope: string;
      if (agentId && userKey) {
        const ids = await client.listAgentKnowledgeIds(agentId, userKey, { serviceId: spaceId ?? undefined });
        console.log(`${TAG} ${phase} per-agent path: listAgentKnowledgeIds → ${ids.length} ids [${ids.join(",")}]`);
        resources = ids.length > 0 ? await client.listKnowledgeByIds(teamId, ids, { serviceId: spaceId ?? undefined }) : [];
        console.log(`${TAG} ${phase} per-agent path: listKnowledgeByIds → ${resources.length} resources`);
        scope = `agent:${agentId}`;
      } else {
        // Fallback：无 caller 身份 → team 全量。
        // 传 space_id 作 kernel 租户路由 header（与 SkillInjector 一致）。
        resources = await client.listKnowledge(teamId, { serviceId: spaceId ?? undefined });
        console.log(`${TAG} ${phase} fallback path: listKnowledge → ${resources.length} resources`);
        scope = `team:${teamId}`;
      }

      resources = filterResourcesByCapabilities(resources, assetCapabilities);
      const profile = this.config.toolPromptProfile ?? "v4-compact";
      // 注入 prompt 里给 LLM 用的 service-id 也要是 spaceId（LLM 拿它调 KS 的 tools/list|call）。
      const injectionServiceId = spaceId || this.config.coreSkill.serviceId;
      const rendered = renderKnowledgeToolsBlock(
        resources,
        injectionServiceId,
        telemetryContext,
      );
      if (!rendered) return [];
      const baseSignature = this.config.capabilitySignature ?? "unconfigured";
      if (!isFidelityCapabilityEnabled("knowledge", assetCapabilities)) {
        return [];
      }
      const capabilitySignature = resolveSessionCapabilitySignature(baseSignature, assetCapabilities);
      const content = compileToolPrompt({
        family: "knowledge", surface: "knowledge-tools", capabilitySignature,
        assets: rendered.assets, headers: rendered.headers,
      }).content;
      return [{
        type: "text",
        content,
        metadata: {
          source: this.id,
          cacheKey: `knowledge-tools-injector:${scope}`
            + `:${capabilitySignature}`,
          toolPromptProfile: profile,
          toolPromptFamily: "knowledge",
          toolPromptSurface: "knowledge-tools",
          capabilitySignature,
        },
      }];
    } catch (err) {
      console.warn(`${TAG} ${phase} failed: ${(err as Error).message}`);
      return [];
    }
  }
}
