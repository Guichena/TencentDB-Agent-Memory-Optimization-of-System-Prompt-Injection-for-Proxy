import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDualClientConfig, clientStagePaths, type DualClientConfig } from "./dual-client-plan.js";
import { loadFinal5Dataset, type Final5Dataset } from "./final5-formal-datasource.js";
import { readAttemptCapture, projectFinal5Evidence } from "./final5-evidence.js";
import { buildFinal5MetricsReport, type Final5MetricEvidence } from "./final5-metrics-report.js";
import type { RecordedAttempt } from "./execution-checkpoint.js";
import type { Final5Client } from "./final5-task-input.js";

const clients = ["codex", "claude-code"] as const;
const variants = ["server_team", "V4"] as const;
type Variant = typeof variants[number];

interface CheckpointFile {
  key: { caseId: string; variant: Variant; repeat: number };
  attempts: RecordedAttempt[];
}

interface CachedCheckpoint {
  mtimeMs: number;
  value: CheckpointFile;
  evidence: Final5MetricEvidence | null;
}

interface IncompleteCase {
  client: Final5Client;
  variant: Variant;
  caseId: string;
  classification: "timeout_incomplete" | "infrastructure_excluded";
  attempts: number;
  error: string | null;
}

export interface V4Regression {
  client: Final5Client;
  caseId: string;
  shouldCall: boolean;
  pairId: string | null;
  reasons: string[];
  baseline: Record<string, unknown>;
  v4: Record<string, unknown>;
}

const positiveHigherIsBetter = [
  "triggeredAttempt",
  "firstActionSelectionCorrect",
  "terminalSelectionCorrect",
  "completeChainSuccess",
  "runtimeAcceptedChain",
  "strictChainExact",
  "shortestExact",
] as const;

function scoreSummary(score: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries([
    ...positiveHigherIsBetter,
    "falseCallAttempt",
    "falseCallAccepted",
    "positiveOvercall",
    "failureLayer",
    "matchedSequenceLength",
    "shortestAllowedLength",
    "observedAttemptCount",
    "bindingSlotMatchedCount",
    "bindingSlotCount",
  ].map((key) => [key, score[key]]));
}

export function classifyV4Regression(input: {
  client: Final5Client;
  baseline: { caseId: string; shouldCall: boolean; pairId: string | null; behaviorEligible: boolean; score: Record<string, unknown> | null };
  v4: { caseId: string; shouldCall: boolean; pairId: string | null; behaviorEligible: boolean; score: Record<string, unknown> | null };
}): V4Regression | null {
  const { baseline, v4 } = input;
  if (baseline.caseId !== v4.caseId || baseline.shouldCall !== v4.shouldCall) throw new Error("Mismatched case score pair");
  if (!baseline.behaviorEligible || !v4.behaviorEligible || !baseline.score || !v4.score) return null;
  const reasons: string[] = [];
  if (baseline.shouldCall) {
    for (const field of positiveHigherIsBetter) {
      if (baseline.score[field] === true && v4.score[field] !== true) reasons.push(`${field}:true->false`);
    }
    if (baseline.score.positiveOvercall === false && v4.score.positiveOvercall === true) reasons.push("positiveOvercall:false->true");
    const baselineMatched = baseline.score.matchedSequenceLength;
    const v4Matched = v4.score.matchedSequenceLength;
    if (typeof baselineMatched === "number" && typeof v4Matched === "number" && v4Matched < baselineMatched) {
      reasons.push(`matchedSequenceLength:${baselineMatched}->${v4Matched}`);
    }
    const baselineBinding = baseline.score.bindingSlotMatchedCount;
    const v4Binding = v4.score.bindingSlotMatchedCount;
    if (typeof baselineBinding === "number" && typeof v4Binding === "number" && v4Binding < baselineBinding) {
      reasons.push(`bindingSlotMatchedCount:${baselineBinding}->${v4Binding}`);
    }
  } else {
    for (const field of ["falseCallAttempt", "falseCallAccepted"] as const) {
      if (baseline.score[field] === false && v4.score[field] === true) reasons.push(`${field}:false->true`);
    }
  }
  if (!reasons.length) return null;
  return { client: input.client, caseId: baseline.caseId, shouldCall: baseline.shouldCall, pairId: baseline.pairId,
    reasons, baseline: scoreSummary(baseline.score), v4: scoreSummary(v4.score) };
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function checkpointFiles(config: DualClientConfig, client: Final5Client, variant: Variant): string[] {
  const directory = join(clientStagePaths(config, client, variant).root, "execution.json.checkpoint");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "config.json")
    .map((entry) => join(directory, entry.name));
}

function selectedEvidence(dataset: Final5Dataset, client: Final5Client, checkpoint: CheckpointFile): Final5MetricEvidence | null {
  const attempt = checkpoint.attempts.find((item) => item.status === "completed");
  const directory = attempt?.evidenceDirectory ?? (attempt?.trace as { evidenceDirectory?: string; outputDir?: string } | undefined)?.evidenceDirectory
    ?? (attempt?.trace as { outputDir?: string } | undefined)?.outputDir;
  if (!directory || !existsSync(join(directory, "attempt-capture.json"))) return null;
  const row = dataset.records.find((item) => item.case_id === checkpoint.key.caseId);
  if (!row) throw new Error(`Unknown checkpoint case: ${checkpoint.key.caseId}`);
  const { manifest, events, intentEvidence } = readAttemptCapture(directory);
  if (manifest.client !== client || manifest.variant !== checkpoint.key.variant || manifest.caseId !== checkpoint.key.caseId) {
    throw new Error(`Checkpoint evidence identity mismatch: ${checkpoint.key.caseId}`);
  }
  return projectFinal5Evidence(row, dataset.sourceDigest, manifest, events, intentEvidence);
}

export function isTimeoutAttempt(attempt: RecordedAttempt): boolean {
  const trace = attempt.trace as { timedOut?: boolean; infrastructureError?: string; receipt?: { timedOut?: boolean } } | undefined;
  return trace?.timedOut === true || trace?.receipt?.timedOut === true
    || /timed out/i.test(trace?.infrastructureError ?? "") || /timed out/i.test(attempt.error ?? "");
}

function stageProgress(config: DualClientConfig, values: CheckpointFile[], client: Final5Client, variant: Variant,
  incompleteCases: IncompleteCase[]) {
  let completed = 0, retrying = 0, timeoutIncomplete = 0, excluded = 0, attempts = 0;
  for (const value of values) {
    if (value.key.variant !== variant || value.key.repeat !== 1) throw new Error("Invalid checkpoint key");
    attempts += value.attempts.length;
    const last = value.attempts.at(-1);
    if (!last) continue;
    if (last.status === "completed") completed += 1;
    else if (last.retryable && value.attempts.length <= config.maxRetries) retrying += 1;
    else {
      const timedOut = isTimeoutAttempt(last);
      if (timedOut) timeoutIncomplete += 1;
      else excluded += 1;
      incompleteCases.push({ client, variant, caseId: value.key.caseId,
        classification: timedOut ? "timeout_incomplete" : "infrastructure_excluded",
        attempts: value.attempts.length, error: last.error ?? null });
    }
  }
  const receipt = clientStagePaths(config, client, variant).receipt;
  return { planned: JSON.parse(readFileSync(config.plan, "utf8")).selectedCaseIds.length, started: values.length,
    completed, retrying, incomplete: timeoutIncomplete + excluded, timeoutIncomplete,
    infrastructureExcluded: excluded, attempts, stageReceiptComplete: existsSync(receipt) };
}

export function updateLiveReport(configPath: string, cache = new Map<string, CachedCheckpoint>()) {
  const config = readDualClientConfig(configPath);
  const dataset = loadFinal5Dataset(config.teamsRoot);
  const output = join(config.outputRoot, "live");
  const byLane = new Map<string, CheckpointFile[]>();
  const evidenceByClient = new Map<Final5Client, Final5MetricEvidence[]>();
  for (const client of clients) {
    evidenceByClient.set(client, []);
    for (const variant of variants) {
      const values: CheckpointFile[] = [];
      for (const path of checkpointFiles(config, client, variant)) {
        const mtimeMs = statSync(path).mtimeMs;
        let cached = cache.get(path);
        if (!cached || cached.mtimeMs !== mtimeMs) {
          const value = JSON.parse(readFileSync(path, "utf8")) as CheckpointFile;
          cached = { mtimeMs, value, evidence: selectedEvidence(dataset, client, value) };
          cache.set(path, cached);
        }
        values.push(cached.value);
        if (cached.evidence) evidenceByClient.get(client)!.push(cached.evidence);
      }
      byLane.set(`${client}:${variant}`, values);
    }
  }
  const reports = new Map<Final5Client, ReturnType<typeof buildFinal5MetricsReport>>();
  const regressions: V4Regression[] = [];
  for (const client of clients) {
    const report = buildFinal5MetricsReport(dataset, evidenceByClient.get(client)!, client);
    reports.set(client, report);
    atomicWrite(join(output, `latest-metrics-${client}.json`), JSON.stringify(report, null, 2) + "\n");
    const baseline = new Map(report.caseScores.filter((item) => item.variant === "server_team").map((item) => [item.caseId, item]));
    for (const item of report.caseScores.filter((row) => row.variant === "V4")) {
      const left = baseline.get(item.caseId);
      if (!left) continue;
      const regression = classifyV4Regression({ client, baseline: left as Parameters<typeof classifyV4Regression>[0]["baseline"],
        v4: item as Parameters<typeof classifyV4Regression>[0]["v4"] });
      if (regression) regressions.push(regression);
    }
  }
  regressions.sort((a, b) => a.client.localeCompare(b.client) || a.caseId.localeCompare(b.caseId));
  atomicWrite(join(output, "v4-regressions.jsonl"), regressions.map((item) => JSON.stringify(item) + "\n").join(""));
  const incompleteCases: IncompleteCase[] = [];
  const progress = { schemaVersion: "final5-live-progress-v1", updatedAt: new Date().toISOString(), datasetDigest: dataset.sourceDigest,
    lanes: Object.fromEntries(clients.flatMap((client) => variants.map((variant) => [`${client}:${variant}`,
      stageProgress(config, byLane.get(`${client}:${variant}`)!, client, variant, incompleteCases)]))),
    pairedCases: Object.fromEntries(clients.map((client) => [client, reports.get(client)!.coverage.pairedCases])),
    v4RegressionCount: Object.fromEntries(clients.map((client) => [client, regressions.filter((item) => item.client === client).length])) };
  incompleteCases.sort((a, b) => a.client.localeCompare(b.client) || a.variant.localeCompare(b.variant) || a.caseId.localeCompare(b.caseId));
  atomicWrite(join(output, "incomplete-cases.jsonl"), incompleteCases.map((item) => JSON.stringify(item) + "\n").join(""));
  atomicWrite(join(output, "progress.json"), JSON.stringify(progress, null, 2) + "\n");
  const paired = Math.min(...clients.map((client) => reports.get(client)!.coverage.pairedCases));
  const batches = join(output, "batches");
  mkdirSync(batches, { recursive: true });
  for (const client of clients) {
    const report = reports.get(client)!;
    const eligibleBaseline = report.caseScores.filter((item) => item.variant === "server_team" && item.behaviorEligible).length;
    const prefix = `baseline-${client}-`;
    const previousBaseline = readdirSync(batches).filter((name) => name.startsWith(prefix) && /^\d+\.json$/.test(name.slice(prefix.length)))
      .map((name) => Number(basename(name, ".json").slice(prefix.length))).reduce((max, value) => Math.max(max, value), 0);
    if (eligibleBaseline >= previousBaseline + 50) {
      atomicWrite(join(batches, `${prefix}${String(eligibleBaseline).padStart(4, "0")}.json`), JSON.stringify({
        schemaVersion: "final5-baseline-live-batch-v1",
        createdAt: new Date().toISOString(),
        client,
        eligibleBaselineCases: eligibleBaseline,
        progress,
        metrics: report,
      }, null, 2) + "\n");
    }
  }
  const previous = readdirSync(batches).filter((name) => /^paired-\d+\.json$/.test(name))
    .map((name) => Number(basename(name, ".json").slice("paired-".length))).reduce((max, value) => Math.max(max, value), 0);
  if (paired >= previous + 50) {
    atomicWrite(join(batches, `paired-${String(paired).padStart(4, "0")}.json`), JSON.stringify({ progress, regressions,
      metrics: Object.fromEntries(clients.map((client) => [client, reports.get(client)])) }, null, 2) + "\n");
  }
  return progress;
}

async function main() {
  const configIndex = process.argv.indexOf("--config");
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  if (!configPath) throw new Error("Usage: final5-live-report.ts --config <evaluation.json> [--watch] [--interval-ms 60000]");
  const cache = new Map<string, CachedCheckpoint>();
  const run = () => console.log(JSON.stringify(updateLiveReport(resolve(configPath), cache)));
  run();
  if (!process.argv.includes("--watch")) return;
  const intervalIndex = process.argv.indexOf("--interval-ms");
  const intervalMs = intervalIndex >= 0 ? Number(process.argv[intervalIndex + 1]) : 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10_000) throw new Error("interval-ms must be at least 10000");
  while (true) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    try { run(); } catch (error) { console.error(error instanceof Error ? error.stack : String(error)); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
