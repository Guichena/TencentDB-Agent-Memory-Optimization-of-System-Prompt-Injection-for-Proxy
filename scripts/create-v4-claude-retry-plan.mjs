import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRun = path.join(repositoryRoot, "runs/final5-test1k-20260909-v4-continuation-claude-code");
const retryRun = path.join(repositoryRoot, "runs/final5-test1k-20260909-v4-claude-retry");
const checkpointDirectory = path.join(sourceRun, "execution/claude-code/V4/execution.json.checkpoint");

const sourcePlan = JSON.parse(await readFile(path.join(sourceRun, "plan.json"), "utf8"));
const resultFiles = (await readdir(checkpointDirectory)).filter((file) => file.endsWith(".json"));
const results = await Promise.all(resultFiles.map(async (file) => {
  const result = JSON.parse(await readFile(path.join(checkpointDirectory, file), "utf8"));
  if (!result.key?.caseId || !result.attempts?.length) return null;
  return { caseId: result.key.caseId, attempt: result.attempts.at(-1) };
}));

const retryRecords = results
  .filter(Boolean)
  .filter(({ attempt }) => attempt.status !== "completed" && attempt.trace?.timedOut !== true);
const retryByCaseId = new Map(retryRecords.map((record) => [record.caseId, record]));
if (retryByCaseId.size !== retryRecords.length) {
  throw new Error("Final checkpoint contains duplicate case results");
}

const selectedCaseIds = sourcePlan.selectedCaseIds.filter((caseId) => retryByCaseId.has(caseId));
if (selectedCaseIds.length !== retryByCaseId.size) {
  throw new Error("A final retry case was absent from the source campaign plan");
}

const retryPlan = {
  ...sourcePlan,
  campaignId: `${sourcePlan.campaignId}-retry-final-checkpoint-v1`,
  selectedCaseIds,
};
const retryManifest = {
  schemaVersion: "final5-v4-retry-manifest.v1",
  createdAt: new Date().toISOString(),
  client: "claude-code",
  variant: "V4",
  sourceRun: path.relative(repositoryRoot, sourceRun).replaceAll("\\", "/"),
  sourceCheckpoint: path.relative(repositoryRoot, checkpointDirectory).replaceAll("\\", "/"),
  selectionRule: "Final checkpoint attempt status is not completed and trace.timedOut is not true.",
  sourcePlanCaseCount: sourcePlan.selectedCaseIds.length,
  finalCheckpointResultCount: results.filter(Boolean).length,
  selectedCaseCount: selectedCaseIds.length,
  datasetDigest: sourcePlan.datasetDigest,
  records: selectedCaseIds.map((caseId) => ({
    caseId,
    status: retryByCaseId.get(caseId).attempt.status,
    timedOut: retryByCaseId.get(caseId).attempt.trace?.timedOut === true,
  })),
};

await Promise.all([
  writeFile(path.join(retryRun, "plan.json"), `${JSON.stringify(retryPlan, null, 2)}\n`),
  writeFile(path.join(retryRun, "retry-manifest.json"), `${JSON.stringify(retryManifest, null, 2)}\n`),
]);
console.log(JSON.stringify({ finalResults: results.filter(Boolean).length, retryCases: selectedCaseIds.length }));
