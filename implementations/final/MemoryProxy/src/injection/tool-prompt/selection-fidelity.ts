const V4_COMPACT_DECISIONS: Record<string, string> = {
  skill_extract: "A completed conversation workflow is reusable and the current lifecycle capability allows forced archival.",
  skill_create: "A new reusable skill must be persisted and write capability is enabled.",
  skill_update: "The complete SKILL.md body of an owned skill must be replaced.",
  skill_patch: "A narrow substring edit to an owned skill is safer than replacing the entire body.",
  skill_delete: "An owned skill must be archived (soft-delete; versions are not physically removed).",
  skill_files_write: "One or more resource files of an owned skill must be created or replaced.",
  skill_files_remove: "One or more resource files of an owned skill must be removed.",
  tdai_memory_search: "Missing durable preference, identity, convention, fact, instruction, or past conclusion.",
  tdai_atomic_query: "Need type/time/page filters, not semantic search.",
  tdai_conversation_search: "Missing exact past wording or timeline evidence.",
  tdai_conversation_query: "Read a known session chronologically.",
  tdai_scenario_ls: "Scene index is missing/stale, or paths need filtering.",
  tdai_read_scene: "Need the full body of a known scene path.",
  skill_search: "Discover a requested skill or required team workflow; no exact usable name/ID is available.",
  skill_view: "Open a known current-agent skill by name.",
  skill_view_by_id: "Open a team result or exact skill_id.",
  skill_files_read: "Read a viewed skill resource into context.",
  skill_files_download: "Download a viewed skill resource as raw bytes.",
  knowledge_tools_list: "Unknown/matching schema: list once per resource per session; cache authoritative name/description/params for that resource.",
  knowledge_tools_call: "Run narrowest listed name+params on the same resource.",
};

const V4_COMPACT_CONTRASTS: Record<string, string> = {
  "tdai_memory_search:tdai_conversation_search": "Exact wording/timeline -> conversation_search.",
  "tdai_memory_search:tdai_atomic_query": "Type/time/page filters -> atomic_query.",
  "tdai_scenario_ls:tdai_read_scene": "Known path body -> read_scene.",
  "skill_search:skill_view": "Listed current-agent name -> skill_view.",
  "skill_search:skill_view_by_id": "Team result/exact ID -> skill_view_by_id.",
  "skill_files_read:skill_files_download": "Bytes -> download; context -> read.",
  "knowledge_tools_list:knowledge_tools_call": "List discovers; call executes.",
};

/** Effective decisions used directly by the sole renderer. */
export function getV4Decision(toolId: string): {
  when: string; avoid?: string; contrasts: { otherTool: string; cue: string }[];
} {
  const when = V4_COMPACT_DECISIONS[toolId];
  if (!when) throw new Error(`missing effective V4 decision: ${toolId}`);
  const avoid = toolId === "tdai_read_scene" ? "Never invent path."
    : toolId === "skill_files_read" || toolId === "skill_files_download" ? "Never guess skill_id/path."
    : toolId === "knowledge_tools_call" ? "Never invent name/params." : undefined;
  return { when, avoid, contrasts: Object.entries(V4_COMPACT_CONTRASTS)
    .filter(([key]) => key.startsWith(`${toolId}:`))
    .map(([key, cue]) => ({ otherTool: key.split(":")[1]!, cue })) };
}
