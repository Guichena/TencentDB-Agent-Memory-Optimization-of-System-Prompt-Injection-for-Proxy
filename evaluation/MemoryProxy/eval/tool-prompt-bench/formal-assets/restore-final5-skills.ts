import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export async function restoreFinal5Skills(root: string, baseUrl: string) {
  const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const bundle = read("inputs/restore-bundle.json");
  const identity = read("runtime-core/identity.json");
  const journalPath = resolve(root, "runtime-core/skill-restore.jsonl");
  const rows = (path: string) => existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x)) : [];
  const journal = rows(journalPath);
  const memory = rows(resolve(root, "runtime-core/memory-restore.jsonl"));
  if (journal.some(x => x.bundleSha256 !== bundle.bundleSha256)) throw new Error("Restore bundle changed");
  const owner = identity.receipt.data.user_id;
  const authToken = process.env.FINAL5_RESTORE_AUTH_TOKEN ?? "final5-local-restore";
  const post = async (path: string, body: unknown) => {
    const response = await fetch(new URL(path, baseUrl), { method: "POST", headers: {
      "content-type": "application/json", "x-tdai-service-id": identity.serviceId,
      "x-tdai-user-key": identity.userKey, authorization: `Bearer ${authToken}`,
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const result = await response.json() as any;
    if (!response.ok || result.code !== 0) throw new Error(`${path}: ${JSON.stringify(result)}`);
    return result.data;
  };
  const record = (key: string, value: any) => {
    const row = { key, bundleSha256: bundle.bundleSha256, value };
    appendFileSync(journalPath, JSON.stringify(row) + "\n"); journal.push(row); return value;
  };
  const create = async (key: string, path: string, body: unknown) =>
    journal.find(x => x.key === key)?.value ?? record(key, await post(path, body));
  const bindings = [];
  let fileCount = 0;
  for (const skill of bundle.skills) {
    const teamKey = `team:${skill.teamId}`;
    const team = memory.find(x => x.key === teamKey)?.value ?? await create(teamKey,
      "/v3/meta/team/create", { name: skill.teamId, owner_user_id: owner });
    const primary = bundle.identities.find((x: any) => x.teamId === skill.teamId)?.currentAgentId;
    const agent = memory.find(x => x.key === `agent:${primary}`)?.value ?? await create(`agent:${skill.teamId}`,
      "/v3/meta/agent/create", { name: `${skill.teamId} asset owner`, team_id: team.team_id,
        owner_user_id: owner, visibility: "team" });
    const scope = { team_id: team.team_id, agent_id: agent.agent_id, user_id: owner };
    const content = `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n${skill.content}`;
    const created = await create(`skill:${skill.listingRuntimeSkillId}`, "/v3/skill/create", {
      ...scope, name: skill.name, content, resources: skill.resources,
      metadata: { final5OriginTeamId: skill.teamId, final5LogicalAssetId: skill.logicalAssetId },
    });
    const actual = await post("/v3/skill/get", { ...scope, skill_id: created.skill_id,
      include_content: true, include_manifest: true });
    if (actual.content !== content || actual.name !== skill.name || actual.description !== skill.description) {
      throw new Error(`Skill readback mismatch: ${skill.listingRuntimeSkillId}`);
    }
    for (const resource of skill.resources) {
      if (!actual.manifest?.some((entry: any) => entry.path === resource.path)) throw new Error("Resource missing from manifest");
      const file = await post("/v3/skill/files/read", { ...scope, skill_id: created.skill_id,
        version: actual.version, path: resource.path });
      if (file.content !== resource.content || file.encoding !== "utf-8") throw new Error(`Resource mismatch: ${resource.path}`);
      fileCount++;
    }
    const binding = { listingRuntimeSkillId: skill.listingRuntimeSkillId, skillId: created.skill_id,
      name: skill.name, teamId: team.team_id, agentId: agent.agent_id, version: actual.version,
      contentSha256: createHash("sha256").update(content).digest("hex"), resourceCount: skill.resources.length };
    bindings.push(binding); record(`verified:${skill.listingRuntimeSkillId}`, binding);
  }
  record("skill-restore-complete", { bindings, skillCount: bindings.length, fileCount });
  return { skills: bindings.length, resources: fileCount, visibilityVerified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: restore-final5-skills.ts <run-root> <core-url>");
  console.log(JSON.stringify(await restoreFinal5Skills(resolve(process.argv[2]), process.argv[3])));
}
