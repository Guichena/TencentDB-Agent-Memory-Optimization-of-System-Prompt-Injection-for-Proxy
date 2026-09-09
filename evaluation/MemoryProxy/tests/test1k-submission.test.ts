import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadFinal5Dataset } from "../eval/tool-prompt-bench/final5-formal-datasource.js";
import { loadSkillCatalogCoverage } from "../eval/tool-prompt-bench/final5-workspace-manifest.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = "evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5";
const dataset = loadFinal5Dataset(resolve(root, base, "test1k/teams"));
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

it("ships the complete sole test1k dataset in Git, not just local ignored files", () => {
  expect(dataset.teams).toHaveLength(39);
  expect(dataset.records).toHaveLength(1140);
  expect(existsSync(resolve(root, base, "teams"))).toBe(false);
  expect(existsSync(resolve(root, base, "test100"))).toBe(false);
  const tracked = new Set(execFileSync("git", ["ls-files", "--", `${base}/test1k`], { cwd: root, encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/));
  const required = ["keep-case-ids.jsonl", "case-windows.jsonl", "skill-catalog/case-skill-catalog.jsonl", "skill-catalog/searchable-skills.jsonl", "skill-catalog/skill-catalogs.jsonl"];
  for (const team of new Set(dataset.records.map(row => row.team_id))) {
    for (const name of ["cases.jsonl", "gold.jsonl", "evidence.jsonl", "assets.json", "team.json"]) required.push(`teams/${team}/data/${name}`);
  }
  expect(required.filter(path => !tracked.has(`${base}/test1k/${path}`))).toEqual([]);
});

it("keeps example plan, workspace map and catalog aligned with 1140 cases", () => {
  const config = read("scripts/final5-evaluation.example.json");
  const plan = read(`scripts/${config.plan}`);
  const rows = read(`scripts/${config.workspaceManifest}`);
  expect(config.teamsRoot).toContain("/test1k/teams");
  expect(config.skillCatalogBindings).toContain("/test1k/skill-catalog/");
  expect(plan.allCaseCount).toBe(1140);
  expect(plan.datasetDigest).toBe(dataset.sourceDigest);
  expect(rows).toHaveLength(1140);
  const byId = new Map(rows.map((row: any) => [row.caseId, row]));
  for (const row of dataset.records) expect(byId.get(row.case_id)).toMatchObject({ teamId: row.team_id, baseSha: row.case.base_sha });
  expect(loadSkillCatalogCoverage(resolve(root, "scripts", config.skillCatalogBindings), dataset.records.map(row => row.case_id)).valid).toBe(true);
  const source = readFileSync(resolve(root, "evaluation/MemoryProxy/eval/tool-prompt-bench/run-final5-native-campaign.ts"), "utf8");
  expect(source).toContain('resolve(datasetRoot, "test1k/teams")');
  expect(source).toContain('resolve(datasetRoot, "test1k/skill-catalog/case-skill-catalog.jsonl")');
});
