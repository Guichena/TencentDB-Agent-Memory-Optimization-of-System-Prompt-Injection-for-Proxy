import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { loadFinal5Dataset } from "./final5-formal-datasource.js";
import { projectFinal5Evidence } from "./final5-evidence.js";
import { buildFinal5MetricsReport, type Final5MetricEvidence } from "./final5-metrics-report.js";
import { scoreCaseChain } from "./measurement-v2/scorer.js";

type Client = "codex" | "claude-code";
type Variant = "server_team" | "V4";

interface Attempt {
  status: "completed" | "failed";
  startedAt: string;
  evidenceDirectory?: string;
  trace?: { evidenceDirectory?: string; outputDir?: string };
}

interface Checkpoint {
  key: { caseId: string; variant: Variant; repeat: number };
  attempts: Attempt[];
}

interface Candidate {
  root: string;
  checkpoint: string;
  startedAt: string;
  evidence: Final5MetricEvidence;
}

const clients: readonly Client[] = ["codex", "claude-code"];
const variants: readonly Variant[] = ["server_team", "V4"];
const toolRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

function parseOption(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? resolve(process.argv[index + 1]) : resolve(fallback);
}

function evidenceDirectory(attempt: Attempt): string | undefined {
  return attempt.evidenceDirectory ?? attempt.trace?.evidenceDirectory ?? attempt.trace?.outputDir;
}

function eligible(item: Final5MetricEvidence): boolean {
  return item.inputComplete && scoreCaseChain({ ...item.scoring, observationWindow: "full-episode" }).traceCompleteness === true;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function writeJsonl(path: string, rows: readonly unknown[]): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

async function main(): Promise<void> {
  const runsRoot = parseOption("--runs-root", resolve(toolRoot, "../../../../runs"));
  const outputRoot = parseOption("--output", join(runsRoot, "final5-test1k-20260909-consolidated"));
  const teamsRoot = parseOption("--teams-root", join(toolRoot, "formal-dataset/final5/test1k/teams"));
  const dataset = loadFinal5Dataset(teamsRoot);
  const candidates = new Map<string, Candidate[]>();
  const skipped: { root: string; checkpoint: string; reason: string }[] = [];
  const provenance = new Map<string, unknown>();
  console.log("Dataset loaded", dataset.records.length);
  mkdirSync(outputRoot, { recursive: true });
  const cache = new Map<string, Candidate>();
  const collectedPath = join(outputRoot, "collected.jsonl");
  if (existsSync(collectedPath)) for (const line of readFileSync(collectedPath, "utf8").split(/\r?\n/u).filter(Boolean)) {
    try {
      const item = JSON.parse(line) as Candidate;
      if (item.evidence.datasetDigest === dataset.sourceDigest) cache.set(item.checkpoint, item);
    } catch { /* A stopped writer can leave an incomplete last line. */ }
  }
  const jobs: { root: string; client: Client; variant: Variant; checkpointPath: string }[] = [];

  for (const rootEntry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!rootEntry.isDirectory() || !rootEntry.name.startsWith("final5-test1k-")) continue;
    const root = join(runsRoot, rootEntry.name);
    console.log("Reading", rootEntry.name);
    const experimentPath = join(root, "execution", "experiment.json");
    if (existsSync(experimentPath)) {
      try { provenance.set(rootEntry.name, JSON.parse(readFileSync(experimentPath, "utf8")).sourceFingerprints); }
      catch { skipped.push({ root: rootEntry.name, checkpoint: experimentPath, reason: "invalid experiment manifest" }); }
    }
    for (const client of clients) for (const variant of variants) {
      const checkpointRoot = join(root, "execution", client, variant, "execution.json.checkpoint");
      if (!existsSync(checkpointRoot)) continue;
      for (const entry of readdirSync(checkpointRoot, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name === "config.json" || !entry.name.endsWith(".json")) continue;
        const checkpointPath = join(checkpointRoot, entry.name);
        jobs.push({ root: rootEntry.name, client, variant, checkpointPath });
      }
    }
  }
  let processed = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (cursor < jobs.length) {
      const { root, client, variant, checkpointPath } = jobs[cursor++];
        try {
          const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
          if (checkpoint.key.variant !== variant || checkpoint.key.repeat !== 1) throw new Error("invalid checkpoint key");
          const attempt = checkpoint.attempts.find((item) => item.status === "completed");
          const directory = attempt && evidenceDirectory(attempt);
          if (!attempt || !directory || !existsSync(join(directory, "attempt-capture.json"))) {
            skipped.push({ root, checkpoint: checkpointPath, reason: "no completed captured attempt" });
            continue;
          }
          const row = dataset.records.find((item) => item.case_id === checkpoint.key.caseId);
          if (!row) throw new Error("case is absent from test1k dataset");
          const cached = cache.get(checkpointPath);
          let evidence: Final5MetricEvidence;
          if (cached && cached.startedAt === attempt.startedAt) evidence = cached.evidence;
          else {
            const manifest = JSON.parse(await readFile(join(directory, "attempt-capture.json"), "utf8"));
            if (manifest.schemaVersion !== "final5-attempt-capture-v1" || !manifest.sessionId) throw new Error("Invalid attempt capture");
            const [eventText, intentText] = await Promise.all([
              manifest.captureAvailable ? readFile(join(directory, "http-events.jsonl"), "utf8") : Promise.resolve(""),
              readFile(join(directory, "intent-evidence.json"), "utf8").catch((error) => { if (error.code === "ENOENT") return "null"; throw error; }),
            ]);
            evidence = projectFinal5Evidence(row, dataset.sourceDigest, manifest, eventText.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)), JSON.parse(intentText));
          }
          if (evidence.client !== client || evidence.variant !== variant || evidence.caseId !== checkpoint.key.caseId) throw new Error("capture identity mismatch");
          if (!eligible(evidence)) {
            skipped.push({ root, checkpoint: checkpointPath, reason: "captured attempt is not behavior-eligible" });
            continue;
          }
          const key = `${client}:${variant}:${checkpoint.key.caseId}`;
          const values = candidates.get(key) ?? [];
          values.push({ root, checkpoint: checkpointPath, startedAt: attempt.startedAt, evidence });
          candidates.set(key, values);
          if (!cached) appendFileSync(collectedPath, JSON.stringify({ root, checkpoint: checkpointPath, startedAt: attempt.startedAt, evidence }) + "\n");
        } catch (error) {
          skipped.push({ root, checkpoint: checkpointPath, reason: error instanceof Error ? error.message : String(error) });
        } finally {
          processed++;
          if (processed % 100 === 0 || processed === jobs.length) console.log("Processed", processed, "/", jobs.length, "unique eligible", candidates.size, "excluded", skipped.length);
        }
    }
  }));

  const rootsWithEvidence = new Set([...candidates.values()].flatMap((items) => items.map((item) => item.root)));
  const fingerprints = [...rootsWithEvidence].map((root) => JSON.stringify(provenance.get(root) ?? null));
  const mixedSources = new Set(fingerprints).size > 1;

  const selected = [...candidates.entries()].map(([key, items]) => {
    const first = items.sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    return { key, ...first, duplicateCount: items.length };
  }).sort((a, b) => a.key.localeCompare(b.key));

  const summary: Record<string, unknown> = {};
  for (const client of clients) {
    const clientEvidence = selected.filter((item) => item.evidence.client === client).map((item) => item.evidence);
    const report = buildFinal5MetricsReport(dataset, clientEvidence, client);
    for (const variant of variants) {
      const directory = join(outputRoot, variant === "server_team" ? "baseline" : "V4", client);
      const entries = selected.filter((item) => item.evidence.client === client && item.evidence.variant === variant);
      writeJsonl(join(directory, "evidence.jsonl"), entries.map((item) => item.evidence));
      writeJsonl(join(directory, "case-index.jsonl"), entries.map(({ key, root, checkpoint, startedAt, duplicateCount }) => ({ key, root, checkpoint, startedAt, duplicateCount })));
      writeJsonl(join(directory, "case-scores.jsonl"), report.caseScores.filter((item) => item.variant === variant && item.behaviorEligible));
      writeJson(join(directory, "metrics.json"), { status: report.status, coverage: report.coverage, comparison: report.comparison,
        diagnostics: report.diagnostics, providerUsage: report.providerUsage, paired: report.paired, allObservable: report.allObservable,
        metricSupport: report.metricSupport, limitations: report.limitations });
    }
    summary[client] = { status: report.status, coverage: report.coverage, comparison: report.comparison, diagnostics: report.diagnostics, allObservable: report.allObservable,
      providerUsage: report.providerUsage, paired: report.paired, metricSupport: report.metricSupport };
  }
  writeJson(join(outputRoot, "manifest.json"), { schemaVersion: "final5-test1k-consolidated-v1", generatedAt: new Date().toISOString(),
    datasetDigest: dataset.sourceDigest, mixedSources, comparisonWarning: mixedSources ? "Descriptive only: multiple source fingerprints; stratify before attributing changes to V4" : null, sourceFingerprintsByRun: Object.fromEntries(provenance), sourceFingerprints: rootsWithEvidence.size ? provenance.get([...rootsWithEvidence][0]) : null,
    sourceRunRoots: [...rootsWithEvidence].sort(), selectedCaseEvidence: selected.length, skippedCheckpointCount: skipped.length,
    skipped, summary });
  console.log(JSON.stringify({ outputRoot, selectedCaseEvidence: selected.length, sourceRunRoots: [...rootsWithEvidence].sort() }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
