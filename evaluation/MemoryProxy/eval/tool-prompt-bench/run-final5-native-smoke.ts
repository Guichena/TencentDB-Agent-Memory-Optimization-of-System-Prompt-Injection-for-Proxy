import { readFileSync, writeFileSync } from "node:fs";
import { loadFinal5Dataset, selectFinal5Cases } from "./final5-formal-datasource.js";
import { executeFinal5NativeSlot } from "./final5-real-executor.js";
import { expectedCasesFromRecords, findWorkspaceBinding, readWorkspaceManifestFile, validateWorkspaceManifest } from "./final5-workspace-manifest.js";

const root = "D:/projects/team-migration/teams";
const base = "benchmark-runs/task1-data-closeout-20260906";
const plan = JSON.parse(readFileSync(`${base}/final5-campaign-plan-e1-8.json`, "utf8"));
const dataset = loadFinal5Dataset(root);
const selected = selectFinal5Cases(dataset, [plan.selectedCaseIds[0]]);
const rows = readWorkspaceManifestFile(`${base}/workspace-resolution-final5-manifest-v2.json`);
const validation = validateWorkspaceManifest(rows, expectedCasesFromRecords(dataset.records), { teamsRoot: root, expectedTeamCount: dataset.teams.length });
if (!validation.qa.valid) throw new Error(`workspace manifest invalid: ${validation.qa.errors[0]?.message}`);
const binding = findWorkspaceBinding(validation.bindings, selected[0].case_id);
if (!binding?.repositoryPath || !binding.workspaceReady) throw new Error("selected Case has no ready workspace");
const results: unknown[] = [];
for (const variant of ["server_team", "V4"] as const) {
  try {
    results.push({ caseId: selected[0].case_id, variant, status: "completed", trace: await executeFinal5NativeSlot(
      { caseId: selected[0].case_id, variant, repeat: 1 }, selected[0],
      { workspace: binding, workspaceRoot: process.env.FINAL5_EXECUTION_WORKSPACE_ROOT ?? "D:/task1-wt", teamsRoot: root, timeoutMs: 180000 },
    ) });
  } catch (error) {
    results.push({ caseId: selected[0].case_id, variant, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}
writeFileSync(`${base}/final5-native-smoke-e1.json`, `${JSON.stringify({ schemaVersion: "task1.final5-native-smoke.v1", caseId: selected[0].case_id, results }, null, 2)}\n`);
console.log(JSON.stringify(results.map((result) => ({ variant: (result as {variant:string}).variant, status: (result as {status:string}).status, error: (result as {error?:string}).error }))));
