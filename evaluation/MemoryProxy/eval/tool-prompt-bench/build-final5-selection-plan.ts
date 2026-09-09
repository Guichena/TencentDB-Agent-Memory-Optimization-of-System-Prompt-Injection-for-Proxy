import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFinal5CampaignPlan } from "./final5-campaign-builder.js";
import { loadFinal5Dataset } from "./final5-formal-datasource.js";

const teamsRoot = process.env.FINAL5_TEAMS_ROOT ?? fileURLToPath(new URL("./formal-dataset/final5/test1k/teams", import.meta.url));
const campaignId = process.env.FINAL5_SELECTION_CAMPAIGN_ID?.trim();
const outputPath = process.env.FINAL5_SELECTION_OUTPUT?.trim();
const caseIds = (process.env.FINAL5_SELECTION_CASE_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!campaignId || !outputPath || caseIds.length === 0) {
  throw new Error("FINAL5_SELECTION_CAMPAIGN_ID, FINAL5_SELECTION_OUTPUT and FINAL5_SELECTION_CASE_IDS are required");
}

const plan = buildFinal5CampaignPlan(loadFinal5Dataset(teamsRoot), campaignId, caseIds);
writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ outputPath, campaignId, selectedCaseIds: plan.selectedCaseIds, slotCount: plan.slots.length }));
