import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFinal5Dataset } from "./final5-formal-datasource.js";
import { readAttemptCapture, projectFinal5Evidence } from "./final5-evidence.js";
import { buildFinal5MetricsReport, type Final5MetricEvidence } from "./final5-metrics-report.js";
import { aggregateProviderUsage, summarizeProviderUsage } from "./final5-provider-usage.js";
import { verifyStageReceipt } from "./merge-stage-receipts.js";
import type { Final5ExecutionReceipt } from "./final5-formal-execution.js";
import { executionHash } from "./execution-checkpoint.js";

export function collectFinal5Evidence(teamsRoot: string, clientRoot: string, client: "codex" | "claude-code", output: string) {
  const dataset = loadFinal5Dataset(teamsRoot);
  const rows = new Map(dataset.records.map(row => [row.case_id, row]));
  const evidence: Final5MetricEvidence[] = [];
  const allUsage = { server_team: [] as ReturnType<typeof summarizeProviderUsage>["requests"][number][], V4: [] as ReturnType<typeof summarizeProviderUsage>["requests"][number][] };
  const sources: { path: string; sha256: string }[] = [];
  const missing: { caseId: string; variant: string; attempt: number }[] = [];
  let comparisonHash: string | undefined;
  let selectedCaseIds: Set<string> | undefined;
  for (const variant of ["server_team", "V4"] as const) {
    const stage = resolve(clientRoot, variant);
    const path = resolve(stage, "execution.json");
    const raw = readFileSync(path);
    const receipt = JSON.parse(raw.toString("utf8")) as Final5ExecutionReceipt;
    verifyStageReceipt(receipt, variant);
    if (receipt.datasetDigest !== dataset.sourceDigest || receipt.executionContext?.comparison.client !== client) throw new Error("Receipt dataset/client mismatch");
    const hash = executionHash(receipt.executionContext.comparison);
    const ids = new Set(receipt.results.map(result => result.caseId));
    if (comparisonHash !== undefined && (comparisonHash !== hash || ids.size !== selectedCaseIds!.size || [...ids].some(id => !selectedCaseIds!.has(id)))) throw new Error("Baseline/V4 conditions or case selection differ");
    comparisonHash = hash; selectedCaseIds = ids;
    sources.push({ path, sha256: createHash("sha256").update(raw).digest("hex") });
    for (const result of receipt.results) {
      const row = rows.get(result.caseId);
      if (!row || result.repeat !== 1) throw new Error("Unknown case or unsupported repeat");
      const attempts = result.attempts?.length ? result.attempts : [{ attempt: 0, status: result.status, evidenceDirectory: (result.trace as any)?.evidenceDirectory ?? (result.trace as any)?.outputDir }];
      for (const [index, attempt] of attempts.entries()) {
        const previous = attempts[index - 1];
        if (attempt.attempt !== index || index > 0 && (previous.status !== "failed" || !(previous as { retryable?: boolean }).retryable)) throw new Error("Only ordered infrastructure-failure retries are eligible");
      }
      if (attempts.at(-1)?.status !== result.status) throw new Error("Attempt status differs from final slot status");
      let selected = false;
      for (const attempt of attempts) {
        const directory = attempt.evidenceDirectory;
        if (!directory) { missing.push({ caseId: result.caseId, variant, attempt: attempt.attempt }); continue; }
        const rel = relative(stage, resolve(directory));
        if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Evidence directory outside stage");
        if (!existsSync(resolve(directory, "attempt-capture.json"))) { missing.push({ caseId: result.caseId, variant, attempt: attempt.attempt }); continue; }
        const { manifest, events, intentEvidence } = readAttemptCapture(directory);
        if (manifest.client !== client || manifest.variant !== variant || manifest.caseId !== result.caseId || manifest.repeat !== result.repeat) throw new Error("Attempt manifest mismatch");
        const projected = projectFinal5Evidence(row, dataset.sourceDigest, manifest, events, intentEvidence);
        allUsage[variant].push(...projected.providerUsage!.requests);
        for (const name of ["attempt-capture.json", "http-events.jsonl"]) {
          const source = resolve(directory, name);
          if (existsSync(source)) sources.push({ path: source, sha256: createHash("sha256").update(readFileSync(source)).digest("hex") });
        }
        if (!selected && attempt.status === "completed") { evidence.push(projected); selected = true; }
      }
    }
  }
  const selectedRecords = dataset.records.filter(row => selectedCaseIds?.has(row.case_id));
  const report = { ...buildFinal5MetricsReport({ ...dataset, records: selectedRecords }, evidence, client), sources, attemptsMissingCapture: missing,
    costAllAttempts: { server_team: aggregateProviderUsage(allUsage.server_team, true), V4: aggregateProviderUsage(allUsage.V4, true) } };
  mkdirSync(output, { recursive: true });
  const persist = (name: string, text: string) => {
    const path = resolve(output, name);
    if (existsSync(path)) { if (readFileSync(path, "utf8") !== text) throw new Error("Derived report differs; use a new output directory: " + path); return; }
    writeFileSync(path, text, { flag: "wx" });
  };
  persist("normalized-evidence.jsonl", evidence.map(row => JSON.stringify(row) + "\n").join(""));
  persist("case-scores.jsonl", report.caseScores.map(row => JSON.stringify(row) + "\n").join(""));
  persist("pair-scores.json", JSON.stringify(report.paired, null, 2) + "\n");
  persist("metric-support.json", JSON.stringify(report.metricSupport, null, 2) + "\n");
  persist("comparison.json", JSON.stringify(report, null, 2) + "\n");
  persist("report.md", "# Final5 " + client + "\n\nStatus: " + report.status + "\n\n| Metric | Baseline | V4 | Delta (pp) |\n|---|---:|---:|---:|\n" + Object.entries(report.comparison).map(([name, value]) => `| ${name} | ${value.baseline.value ?? "NA"} | ${value.final.value ?? "NA"} | ${value.deltaPercentagePoints ?? "NA"} |`).join("\n") + "\n\nProvider-only usage and all retries: see comparison.json. NA is not zero.\n");
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [teams, root, client, output] = process.argv.slice(2);
  if (!output || !["codex", "claude-code"].includes(client)) throw new Error("Usage: collect-final5-evidence.ts <teams> <client root> <client> <new report directory>");
  const report = collectFinal5Evidence(teams, root, client as "codex" | "claude-code", output);
  console.log(JSON.stringify({ status: report.status, coverage: report.coverage, output }));
}
