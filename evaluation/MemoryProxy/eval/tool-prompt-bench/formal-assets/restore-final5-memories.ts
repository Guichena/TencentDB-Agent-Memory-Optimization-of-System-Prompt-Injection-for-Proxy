import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function restoreFinal5Memories(runRoot: string, baseUrl: string) {
  const bundle = JSON.parse(readFileSync(resolve(runRoot, "inputs/restore-bundle.json"), "utf8"));
  const identity = JSON.parse(readFileSync(resolve(runRoot, "runtime-core/identity.json"), "utf8"));
  const journalPath = resolve(runRoot, "runtime-core/memory-restore.jsonl");
  const journal = existsSync(journalPath)
    ? readFileSync(journalPath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
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
  const record = (key: string, value: unknown) => {
    const row = { key, bundleSha256: bundle.bundleSha256, value };
    appendFileSync(journalPath, JSON.stringify(row) + "\n");
    journal.push(row);
    return value;
  };
  const create = async (key: string, path: string, body: unknown) => {
    const previous = journal.find((row: any) => row.key === key);
    if (previous && previous.bundleSha256 !== bundle.bundleSha256) throw new Error("Restore bundle changed");
    return previous?.value ?? record(key, await post(path, body));
  };
  const teams = [];
  for (const logical of bundle.identities) {
    const team = await create(`team:${logical.teamId}`, "/v3/meta/team/create", {
      name: logical.teamId, owner_user_id: owner,
    });
    const teamRead = await post("/v3/meta/team/get", { team_id: team.team_id });
    if (teamRead.name !== logical.teamId) throw new Error("Team readback mismatch");
    const agents: Record<string, string> = {};
    for (const name of logical.agentIds) {
      const agent = await create(`agent:${name}`, "/v3/meta/agent/create", {
        team_id: team.team_id, owner_user_id: owner, name, visibility: "team",
      });
      const actual = await post("/v3/meta/agent/get", { agent_id: agent.agent_id });
      if (actual.name !== name || actual.team_id !== team.team_id) throw new Error("Agent readback mismatch");
      agents[name] = agent.agent_id;
    }
    const runtime = { datasetTeamId: logical.teamId, spaceId: identity.serviceId,
      teamId: team.team_id, agentId: agents[logical.currentAgentId], userId: owner, agents };
    teams.push(runtime);
    for (const memory of bundle.memories.filter((item: any) => item.teamId === logical.teamId)) {
      const formalAssetId = `${team.team_id}:${memory.logicalAssetId}`;
      const body = memory.layer === "l0"
        ? { kind: "l0", formal_asset_id: formalAssetId, expected_asset_content_hash: memory.contentSha256,
          team_id: runtime.teamId, agent_id: runtime.agentId, user_id: owner,
          payload: { sessionId: memory.sessionId, messages: memory.messages.map((message: any, index: number) => ({ id: `${memory.logicalAssetId}:${index + 1}`, role: message.role, content: message.content })) } }
        : { kind: "l1", formal_asset_id: formalAssetId, expected_asset_content_hash: memory.contentSha256,
          team_id: runtime.teamId, agent_id: runtime.agentId, user_id: owner,
          payload: { layer: memory.layer, memory_type: memory.memoryType, content: memory.content, ...(memory.path ? { path: memory.path } : {}) } };
      const result = await post("/v3/formal-bench/import-memory", body);
      if (!result.verified || result.content_sha256 !== memory.contentSha256) throw new Error("Memory verification failed");
      record(`memory:${logical.teamId}:${memory.logicalAssetId}`, result);
    }
  }
  record("memory-restore-complete", { teams, memoryCount: bundle.memories.length });
  return { teams: teams.length, memories: bundle.memories.length, skillsVerified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: restore-final5-memories.ts <run-root> <core-url>");
  console.log(JSON.stringify(await restoreFinal5Memories(resolve(process.argv[2]), process.argv[3])));
}
