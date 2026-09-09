import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const SKILL_POOL_HOOK = Symbol.for("task1.final5.skill-pool.v1");
export interface SkillPoolBinding { skillId: string; name: string; teamId: string; agentId: string }

/** Shared experiment input adapter: preserve arguments, resolve frozen asset ownership. */
export function createFinal5SkillPool(bindings: SkillPoolBinding[], coreUrl: string, serviceId: string, userKey: string) {
  const byId = new Map(bindings.map(x => [x.skillId, x]));
  const byName = new Map(bindings.map(x => [x.name, x]));
  if (!bindings.length || byId.size !== bindings.length || byName.size !== bindings.length) throw new Error("Ambiguous Skill pool");
  return async (sub: string, input: Record<string, unknown>, ids: Record<string, unknown>): Promise<Response | undefined> => {
    if (!["search", "get", "get-by-name", "files/read"].includes(sub)) return undefined;
    if (ids.space_id !== serviceId) throw new Error("Skill pool tenant mismatch");
    const selected = sub === "get-by-name" ? byName.get(input.skill_name as string) : byId.get(input.skill_id as string);
    const body = sub === "search"
      ? { query: input.query, top_k: 5 }
      : { ...input, team_id: selected?.teamId ?? ids.team_id,
        agent_id: selected?.agentId ?? ids.agent_id, user_id: ids.user_id };
    const response = await fetch(new URL(`/v3/skill/${sub}`, coreUrl), {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TDAI_CORE_GATEWAY_API_KEY ?? "sdk-e2e-token"}`,
        "x-tdai-service-id": serviceId, "x-tdai-user-key": userKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    const result = await response.clone().json() as any;
    if (result.code === 0) {
      if (sub === "files/read") {
        // File responses have no skill_id; validate against the requested owner.
        if (!selected || result.data.path !== input.path) throw new Error("Core returned file outside requested frozen asset");
      } else {
        const returned = sub === "search" ? result.data.items : [result.data];
        if (returned.some((row: any) => !byId.has(row.skill_id))) throw new Error("Core returned asset outside frozen Skill pool");
      }
    }
    return response;
  };
}

export function installFinal5SkillPool(runRoot: string, coreUrl: string) {
  const rows = readFileSync(resolve(runRoot, "runtime-core/skill-restore.jsonl"), "utf8")
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const complete = rows.findLast(row => row.key === "skill-restore-complete");
  const identity = JSON.parse(readFileSync(resolve(runRoot, "runtime-core/identity.json"), "utf8"));
  const bundle = JSON.parse(readFileSync(resolve(runRoot, "inputs/restore-bundle.json"), "utf8"));
  if (!complete || complete.bundleSha256 !== bundle.bundleSha256
    || complete.value.skillCount !== bundle.skills.length) throw new Error("Verified Skill restore missing");
  (globalThis as any)[SKILL_POOL_HOOK] = createFinal5SkillPool(complete.value.bindings, coreUrl, identity.serviceId, identity.userKey);
}
