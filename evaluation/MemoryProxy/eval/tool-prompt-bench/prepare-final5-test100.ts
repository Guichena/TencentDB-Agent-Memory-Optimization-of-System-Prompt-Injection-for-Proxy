import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFinal5CampaignPlan } from "./final5-campaign-builder.js";
import { loadFinal5Dataset } from "./final5-formal-datasource.js";

export function prepareTest100(outputRoot: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "formal-dataset/final5/test100");
  const dataset = loadFinal5Dataset(resolve(root, "teams"));
  const keep = readFileSync(resolve(root, "keep-case-ids.jsonl"), "utf8").split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  const ids = new Set<string>(keep.map(row => row.case_id));
  if (keep.length !== 100 || ids.size !== 100 || dataset.records.length !== 100 || dataset.teams.length !== 10) throw new Error("Expected exactly 10 teams and 100 unique keep cases");
  for (const row of keep) if (!dataset.records.some(record => record.case_id === row.case_id && record.team_id === row.team_id)) throw new Error("Keep identity mismatch: " + row.case_id);
  const plan = buildFinal5CampaignPlan(dataset, "final5-test100", [...ids]);
  const source = JSON.parse(readFileSync(resolve(root, "../manifests/workspace-resolution-final5-manifest-v2.json"), "utf8"));
  const workspaces = source.filter((row: { caseId: string }) => ids.has(row.caseId));
  if (workspaces.length !== 100 || new Set(workspaces.map((row: { caseId: string }) => row.caseId)).size !== 100) throw new Error("Workspace selection incomplete or duplicated");
  for (const row of dataset.records) if (workspaces.find((workspace: { caseId: string }) => workspace.caseId === row.case_id).baseSha !== row.case.base_sha) throw new Error("Workspace base SHA mismatch: " + row.case_id);
  const output = resolve(outputRoot);
  mkdirSync(resolve(output, "inputs"), { recursive: true });
  const planPath = resolve(output, "inputs/campaign.json");
  const workspacePath = resolve(output, "inputs/workspaces.json");
  const submission = resolve(here, "../../../..");
  const snapshot = resolve(output, "inputs/test100");
  if (existsSync(snapshot)) throw new Error("Dataset snapshot already exists; use a new run directory");
  const config = {
    baselineRoot: resolve(submission, "implementations/baseline"), v4Root: resolve(submission, "implementations/final"),
    proxyConfig: resolve(submission, "evaluation/MemoryProxy/config.example.yaml"), envFile: resolve(submission, "evaluation/.env"),
    teamsRoot: resolve(snapshot, "teams"), skillCatalogBindings: resolve(snapshot, "skill-catalog/case-skill-catalog.jsonl"),
    plan: planPath, workspaceManifest: workspacePath, outputRoot: output, timeoutMs: 1800000, maxRetries: 1,
    clients: { codex: { concurrency: 1, providerKeyEnv: "TDAI_CODEX_PROVIDER_API_KEY" }, "claude-code": { concurrency: 1, providerKeyEnv: "TDAI_CLAUDE_PROVIDER_API_KEY" } },
  };
  const outputs = [[planPath, plan], [workspacePath, workspaces], [resolve(output, "inputs/evaluation.json"), config]] as const;
  for (const [path] of outputs) if (existsSync(path)) throw new Error("Prepared input already exists; use a new run directory: " + path);
  cpSync(resolve(root, "teams"), resolve(snapshot, "teams"), { recursive: true, errorOnExist: true, force: false });
  cpSync(resolve(root, "skill-catalog"), resolve(snapshot, "skill-catalog"), { recursive: true, errorOnExist: true, force: false });
  if (loadFinal5Dataset(resolve(snapshot, "teams")).sourceDigest !== dataset.sourceDigest) throw new Error("Dataset changed while snapshotting; use a new run directory");
  for (const [path, value] of outputs) writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return { configPath: resolve(output, "inputs/evaluation.json"), datasetDigest: dataset.sourceDigest, cases: ids.size, teams: dataset.teams.length, slotsPerClient: plan.slots.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: prepare-final5-test100.ts <new run directory>");
  console.log(JSON.stringify(prepareTest100(process.argv[2]), null, 2));
}
