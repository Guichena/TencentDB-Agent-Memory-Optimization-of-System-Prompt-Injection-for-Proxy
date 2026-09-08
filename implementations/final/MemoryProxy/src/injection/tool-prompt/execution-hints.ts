/** Parameter values not recoverable from field names alone. Source: Core schemas and bridge responses. */
const INPUT_HINTS: Readonly<Record<string, string>> = {
  tdai_read_scene: "path from L2 index/list; for imported_from, agent_id from that same index segment.",
  skill_search: "query: nonempty BM25 keywords; open a returned skill_id with skill_view_by_id, or use its returned name with skill_view when available.",
  skill_view: "returns data.skill_id, data.version, data.manifest[].path; content/manifest default true.",
  skill_view_by_id: "returns data.skill_id, data.version, data.manifest[].path; content/manifest default true.",
  skill_files_read: "only when the task or Skill body requires a text file; use the viewed skill's exact manifest path and version; encoding=utf-8|base64.",
  skill_files_download: "only when the task or Skill body requires a binary, large, or locally reusable file; use the viewed skill's exact manifest path and version; encoding=utf-8|base64; save with -o; chmod +x scripts before execution.",
  skill_create: "content=full SKILL.md with frontmatter; resources=[{path,content,encoding:utf-8|base64,mime_type?,is_executable?}].",
  skill_update: "content=full SKILL.md; expected_version from the viewed skill.",
  skill_patch: "expected_version from the viewed skill; replace_all=true only for intended all-match edits.",
  skill_delete: "expected_version from the viewed skill; archives the skill without bumping version.",
  skill_files_write: "expected_version from the viewed skill; files=[{path,content,encoding:utf-8|base64,mime_type?,is_executable?}].",
  skill_files_remove: "expected_version from the viewed skill; paths is an array of manifest path strings.",
  knowledge_tools_call: "params values must satisfy the selected tools/list params schema; never send the schema itself.",
};

export function getV4ExecutionHint(toolId: string): string | undefined {
  return INPUT_HINTS[toolId];
}

export const V4_KNOWLEDGE_ROUTING = [
  "- code-graph: match must agree with workspace git remote/repository; otherwise use local search. Index is a branch snapshot; exact/current edits require local source.",
  "- wiki: choose by about relevance; no repository match is required.",
].join("\n");

export const V4_RECOVERY_NAMES: Readonly<Record<string, string>> = {
  "invalid-operation-or-schema": "bad-schema",
  "invalid-skill-id": "bad-id",
  "invalid-skill-id-or-path": "bad-id/path",
  "empty-semantic-result-with-open-gap": "empty-with-gap",
};
