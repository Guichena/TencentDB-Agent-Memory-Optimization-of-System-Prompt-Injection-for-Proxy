import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, FIXTURES } from "./case-definitions.js";
import { evaluateToolPromptCase, type TdaiAttempt, type ToolPromptEvaluation } from "./evaluator.js";

export interface TraceRecord {
  evaluationLayer?: string;
  formalMetricEligible?: boolean;
  caseId: string;
  runId: string;
  attempts: TdaiAttempt[];
  infrastructureError?: string;
}

export interface ScoredRecord extends ToolPromptEvaluation {
  evaluationLayer: string;
  formalMetricEligible: boolean;
  runId: string;
  split: "dev" | "test";
  goldFamily: "memory" | "skill" | "knowledge" | null;
  goldNeedTool: boolean;
}

export interface MetricSummary {
  total: number;
  infrastructureErrors: number;
  positiveCases: number;
  negativeCases: number;
  triggerRecall: number | null;
  effectiveCallRate: number | null;
  falseCallRate: number | null;
  firstActionAt1: number | null;
  conditionalToolAt1: number | null;
  argumentAccuracy: number | null;
  executionValidity: number | null;
  overcallRate: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function aggregateScores(records: ScoredRecord[]): MetricSummary {
  const valid = records.filter((record) => record.state !== "INFRASTRUCTURE_ERROR");
  const positives = valid.filter((record) => record.goldNeedTool);
  const negatives = valid.filter((record) => !record.goldNeedTool);
  const triggeredPositives = positives.filter((record) => record.triggerAttempted);
  return {
    total: records.length,
    infrastructureErrors: records.length - valid.length,
    positiveCases: positives.length,
    negativeCases: negatives.length,
    triggerRecall: ratio(positives.filter((record) => record.triggerAttempted).length, positives.length),
    effectiveCallRate: ratio(positives.filter((record) => record.effectiveCall).length, positives.length),
    falseCallRate: ratio(negatives.filter((record) => record.falseCall).length, negatives.length),
    firstActionAt1: ratio(positives.filter((record) => record.firstActionCorrect).length, positives.length),
    conditionalToolAt1: ratio(triggeredPositives.filter((record) => record.firstActionCorrect).length, triggeredPositives.length),
    argumentAccuracy: ratio(positives.filter((record) => record.argumentValid).length, positives.length),
    executionValidity: ratio(positives.filter((record) => record.executionValid).length, positives.length),
    overcallRate: ratio(valid.filter((record) => record.overcall).length, valid.length),
  };
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${String(error)}`);
    }
  });
}

function writeJsonl(path: string, values: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

export function scoreTraceRecords(traces: TraceRecord[]): ScoredRecord[] {
  const caseById = new Map(CASES.map((item) => [item.caseId, item]));
  const fixtureById = new Map(FIXTURES.map((item) => [item.fixtureId, item]));
  return traces.map((trace) => {
    const item = caseById.get(trace.caseId);
    if (!item) throw new Error(`unknown caseId ${trace.caseId}`);
    const fixture = fixtureById.get(item.fixtureIds[0]);
    if (!fixture) throw new Error(`${trace.caseId}: missing fixture ${item.fixtureIds[0]}`);
    const evaluation = trace.infrastructureError
      ? {
        caseId: item.caseId,
        state: "INFRASTRUCTURE_ERROR" as const,
        triggerAttempted: trace.attempts.length > 0,
        effectiveCall: false,
        falseCall: false,
        firstActionCorrect: false,
        conditionalToolCorrect: null,
        argumentValid: false,
        executionValid: false,
        overcall: false,
        observedTools: trace.attempts.map((attempt) => attempt.tool),
      }
      : evaluateToolPromptCase(item, fixture, trace.attempts);
    return {
      ...evaluation,
      evaluationLayer: trace.evaluationLayer ?? "unspecified",
      formalMetricEligible: trace.formalMetricEligible === true,
      runId: trace.runId,
      split: item.split,
      goldFamily: item.gold.family,
      goldNeedTool: item.gold.needTdaiTool,
    };
  });
}

function cliArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const tracePath = cliArgument("--traces");
  const outputPath = cliArgument("--out");
  if (!tracePath || !outputPath) {
    console.error("usage: tsx eval/tool-prompt-bench/score.ts --traces <trace.jsonl> --out <result.jsonl>");
    process.exitCode = 2;
  } else {
    const scored = scoreTraceRecords(readJsonl<TraceRecord>(resolve(tracePath)));
    writeJsonl(resolve(outputPath), scored);
    const summary = {
      evaluationLayers: [...new Set(scored.map((record) => record.evaluationLayer))],
      formalMetricEligible: scored.length > 0 && scored.every((record) => record.formalMetricEligible),
      overall: aggregateScores(scored),
      dev: aggregateScores(scored.filter((record) => record.split === "dev")),
      test: aggregateScores(scored.filter((record) => record.split === "test")),
      byFamily: Object.fromEntries(["memory", "skill", "knowledge"].map((family) => [
        family,
        aggregateScores(scored.filter((record) => record.goldFamily === family)),
      ])),
    };
    writeFileSync(`${resolve(outputPath)}.summary.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
  }
}
