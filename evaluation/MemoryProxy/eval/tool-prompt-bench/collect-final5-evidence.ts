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
import { ATTEMPT_POLICY } from './attempt-policy.js';
import { assessAttempt } from './assess-attempt.js';

export function collectFinal5Evidence(teamsRoot: string, clientRoot: string, client: "codex" | "claude-code", output: string, options: { variant?: 'server_team' | 'V4' } = {}) {
  if (options.variant !== undefined && !['server_team', 'V4'].includes(options.variant)) throw new Error('Invalid scoring variant');
  const dataset = loadFinal5Dataset(teamsRoot);
  const rows = new Map(dataset.records.map(row => [row.case_id, row]));
  const evidence: Final5MetricEvidence[] = [];
  const allUsage = { server_team: [] as ReturnType<typeof summarizeProviderUsage>["requests"][number][], V4: [] as ReturnType<typeof summarizeProviderUsage>["requests"][number][] };
  const sources: { path: string; sha256: string }[] = [];
  const missing: { caseId: string; variant: string; attempt: number }[] = [];
  const dispositions: any[] = [];
  let comparisonHash: string | undefined;
  let selectedCaseIds: Set<string> | undefined;
  const variants = options.variant ? [options.variant] : ['server_team', 'V4'] as const;
  const executionCoverage: Record<string, { planned: number; completed: number; failed: number }> = {};
  for (const variant of variants) {
    const stage = resolve(clientRoot, variant);
    const path = resolve(stage, "execution.json");
    const raw = readFileSync(path);
    const receipt = JSON.parse(raw.toString("utf8")) as Final5ExecutionReceipt;
    verifyStageReceipt(receipt, variant);
    executionCoverage[variant] = { planned: receipt.slotCount, completed: receipt.completed, failed: receipt.failed };
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
        if (!directory) { missing.push({ caseId: result.caseId, variant, attempt: attempt.attempt }); dispositions.push({caseId:result.caseId,variant,attempt:attempt.attempt,category:'retry',retryRequired:true,reason:'missing-evidence-directory'}); continue; }
        const rel = relative(stage, resolve(directory));
        if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Evidence directory outside stage");
        if (!existsSync(resolve(directory, "attempt-capture.json"))) { missing.push({ caseId: result.caseId, variant, attempt: attempt.attempt }); dispositions.push({caseId:result.caseId,variant,attempt:attempt.attempt,category:'retry',retryRequired:true,reason:'missing-attempt-capture'}); continue; }
        let captured: ReturnType<typeof readAttemptCapture>;
        try { captured=readAttemptCapture(directory); }
        catch { missing.push({caseId:result.caseId,variant,attempt:attempt.attempt});dispositions.push({caseId:result.caseId,variant,attempt:attempt.attempt,category:'retry',retryRequired:true,reason:'invalid-capture-files'});continue; }
        const { manifest, events, intentEvidence } = captured;
        if (manifest.client !== client || manifest.variant !== variant || manifest.caseId !== result.caseId || manifest.repeat !== result.repeat) throw new Error("Attempt manifest mismatch");
        const assessment=assessAttempt({ ...attempt, trace: (attempt as any).trace ?? (result as any).trace },client,variant,row,dataset.sourceDigest,directory);
        const {evidence: accepted, ...policy}=assessment as any;
        const projected=accepted??projectFinal5Evidence(row,dataset.sourceDigest,manifest,events,intentEvidence);
        const eligible=assessment.scorable;
        dispositions.push({caseId:result.caseId,variant,attempt:attempt.attempt,...policy,selected:!selected && eligible});
        allUsage[variant].push(...projected.providerUsage!.requests);
        for (const name of ["attempt-capture.json", "http-events.jsonl"]) {
          const source = resolve(directory, name);
          if (existsSync(source)) sources.push({ path: source, sha256: createHash("sha256").update(readFileSync(source)).digest("hex") });
        }
        if (!selected && eligible) { evidence.push(projected); selected = true; }
      }
    }
  }
  const selectedRecords = dataset.records.filter(row => selectedCaseIds?.has(row.case_id));
  const report = { ...buildFinal5MetricsReport({ ...dataset, records: selectedRecords }, evidence, client), sources, attemptsMissingCapture: missing,
    scope: options.variant ? 'single-variant' : 'paired-comparison', selectedVariant: options.variant ?? null, executionCoverage,
    attemptPolicy: ATTEMPT_POLICY, attemptDispositions: dispositions,
    singleVariantMetrics: undefined as Record<string, { numerator: number; denominator: number; value: number | null }> | undefined,
    costAllAttempts: { server_team: aggregateProviderUsage(allUsage.server_team, true), V4: aggregateProviderUsage(allUsage.V4, true) } };
  if (options.variant) {
    const arm = report.allObservable[options.variant === 'server_team' ? 'baseline' : 'final'];
    report.singleVariantMetrics = { ECR: arm.ECR, FCR_all: arm.allNoCall.falseCallRate, TSR_all: arm.TSR_all, TSR_cond: arm.TSR_cond,
      Complete: arm.chainDetails.completeChainSuccessRate, Strict: arm.chainDetails.strictChainExactRate, Overcall: arm.chainDetails.positiveOvercallRate };
    report.caseScores = report.caseScores.filter(row => row.variant === options.variant);
    report.comparison = {};
    report.binaryStatistics = {};
    report.status = report.caseScores.every(row => row.behaviorEligible) ? 'behavior-scored' : 'incomplete-evidence';
    report.providerUsage = Object.fromEntries(variants.map(variant => [variant, aggregateProviderUsage(evidence.filter(row => row.variant === variant && report.caseScores.some(score => score.caseId === row.caseId && score.behaviorEligible)).flatMap(row => row.providerUsage?.requests ?? []))]));
    report.metricSupport.usage.reason = 'Single-variant behavior-eligible completed cases; paired comparison is not available. See providerUsage and costAllAttempts.';
    report.metricSupport.usage.value = Object.fromEntries(Object.entries(report.providerUsage).map(([variant, usage]) => [variant, usage.fields]));
  }
  mkdirSync(output, { recursive: true });
  const persist = (name: string, text: string) => {
    const path = resolve(output, name);
    if (existsSync(path)) { if (readFileSync(path, "utf8") !== text) throw new Error("Derived report differs; use a new output directory: " + path); return; }
    writeFileSync(path, text, { flag: "wx" });
  };
  persist("normalized-evidence.jsonl", evidence.map(row => JSON.stringify(row) + "\n").join(""));
  persist("case-scores.jsonl", report.caseScores.map(row => JSON.stringify(row) + "\n").join(""));
  persist("pair-scores.json", JSON.stringify(options.variant ? { [options.variant]: report.allObservable[options.variant === 'server_team' ? 'baseline' : 'final'] } : report.paired, null, 2) + "\n");
  persist("metric-support.json", JSON.stringify(report.metricSupport, null, 2) + "\n");
  persist("comparison.json", JSON.stringify(report, null, 2) + "\n");
  const coverageText = Object.entries(executionCoverage).map(([variant, c]) => `${variant}: planned=${c.planned}, completed=${c.completed}, failed=${c.failed}, behavior-eligible=${report.caseScores.filter(r => r.variant === variant && r.behaviorEligible).length}`).join('\n\n');
  const table = report.singleVariantMetrics
    ? `Single variant: ${options.variant}. No baseline/V4 comparison.\n\n| Metric | Numerator / denominator | Value |\n|---|---:|---:|\n` + Object.entries(report.singleVariantMetrics).map(([name, value]) => `| ${name} | ${value.numerator}/${value.denominator} | ${value.value ?? 'NA'} |`).join('\n')
    : `Paired behavior-eligible cases: ${report.coverage.pairedCases}/${report.coverage.plannedCasesPerVariant}\n\n| Metric | Baseline | V4 | Delta (pp) |\n|---|---:|---:|---:|\n` + Object.entries(report.comparison).map(([name, value]) => `| ${name} | ${value.baseline.value ?? 'NA'} | ${value.final.value ?? 'NA'} | ${value.deltaPercentagePoints ?? 'NA'} |`).join('\n');
  persist('report.md', '# Final5 ' + client + '\n\nStatus: ' + report.status + '\n\n' + coverageText + '\n\n' + table + '\n\nValues are proportions (0..1); deltas are percentage points. Missing evidence is not zero. See comparison.json for coverage and limitations.\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [teams, root, client, output] = process.argv.slice(2);
  if (!output || !["codex", "claude-code"].includes(client)) throw new Error("Usage: collect-final5-evidence.ts <teams> <client root> <client> <new report directory>");
  const report = collectFinal5Evidence(teams, root, client as "codex" | "claude-code", output);
  console.log(JSON.stringify({ status: report.status, coverage: report.coverage, output }));
}
