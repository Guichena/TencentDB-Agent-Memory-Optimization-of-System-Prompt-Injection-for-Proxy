import { readFileSync } from "node:fs";

export interface Final5RuntimeIdentity { spaceId: string; teamId: string; agentId: string; taskId?: string }
export function loadFinal5RuntimeBindings(path: string, datasetDigest: string, teamIds: readonly string[], verifyRestore = true): Map<string, Final5RuntimeIdentity> {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value.teams) || (verifyRestore && (value.datasetDigest !== datasetDigest || value.verified !== true))) throw new Error("Runtime bindings must refer to a verified restore of this dataset");
  const rows = new Map<string, Final5RuntimeIdentity>();
  const identities = new Set<string>();
  for (const row of value.teams) {
    if (!teamIds.includes(row.datasetTeamId) || rows.has(row.datasetTeamId)) throw new Error("Unknown or duplicate runtime team binding");
    for (const key of ["spaceId", "teamId", "agentId"]) if (typeof row[key] !== "string" || !row[key].trim()) throw new Error("Invalid runtime identity: " + key);
    const identity = [row.spaceId, row.teamId, row.agentId].join("\0");
    if (identities.has(identity)) throw new Error("Different dataset teams cannot share one runtime identity");
    identities.add(identity);
    rows.set(row.datasetTeamId, { spaceId: row.spaceId, teamId: row.teamId, agentId: row.agentId, ...(row.taskId ? { taskId: row.taskId } : {}) });
  }
  if (rows.size !== teamIds.length) throw new Error("Runtime identity coverage incomplete");
  return rows;
}
