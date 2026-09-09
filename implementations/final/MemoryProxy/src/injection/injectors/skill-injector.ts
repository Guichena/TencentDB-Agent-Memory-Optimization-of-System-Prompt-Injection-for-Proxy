import type { FrozenSkillCatalogPayload } from "../../common/frozen-skill-catalog.js";
/**
 * Skill Injector — emits the `<available_skills>` block containing skills
 * owned by the current agent (team_id + agent_id filtered via /v3/skill/listing).
 *
 * The sister hook `skill-tools-injector.ts` emits the static `<skill_tools>`
 * block describing the curl recipes. Together:
 *   <skill_tools>        = how to use skills (via /skill-bridge curl)
 *   <available_skills>   = which skills belong to this agent (owner-filtered)
 *
 * The listing endpoint uses routing internally:
 *   - No query → list head (full listing when ≤ searchTopK, search when >)
 *   - Returns a pre-rendered `<available_skills>` text block ready to inject.
 *
 * Strategy:
 *   - cacheStrategy: "session_init" — listing runs once at prewarm time,
 *     the resulting block is reused for all turns in the session.
 *   - Calls core directly via `CoreSkillClient.listListing`.
 *   - Failure / empty listing → 0 blocks (graceful degradation).
 *
 * The LLM can discover team-wide skills via the skill_search tool (separate).
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
  CoreSkillClient,
  getCoreSkillClient,
  type ListingResult,
} from "../../skill/core-client.js";
import type { CoreSkillConfig } from "../../types.js";
import { SKILL_GUIDANCE } from "../tool-prompt/compiler.js";
import {
  isFidelityCapabilityEnabled,
  resolveSessionCapabilitySignature,
} from "../tool-prompt/capability-pruned.js";
import { toolPromptCacheIdentity } from "../tool-prompt/profiles.js";
import type { ToolPromptProfile } from "../tool-prompt/types.js";

const TAG = "[skill-injector]";

export interface SkillInjectorConfig {
  /** Core skill client config; passed to `getCoreSkillClient(config)`. */
  coreSkill: CoreSkillConfig;
  toolPromptProfile?: ToolPromptProfile;
  capabilitySignature?: string;
}

/**
 * Prompt boilerplate wrapping the `<available_skills>` listing.
 *
 * Mirrored from `MemoryCore/src/core/skill/prompts/skill-listing-prompt.ts`
 * (SKILL_ENGINEERING_DESIGN appendix C.1). Kept as a physical copy — the
 * plugin boundary rules forbid cross-plugin deep imports. Wording is adapted
 * to reference the proxy's skill-bridge tool names (`skill_view`,
 * `skill_patch`) instead of the design-doc's hypothetical `skill_view(name)` /
 * `skill_manage(action='patch')` function calls. Read the `<skill_tools>`
 * block above `<available_skills>` for the exact curl recipes.
 *
 * When updating either copy, update the other so the LLM sees consistent
 * guidance regardless of which host renders the block.
 */
const AVAILABLE_SKILLS_BLOCK_RE = /^(\s*)<available_skills>([\s\S]*)<\/available_skills>(\s*)$/;

/**
 * The outer envelope is structure; its plain-text body is data. Escape angle
 * brackets without double-escaping entities emitted by newer Core versions.
 */
function validateAvailableSkillsListing(listing: string): string {
  const match = AVAILABLE_SKILLS_BLOCK_RE.exec(listing);
  if (!match || listing.match(/<available_skills>/g)?.length !== 1
    || listing.match(/<\/available_skills>/g)?.length !== 1) {
    throw new Error("skill listing must contain exactly one complete available_skills block");
  }

  const body = match[2];
  return `${match[1]}<available_skills>${body.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</available_skills>${match[3]}`;
}

/** Keep the listing envelope intact; only its body is untrusted asset data. */
export function wrapAvailableSkillsBlock(
  listing: string,
): string {
  listing = validateAvailableSkillsListing(listing);
  return `${SKILL_GUIDANCE}\n${listing}`;
}

/**
 * Build a search query for listing from agent/task descriptions.
 * Combines agent prompt + task description + task goal to form a
 * semantically meaningful query for FTS BM25 matching.
 *
 * Returns `undefined` when the combined text has too weak signal to
 * usefully drive BM25 search — in that case core falls back to
 * mode=full and returns the head of the skill list. Weak-signal
 * heuristic: after dedup + lowercasing, fewer than 3 distinct tokens
 * of length ≥ 3. Catches placeholder-named agents like
 * `testagent1` whose description/prompt is literally "testagent1"
 * (would otherwise BM25 to zero hits and inject no skills at all).
 */
function buildListingQuery(input: PrewarmInput): string | undefined {
  const parts: string[] = [];
  const ad = input.agentDetail;
  const td = input.taskDetail;

  if (ad?.description?.trim()) parts.push(ad.description.trim());
  if (ad?.prompt?.trim()) parts.push(ad.prompt.trim());
  if (td?.description?.trim()) parts.push(td.description.trim());
  if (td?.goal?.trim()) parts.push(td.goal.trim());

  const combined = parts.join(" ").trim();
  if (!combined) return undefined;

  // Weak-signal check: split on non-word chars, keep tokens length ≥ 3,
  // dedup case-insensitively. Under 3 distinct tokens → treat as no query
  // so core returns the full head (`mode=full`).
  const tokens = new Set(
    combined
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3),
  );
  if (tokens.size < 3) return undefined;

  return combined;
}

/**
 * Skill injector hook.
 * Targets: system.before_tools injection point (→ before <agent_skills>).
 */
export class SkillInjector implements InjectionHook {
  id = "skill-injector";
  point = "system.before_tools" as const;
  /** Lands before the "skills" region (CodeBuddy: `<agent_skills>`). */
  anchor: AnchorTarget = { slot: "skills", relation: "before" };
  priority: HookPriority = HOOK_PRIORITY.SKILL;
  description = "Inject agent-owned cloud skills via /v3/skill/listing before <agent_skills>.";
  /** Listing result is stable for the session. */
  cacheStrategy: CacheStrategy = "session_init";
  cacheIdentity?: string;

  constructor(
    private config: SkillInjectorConfig,
    /** Optional override (tests). */
    private clientOverride?: CoreSkillClient,
  ) {
    this.cacheIdentity = (toolPromptCacheIdentity(
      this.id,
      config.toolPromptProfile ?? "v4-compact",
      config.capabilitySignature ?? "unconfigured",
    ) ?? this.id) + "-listing-text-v1";
  }

  /**
   * Live-path execute (cache-miss self-heal).
   *
   * With `cacheStrategy: "session_init"`, the pipeline normally serves the
   * prewarmed block from `HookCacheRepo`. When that cache misses — e.g. this
   * request landed on a different proxy node than the one that ran prewarm,
   * Redis was unavailable, the entry expired, or prewarm never fired — the
   * pipeline (`InjectionPipeline.resolveHookBlocks`) falls back to `execute()`
   * and *re-populates* the cache with whatever we return. So this method must
   * be able to reproduce the same block the prewarm path would have produced.
   *
   * The only degradation vs. prewarm is the search `query`: on the live path
   * we don't have `agentDetail`/`taskDetail`, so core routes to `mode=full`
   * (head of the listing). That is an accepted trade-off, documented in
   * `BUG-skill-injection-multinode.md` §Solution 1.
   *
   * Historically this returned `[]` unconditionally, which meant a miss on
   * any node other than the one that ran prewarm silently dropped
   * `<available_skills>` from the system prompt for the entire session.
   */
  async execute(ctx: AgentContext): Promise<ContextBlock[]> {
    const custom = ctx.metadata.custom as Record<string, unknown> | undefined;
    const caps = custom?.assetCapabilities as AssetCapabilityFlags | undefined;
    if (caps?.skill === false) return [];
    if (custom?.frozenSkillCatalog) return this.renderFrozenCatalog(custom.frozenSkillCatalog as FrozenSkillCatalogPayload);
    const session = custom?.session as {
      team_id?: string;
      agent_id?: string;
      space_id?: string;
    } | undefined;
    // No search query on the live path — core will route to mode=full.
    return this.renderListingBlocks({
      team_id: session?.team_id,
      agent_id: session?.agent_id,
      space_id: session?.space_id,
      query: undefined,
      trigger: "execute",
      assetCapabilities: caps,
    });
  }

  /**
   * Session-init prewarm: call /v3/skill/listing with team_id + agent_id
   * and a search query built from agent/task descriptions so the returned
   * skills are semantically relevant to the current task (FTS BM25).
   * Inject the pre-rendered `<available_skills>` block verbatim.
   */
  async prewarm(input: PrewarmInput): Promise<ContextBlock[]> {
    if (!isFidelityCapabilityEnabled("skill", input.assetCapabilities)) return [];
    if (input.frozenSkillCatalog) return this.renderFrozenCatalog(input.frozenSkillCatalog);
    const ids = input.sessionInfo;
    // Build search query from agent description + task description
    // so listing semantically matches relevant skills (FTS BM25).
    const query = buildListingQuery(input);
    return this.renderListingBlocks({
      team_id: ids?.team_id,
      agent_id: ids?.agent_id,
      space_id: ids?.space_id,
      query,
      trigger: "prewarm",
      assetCapabilities: input.assetCapabilities,
    });
  }

  /**
   * Shared listing → wrapped `<available_skills>` block renderer used by both
   * `prewarm()` and `execute()`. Keeping a single code path guarantees the
   * two entry points emit *identical* blocks (same content + same
   * `metadata.cacheKey`), so the pipeline's self-heal write never fragments
   * the KV cache against the prewarm entry.
   *
   * Contract:
   *   - Missing team_id or agent_id → return [] (nothing to route on).
   *   - Any core error → log + return [] (never fails the request).
   *   - Listing rendered as "(none)" or empty → return [].
   *   - Never throws.
   */
  private renderFrozenCatalog(catalog: FrozenSkillCatalogPayload): ContextBlock[] {
    const listing = ["<available_skills>", ...catalog.skills.map(skill => `- ${skill.runtimeName}: ${skill.description}`), "</available_skills>"].join("\n");
    return [{ type: "text", content: wrapAvailableSkillsBlock(listing), metadata: {
      source: this.id, skillCount: catalog.skills.length, mode: "frozen",
      catalogId: catalog.catalogId, catalogSha256: catalog.catalogSha256,
      cacheKey: `skill-injector:catalog:${catalog.catalogSha256}`,
    } }];
  }

  private async renderListingBlocks(args: {
    team_id?: string;
    agent_id?: string;
    space_id?: string;
    query: string | undefined;
    trigger: "prewarm" | "execute";
    assetCapabilities?: AssetCapabilityFlags;
  }): Promise<ContextBlock[]> {
    const { team_id, agent_id, space_id, query, trigger, assetCapabilities } = args;
    if (!team_id || !agent_id) {
      console.log(
        `${TAG} ${trigger}: missing session identity (team_id/agent_id) — skipping listing`,
      );
      return [];
    }

    // Route the request to the correct kernel tenant. `space_id` is the
    // instance ID extracted from `/{agent}/{spaceId}/...` at session-init;
    // when absent CoreSkillClient falls back to `config.coreSkill.serviceId`
    // (older single-tenant deployments).
    const serviceId = space_id || undefined;
    console.log(
      `${TAG} ${trigger} team=${team_id} agent=${agent_id}`
        + ` space=${space_id ?? "(none)"} serviceId=${serviceId ?? "(fallback config)"}`
        + ` query=${JSON.stringify(query?.slice(0, 80) ?? null)}`,
    );

    let result: ListingResult;
    try {
      const client = this.clientOverride ?? getCoreSkillClient(this.config.coreSkill);
      result = await client.listListing({
        team_id,
        agent_id,
        query,
      }, { serviceId });
      console.log(
        `${TAG} ${trigger} result mode=${result.mode}`
          + ` hits=${result.hits?.length ?? 0} listingLen=${(result.listing ?? "").length}`,
      );
    } catch (err) {
      console.warn(
        `${TAG} ${trigger} core listing failed, degrading to empty <available_skills>: ${(err as Error).message}`,
      );
      return [];
    }

    const listing = result.listing;
    if (!listing || /^\s*<available_skills>\s*(?:\(none\))?\s*<\/available_skills>\s*$/.test(listing)) return [];

    const profile = this.config.toolPromptProfile ?? "v4-compact";
    const baseSignature = this.config.capabilitySignature ?? "unconfigured";
    if (!isFidelityCapabilityEnabled("skill", assetCapabilities)) {
      return [];
    }
    const capabilitySignature = resolveSessionCapabilitySignature(baseSignature, assetCapabilities);
    const content = wrapAvailableSkillsBlock(
      listing,
    );
    return [{
      type: "text",
      content,
      metadata: {
        source: this.id,
        skillCount: result.hits.length,
        mode: result.mode,
        // Shared cache key across prewarm + execute so pipeline self-heal
        // writes replace, not fragment, the prewarmed entry.
        cacheKey: "skill-injector:catalog"
          + `:${capabilitySignature}`,
        toolPromptProfile: profile,
        toolPromptFamily: "skill",
        toolPromptSurface: "skill-listing",
        capabilitySignature,
      },
    }];
  }
}
