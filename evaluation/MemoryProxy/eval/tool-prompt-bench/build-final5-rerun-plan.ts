import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFinal5CampaignPlan } from "./final5-campaign-builder.js";
import { loadFinal5Dataset } from "./final5-formal-datasource.js";
import { clientStagePaths, readDualClientConfig } from "./dual-client-plan.js";
import type { Final5Client } from "./final5-task-input.js";
import type { V4Regression } from "./final5-live-report.js";

interface IncompleteCase {
  client: Final5Client;
  variant: "server_team" | "V4";
  caseId: string;
  classification: "timeout_incomplete" | "infrastructure_excluded";
}

export interface RerunSelectionRow {
  caseId: string;
  reasons: string[];
  clients: Final5Client[];
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) throw new Error(`Missing live report artifact: ${path}`);
  return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);
}

export function buildRerunSelection(regressions: readonly V4Regression[], incomplete: readonly IncompleteCase[]): RerunSelectionRow[] {
  const selected = new Map<string, { reasons: Set<string>; clients: Set<Final5Client> }>();
  const add = (caseId: string, client: Final5Client, reason: string) => {
    const row = selected.get(caseId) ?? { reasons: new Set<string>(), clients: new Set<Final5Client>() };
    row.reasons.add(reason);
    row.clients.add(client);
    selected.set(caseId, row);
  };
  for (const item of regressions) {
    for (const reason of item.reasons) add(item.caseId, item.client, `v4_regression:${reason}`);
  }
  for (const item of incomplete) add(item.caseId, item.client, `${item.variant}:${item.classification}`);
  return [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([caseId, value]) => ({
    caseId, reasons: [...value.reasons].sort(), clients: [...value.clients].sort() as Final5Client[],
  }));
}

export function writeRerunPlan(configPath: string, outputDirectory: string, campaignId: string) {
  const config = readDualClientConfig(configPath);
  for (const client of ["codex", "claude-code"] as const) {
    for (const variant of ["server_team", "V4"] as const) {
      const receipt = clientStagePaths(config, client, variant).receipt;
      if (!existsSync(receipt)) throw new Error(`First full run is incomplete; missing receipt: ${receipt}`);
    }
  }
  const live = join(config.outputRoot, "live");
  const regressions = readJsonl<V4Regression>(join(live, "v4-regressions.jsonl"));
  const incomplete = readJsonl<IncompleteCase>(join(live, "incomplete-cases.jsonl"));
  const rows = buildRerunSelection(regressions, incomplete);
  if (!rows.length) throw new Error("No V4 regressions or incomplete cases were found");
  const dataset = loadFinal5Dataset(config.teamsRoot);
  const plan = buildFinal5CampaignPlan(dataset, campaignId, rows.map((row) => row.caseId));
  mkdirSync(outputDirectory, { recursive: true });
  const selection = { schemaVersion: "final5-rerun-selection-v1", generatedAt: new Date().toISOString(),
    sourceOutputRoot: config.outputRoot, datasetDigest: dataset.sourceDigest, caseCount: rows.length, cases: rows };
  const outputs = {
    selection: join(outputDirectory, "rerun-selection.json"),
    campaign: join(outputDirectory, "rerun-campaign.json"),
  };
  for (const [path, value] of [[outputs.selection, selection], [outputs.campaign, plan]] as const) {
    if (existsSync(path)) throw new Error(`Refusing to overwrite frozen rerun artifact: ${path}`);
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  }
  return { ...outputs, caseCount: rows.length, slotCount: plan.slots.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const config = value("--config"), output = value("--output"), campaignId = value("--campaign-id");
  if (!config || !output || !campaignId) throw new Error("Usage: build-final5-rerun-plan.ts --config <evaluation.json> --output <directory> --campaign-id <id>");
  console.log(JSON.stringify(writeRerunPlan(resolve(config), resolve(output), campaignId), null, 2));
}
