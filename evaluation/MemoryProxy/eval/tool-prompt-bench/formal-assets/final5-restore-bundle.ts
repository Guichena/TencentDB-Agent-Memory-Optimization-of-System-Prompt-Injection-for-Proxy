import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const jsonl = (path: string) => readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));

/** Asset-only import input. Cases, Gold and expected paths never enter the bundle. */
export function buildFinal5RestoreBundle(teamsRoot: string, catalogRoot: string, originalTeamsRoot: string) {
  const teams = readdirSync(teamsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const assetsByTeam = new Map<string, any>();
  const loadAssets = (team: string) => {
    if (!assetsByTeam.has(team)) assetsByTeam.set(team, JSON.parse(readFileSync(resolve(teams.includes(team) ? teamsRoot : originalTeamsRoot, team, "data/assets.json"), "utf8")));
    return assetsByTeam.get(team);
  };
  const memories = teams.flatMap(teamId => (loadAssets(teamId).memory ?? []).map((asset: any) => {
    if (!asset.id || !asset.layer) throw new Error("Invalid Memory: " + teamId);
    if (asset.layer === "l0") {
      if (typeof asset.session_id !== "string" || !Array.isArray(asset.messages) || asset.messages.length === 0) throw new Error("Invalid L0 Memory: " + teamId);
      const messages = asset.messages.map((message: any) => ({ role: message.role, content: message.content }));
      return { teamId, logicalAssetId: asset.id, layer: "l0", sessionId: asset.session_id, messages, contentSha256: hash({ sessionId: asset.session_id, messages }) };
    }
    if (typeof asset.content !== "string") throw new Error("Invalid Memory: " + teamId);
    return { teamId, logicalAssetId: asset.id, layer: asset.layer, memoryType: asset.memory_type, content: asset.content, ...(asset.path ? { path: asset.path } : {}), contentSha256: hash(asset.content) };
  }));
  // Keep the declared searchable pool, including neighbor distractors, not just Gold targets.
  const skills = jsonl(resolve(catalogRoot, "searchable-skills.jsonl")).map(row => {
    const asset = loadAssets(row.originTeamId).skills.find((item: any) => item.id === row.logicalAssetId);
    if (!asset || typeof asset.content !== "string") throw new Error("Missing source Skill: " + row.runtimeSkillId);
    if (teams.includes(row.originTeamId) && asset.description !== row.description) throw new Error("Stale Skill description: " + row.runtimeSkillId);
    const resources = (asset.files ?? []).map((file: any) => {
      if (typeof file.path !== "string" || !file.path || file.path.startsWith("/") || file.path.includes("\\") || file.path.includes(":") || file.path.split("/").some((part: string) => !part || part === "..") || typeof file.content !== "string") throw new Error("Invalid Skill resource: " + row.runtimeSkillId);
      return { path: file.path, content: file.content, encoding: "utf-8" as const };
    });
    if (new Set(resources.map((file: any) => file.path)).size !== resources.length) throw new Error("Duplicate resource path");
    return { teamId: row.originTeamId, logicalAssetId: row.logicalAssetId, listingRuntimeSkillId: row.runtimeSkillId,
      name: row.runtimeName, description: row.description, content: asset.content, resources, sourceSha256: hash(asset) };
  });
  if (new Set(skills.map(skill => skill.listingRuntimeSkillId)).size !== skills.length) throw new Error("Duplicate searchable Skill identity");
  const identities = teams.map(teamId => {
    const team = JSON.parse(readFileSync(resolve(teamsRoot, teamId, "data/team.json"), "utf8"));
    return { teamId, currentAgentId: team.current_agent_id, agentIds: team.agent_ids };
  });
  const catalogs = jsonl(resolve(catalogRoot, "skill-catalogs.jsonl"));
  const skillIds = new Set(skills.map(skill => skill.listingRuntimeSkillId));
  for (const catalog of catalogs) for (const skill of catalog.skills) if (!skillIds.has(skill.runtimeSkillId)) throw new Error("Visible Skill missing from searchable pool: " + skill.runtimeSkillId);
  const base = { schemaVersion: "task1.final5-restore-bundle.v1", identities, memories, skills, catalogs,
    requirements: ["Create independent experiment team/agent identities and persist actual runtime IDs",
      "Import Memory into the runtime store; atomic/update cannot create missing L1 records",
      "Create Skill with content and resources, then read back body and every resource",
      "Map listingRuntimeSkillId to actual returned skill_id; update catalog bindings and hash",
      "Grant the declared neighbor searchable pool without exposing other experiment assets",
      "Use the same verified snapshot and identity map in both variants"] };
  return { ...base, bundleSha256: hash(base) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../formal-dataset/final5");
  if (!process.argv[2]) throw new Error("Usage: final5-restore-bundle.ts <new output.json>");
  const config = process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]), "utf8")) : undefined;
  const bundle = buildFinal5RestoreBundle(config?.teamsRoot ?? resolve(root, "test100/teams"), config ? dirname(config.skillCatalogBindings) : resolve(root, "test100/skill-catalog"), resolve(root, "teams"));
  writeFileSync(resolve(process.argv[2]), JSON.stringify(bundle, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: "prepared-not-imported", teams: bundle.identities.length, memories: bundle.memories.length,
    skills: bundle.skills.length, resources: bundle.skills.reduce((n, skill) => n + skill.resources.length, 0), bundleSha256: bundle.bundleSha256 }));
}
