import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFinal5Dataset, type Final5Dataset } from "./final5-formal-datasource.js";
import { scoreCaseChain } from "./measurement-v2/scorer.js";
import { buildTask1BehaviorReport, type BehaviorReportRow } from "./measurement-v2/task1-behavior-report.js";
import { ratioWithWilson95, pairedDifferenceV4MinusV0, bootstrapClusterDifference, FROZEN_STATISTICS_CONFIG_V2 } from "./measurement-v2/task1-statistics.js";
import type { ScoreCaseChainInputV2 } from "./measurement-v2/types.js";
import { aggregateProviderUsage, type summarizeProviderUsage } from "./final5-provider-usage.js";
import { compileFinal5Gold, FINAL5_GOLD_COMPILER_VERSION } from "./final5-gold-compiler.js";
import { isDeepStrictEqual } from "node:util";

export interface Final5MetricEvidence {
  datasetDigest: string;
  client: "codex" | "claude-code";
  variant: "server_team" | "V4";
  caseId: string;
  repeat: 1;
  inputComplete: boolean;
  intentComplete: boolean;
  intentEvidence?: { complete: boolean; observedModelIntentCount: number; boundHttpAttemptCount: number; intentBindings: readonly { intentId: string; correlationId: string | null; alignment: string; disposition: string; source: string }[] };
  scoring: ScoreCaseChainInputV2;
  compilerVersion?: string;
  providerUsage?: ReturnType<typeof summarizeProviderUsage>;
  auxiliaryProviderUsage?: ReturnType<typeof summarizeProviderUsage>;
  providerUsageScope?: "task-only-excluding-cli-title";
}

/** Offline evidence consumer, not a replacement for the CLI/provider/bridge collector. */
export function buildFinal5MetricsReport(dataset: Final5Dataset, evidence: readonly Final5MetricEvidence[], client: Final5MetricEvidence["client"]) {
  const byCase = new Map(dataset.records.map(row => [row.case_id, row]));
  const entries = new Map<string, Final5MetricEvidence>();
  for (const item of evidence) {
    if (item.client !== client) throw new Error("Client comparisons must be separate");
    if (item.datasetDigest !== dataset.sourceDigest || item.repeat !== 1 || !["server_team", "V4"].includes(item.variant)) throw new Error("Invalid evidence dataset, repeat or variant");
    const row = byCase.get(item.caseId);
    if (!row || item.scoring.observation.caseId !== item.caseId || item.scoring.observation.variantId !== item.variant) throw new Error("Evidence identity mismatch");
    if (item.compilerVersion && (item.compilerVersion !== FINAL5_GOLD_COMPILER_VERSION || !isDeepStrictEqual(item.scoring.gold, compileFinal5Gold(row)))) throw new Error("Compiled binding predicates differ from author Gold compiler");
    if (item.scoring.gold.caseId !== item.caseId || (item.scoring.gold.expectation === "tool") !== row.gold.should_call) throw new Error("Compiled Gold label mismatch");
    if (row.gold.should_call && item.scoring.gold.allowedSequences.some(sequence => JSON.stringify(sequence.steps.map(step => step.tool)) !== JSON.stringify(row.gold.expected_sequence))) throw new Error("Compiled Gold sequence differs from author Gold");
    const key = item.variant + ":" + item.caseId;
    if (entries.has(key)) throw new Error("Duplicate evidence; select earliest eligible infrastructure attempt before scoring");
    entries.set(key, item);
  }
  const scoreRows = (variant: Final5MetricEvidence["variant"]): BehaviorReportRow[] => dataset.records.map(row => {
    const item = entries.get(variant + ":" + row.case_id);
    const score = item ? scoreCaseChain({ ...item.scoring, observationWindow: "full-episode" }) : null;
    return { caseId: row.case_id, shouldCall: row.gold.should_call === true,
      pairId: row.gold.pair_id ? row.team_id + ":" + row.gold.pair_id : null,
      behaviorEligible: !!item?.inputComplete && score?.traceCompleteness === true,
      intentComplete: item?.intentComplete === true, score };
  });
  const baseline = scoreRows("server_team"), final = scoreRows("V4");
  const common = new Set(baseline.filter((row, i) => row.behaviorEligible && final[i].behaviorEligible).map(row => row.caseId));
  const paired = (rows: BehaviorReportRow[]) => rows.map((row, i) => ({ ...row, behaviorEligible: row.behaviorEligible && common.has(row.caseId), intentComplete: baseline[i].intentComplete && final[i].intentComplete }));
  const left = buildTask1BehaviorReport(paired(baseline)), right = buildTask1BehaviorReport(paired(final));
  const main = (report: typeof left) => ({ ECR: report.ECR, FCR_all: report.allNoCall.falseCallRate, FCR_pair: report.pairNoCall.falseCallRate,
    TSR_all: report.TSR_all, TSR_cond: report.TSR_cond, BSA: report.pairBoundarySwitch, PairExact: report.pairExact,
    Complete: report.chainDetails.completeChainSuccessRate, Strict: report.chainDetails.strictChainExactRate,
    Overcall: report.chainDetails.positiveOvercallRate });
  const lm = main(left), rm = main(right);  const diagnostics = (rows: BehaviorReportRow[]) => {
    const positive = rows.filter(row => row.behaviorEligible && row.shouldCall && row.score);
    const coverageNumerator = positive.reduce((sum, row) => sum + (row.score!.matchedSequenceLength ?? 0), 0);
    const coverageDenominator = positive.reduce((sum, row) => sum + row.score!.shortestAllowedLength, 0);
    const prerequisiteViolations = positive.filter(row => row.score!.prerequisiteViolation === true).length;
    const bindingSlotCount = positive.reduce((sum, row) => sum + (row.score!.bindingSlotCount ?? 0), 0);
    const bindingSlotMatchedCount = positive.reduce((sum, row) => sum + (row.score!.bindingSlotMatchedCount ?? 0), 0);
    const bindingCases = positive.filter(row => row.score!.bindingSlotCount !== null);
    const bindingCorrectCases = bindingCases.filter(row => row.score!.bindingSlotMatchedCount === row.score!.bindingSlotCount).length;
    return {
      stepCoverage: { numerator: coverageNumerator, denominator: coverageDenominator, value: coverageDenominator ? coverageNumerator / coverageDenominator : null },
      prerequisiteViolation: { numerator: prerequisiteViolations, denominator: positive.length, value: positive.length ? prerequisiteViolations / positive.length : null },
      bindingSlotAccuracy: { numerator: bindingSlotMatchedCount, denominator: bindingSlotCount, value: bindingSlotCount ? bindingSlotMatchedCount / bindingSlotCount : null },
      bindingCaseAccuracy: { numerator: bindingCorrectCases, denominator: bindingCases.length, value: bindingCases.length ? bindingCorrectCases / bindingCases.length : null },
    };
  };
  const providerUsage = Object.fromEntries((["server_team", "V4"] as const).map(variant => [variant,
    aggregateProviderUsage(evidence.filter(row => row.variant === variant && common.has(row.caseId)).flatMap(row => row.providerUsage?.requests ?? []))]));
  const comparison = Object.fromEntries(Object.keys(lm).map(key => {
    const metric = key as keyof typeof lm;
    return [metric, { baseline: ratioWithWilson95(lm[metric].numerator, lm[metric].denominator), final: ratioWithWilson95(rm[metric].numerator, rm[metric].denominator),
      deltaPercentagePoints: lm[metric].value === null || rm[metric].value === null ? null : 100 * (rm[metric].value! - lm[metric].value!), direction: metric.startsWith("FCR") || metric === "Overcall" ? "lower" : "higher" }];
  }));
  const binaryStatistics = Object.fromEntries((["ECR", "TSR_all", "Complete", "Strict", "FCR_all"] as const).map(metricId => {
    const field = { ECR: "triggeredAttempt", TSR_all: "firstActionSelectionCorrect", Complete: "completeChainSuccess", Strict: "strictChainExact", FCR_all: "falseCallAttempt" } as const;
    const pairs = baseline.flatMap((row, i) => common.has(row.caseId) && row.shouldCall === (metricId !== "FCR_all") ? [{ caseId: row.caseId, v0: row.score![field[metricId]] === true, v4: final[i].score![field[metricId]] === true }] : []);
    const input = { pairs, metricId, successDefinition: metricId === "FCR_all" ? "false-call event (lower is better)" : metricId };
    return [metricId, { discordance: pairedDifferenceV4MinusV0({ ...input, nonInferiorityMargin: null }),
      bootstrap: pairs.length ? bootstrapClusterDifference({ ...input, clusterAssignment: pairs.map(pair => ({ caseId: pair.caseId, clusterId: byCase.get(pair.caseId)!.team_id })), unit: "evaluation_team", config: FROZEN_STATISTICS_CONFIG_V2 }) : null }];
  }));
  return { schemaVersion: "task1.final5-metrics-report.v1", client, datasetDigest: dataset.sourceDigest,
    status: common.size === dataset.records.length ? evidence.every(row => row.compilerVersion === FINAL5_GOLD_COMPILER_VERSION) ? "behavior-scored" : "provisional-behavior-scored" : "incomplete-evidence",
    coverage: { plannedCasesPerVariant: dataset.records.length, pairedCases: common.size, missingBaseline: baseline.filter(row => !row.behaviorEligible).map(row => row.caseId), missingFinal: final.filter(row => !row.behaviorEligible).map(row => row.caseId) },
    comparison, diagnostics: { baseline: diagnostics(baseline), final: diagnostics(final) }, binaryStatistics, providerUsage,
    providerUsageScope: evidence.every(row => row.providerUsageScope === "task-only-excluding-cli-title") ? "task-only-excluding-cli-title" : "unspecified",
    auxiliaryProviderUsage: Object.fromEntries((["server_team", "V4"] as const).map(variant => [variant,
      aggregateProviderUsage(evidence.filter(row => row.variant === variant).flatMap(row => row.auxiliaryProviderUsage?.requests ?? []))])),
    paired: { baseline: left, final: right },
    allObservable: { baseline: buildTask1BehaviorReport(baseline), final: buildTask1BehaviorReport(final) },
    caseScores: [...baseline.map(row => ({ ...row, variant: "server_team" })), ...final.map(row => ({ ...row, variant: "V4" }))],
    metricSupport: { behavior: "full-episode; HTTP projection with author-compiled argument and response-binding predicates",
      T_static: { value: null, reason: "actual complete static injection text/tokenizer ledger not connected" },
      usage: { value: Object.values(providerUsage).some(value => value.requestCount > 0) ? Object.fromEntries(Object.entries(providerUsage).map(([variant, value]) => [variant, value.fields])) : null,
        reason: "Successful provider requests on paired behavior-complete cases; failed requests excluded, CLI totals not added; missing fields remain null" },
      target: { value: null, reason: "restore runtime IDs and response identity projection not connected" },
      additionalDiagnostics: { value: { stepCoverage: true, bindingSlotAccuracy: true, bindingCaseAccuracy: true, prerequisiteViolation: true, targetIdentity: false }, reason: "Step coverage is available from scored prefixes; binding/prerequisite/target evidence still requires dedicated projection" } },
    limitations: ["Manually supplied normalized evidence does not attest a real run; use collect-final5-evidence.ts with captured artifacts", "Malformed CLI intentions with no HTTP request remain unobservable; Pair Exact is unavailable for HTTP-only evidence", "Shared neighbor assets limit Team independence", "No non-inferiority claim", "Missing raw evidence is not a no-call"] };
}

export function writeFinal5MetricsReport(report: ReturnType<typeof buildFinal5MetricsReport>, output: string) {
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "comparison.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  writeFileSync(resolve(output, "case-scores.jsonl"), report.caseScores.map(row => JSON.stringify(row) + "\n").join(""), { flag: "wx" });
  writeFileSync(resolve(output, "metric-support.json"), JSON.stringify(report.metricSupport, null, 2) + "\n", { flag: "wx" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [teamsRoot, evidencePath, client, output] = process.argv.slice(2);
  if (!output || !["codex", "claude-code"].includes(client)) throw new Error("Usage: final5-metrics-report.ts <teams> <normalized.jsonl> <codex|claude-code> <new report directory>");
  const rows = readFileSync(evidencePath, "utf8").split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));

  const report = buildFinal5MetricsReport(loadFinal5Dataset(teamsRoot), rows, client as Final5MetricEvidence["client"]);
  writeFinal5MetricsReport(report, output);
  console.log(JSON.stringify({ status: report.status, coverage: report.coverage }));
}
