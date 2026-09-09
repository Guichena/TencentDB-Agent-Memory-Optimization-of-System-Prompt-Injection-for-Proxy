import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export interface Final5Record { case_id: string; team_id: string; case: Record<string, unknown>; gold: Record<string, unknown>; evidence: Record<string, unknown>; assets: Record<string, unknown>; }
export interface Final5Dataset { schemaVersion: "task1.final5-datasource.v1"; snapshotId: "final5"; teams: string[]; records: Final5Record[]; counts: { teams: number; cases: number; pairs: number; natural: number; assets: number }; sourceDigest: string; }
const jsonl = (file: string) => readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
export function loadFinal5Dataset(teamsRoot: string): Final5Dataset {
  const root = resolve(teamsRoot); const teams = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); const records: Final5Record[] = []; let assets = 0; let pairs = 0; let natural = 0;
  for (const team_id of teams) { const dir = join(root, team_id, "data"); const cases = jsonl(join(dir, "cases.jsonl")); const gold = jsonl(join(dir, "gold.jsonl")); const evidence = jsonl(join(dir, "evidence.jsonl")); const asset = JSON.parse(readFileSync(join(dir, "assets.json"), "utf8")) as Record<string, unknown>; assets += Object.values(asset).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0); const byGold = new Map(gold.map((row) => [String(row.case_id), row])); const byEvidence = new Map(evidence.map((row) => [String(row.case_id), row])); for (const c of cases) { const id = String(c.case_id); const g = byGold.get(id); const e = byEvidence.get(id); if (!g || !e) throw new Error(`${team_id}: missing Gold/Evidence for ${id}`); records.push({ case_id: id, team_id, case: c, gold: g, evidence: e, assets: asset }); if (g.pair_id) pairs += 0.5; else natural += 1; } }
  return { schemaVersion: "task1.final5-datasource.v1", snapshotId: "final5", teams, records, counts: { teams: teams.length, cases: records.length, pairs, natural, assets }, sourceDigest: createHash("sha256").update(JSON.stringify(records)).digest("hex") };
}
export function selectFinal5Cases(dataset: Final5Dataset, caseIds: readonly string[]): Final5Record[] { const wanted = new Set(caseIds); const rows = dataset.records.filter((row) => wanted.has(row.case_id)); if (rows.length !== wanted.size) throw new Error("selection contains unknown final5 Case"); return rows; }
