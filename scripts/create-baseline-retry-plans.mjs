import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPlanFile = path.join(repositoryRoot, "runs/final5-test1k-20260908/campaign.json");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

async function readIncompleteIndex(file, client, sourceRun) {
  const content = await readFile(file, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.client === client && record.variant === "server_team")
    .filter((record) => record.classification !== "timeout_incomplete")
    .map((record) => ({ caseId: record.caseId, sourceRun, classification: record.classification }));
}

async function readNonTimeoutCheckpointFailures(checkpointDirectory, sourceRun) {
  const files = await readdir(checkpointDirectory);
  const records = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => readJson(path.join(checkpointDirectory, file))),
  );
  return records
    .filter((record) => record.key?.caseId && record.attempts?.length)
    .map((record) => ({ caseId: record.key.caseId, attempt: record.attempts.at(-1) }))
    .filter(({ attempt }) => attempt.status !== "completed" && attempt.trace?.timedOut !== true)
    .map(({ caseId }) => ({ caseId, sourceRun, classification: "checkpoint_non_timeout_failure" }));
}

const plan = await readJson(canonicalPlanFile);
const definitions = [
  {
    client: "codex",
    retryRun: "runs/final5-test1k-20260909-baseline-codex-retry",
    evaluationSource: "runs/final5-test1k-20260909-baseline-continuation-codex/evaluation.json",
    port: 8119,
    candidates: [
      () => readNonTimeoutCheckpointFailures(
        path.join(repositoryRoot, "runs/final5-test1k-20260909-formal1/execution/codex/server_team/execution.json.checkpoint"),
        "runs/final5-test1k-20260909-formal1",
      ),
      () => readIncompleteIndex(
        path.join(repositoryRoot, "runs/final5-test1k-20260909-baseline-continuation-codex/execution/live/incomplete-cases.jsonl"),
        "codex",
        "runs/final5-test1k-20260909-baseline-continuation-codex",
      ),
    ],
  },
  {
    client: "claude-code",
    retryRun: "runs/final5-test1k-20260909-baseline-claude-code-retry",
    evaluationSource: "runs/final5-test1k-20260909-baseline-continuation4-claude-code/evaluation.json",
    port: 8120,
    candidates: [
      "baseline-continuation-claude-code",
      "baseline-continuation2-claude-code",
      "baseline-continuation3-claude-code",
      "baseline-continuation4-claude-code",
    ].map((name) => () => readIncompleteIndex(
      path.join(repositoryRoot, `runs/final5-test1k-20260909-${name}/execution/live/incomplete-cases.jsonl`),
      "claude-code",
      `runs/final5-test1k-20260909-${name}`,
    )),
  },
];

for (const definition of definitions) {
  const candidateRecords = (await Promise.all(definition.candidates.map((load) => load()))).flat();
  const sourceByCaseId = new Map();
  for (const record of candidateRecords) {
    if (sourceByCaseId.has(record.caseId)) {
      throw new Error(`${definition.client}: duplicate retry candidate ${record.caseId}`);
    }
    sourceByCaseId.set(record.caseId, record);
  }

  const selectedCaseIds = plan.selectedCaseIds.filter((caseId) => sourceByCaseId.has(caseId));
  if (selectedCaseIds.length !== sourceByCaseId.size) {
    throw new Error(`${definition.client}: a retry candidate is absent from the canonical 1140-case plan`);
  }

  const retryRoot = path.join(repositoryRoot, definition.retryRun);
  const evaluation = await readJson(path.join(repositoryRoot, definition.evaluationSource));
  const retryPlan = {
    ...plan,
    campaignId: `${plan.campaignId}-baseline-${definition.client}-retry-nontimeout-v1`,
    selectedCaseIds,
  };
  const retryEvaluation = {
    ...evaluation,
    plan: `${repositoryRoot}/${definition.retryRun}/plan.json`,
    outputRoot: `${repositoryRoot}/${definition.retryRun}/execution`,
    clients: {
      ...evaluation.clients,
      [definition.client]: { ...evaluation.clients[definition.client], port: definition.port },
    },
  };
  const retryManifest = {
    schemaVersion: "final5-baseline-retry-manifest.v1",
    createdAt: new Date().toISOString(),
    client: definition.client,
    variant: "server_team",
    selectionRule: "All final non-completed, non-timeout baseline records. Timeout is only trace.timedOut true or incomplete-index classification timeout_incomplete.",
    sourceAllCaseCount: plan.allCaseCount,
    datasetDigest: plan.datasetDigest,
    selectedCaseCount: selectedCaseIds.length,
    records: selectedCaseIds.map((caseId) => sourceByCaseId.get(caseId)),
  };

  await mkdir(retryRoot, { recursive: true });
  await Promise.all([
    writeJson(path.join(retryRoot, "plan.json"), retryPlan),
    writeJson(path.join(retryRoot, "evaluation.json"), retryEvaluation),
    writeJson(path.join(retryRoot, "retry-manifest.json"), retryManifest),
  ]);
  console.log(`${definition.client}: ${selectedCaseIds.length} retry cases`);
}
