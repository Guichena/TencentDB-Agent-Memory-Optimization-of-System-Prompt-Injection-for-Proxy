import { describe, expect, it } from "vitest";
import { buildFinal5MetricsReport, type Final5MetricEvidence } from "../../final5-metrics-report.js";
import type { Final5Dataset } from "../../final5-formal-datasource.js";
import { MEMORY_SEARCH_GOLD, MEMORY_SEARCH_SUCCESS_TRACE, SYNTHETIC_RUNTIME_CONTRACTS } from "../synthetic-fixtures.js";

const dataset: Final5Dataset = { schemaVersion: "task1.final5-datasource.v1", snapshotId: "final5", teams: ["team"], sourceDigest: "synthetic",
  counts: { teams: 1, cases: 2, pairs: 1, natural: 0, assets: 0 }, records: [true, false].map((positive, i) => ({
    case_id: String(i), team_id: "team", case: {}, evidence: {}, assets: {},
    gold: { should_call: positive, pair_id: "pair", expected_sequence: positive ? ["tdai_memory_search"] : [] },
  })) };
function evidence(variant: "server_team" | "V4", caseId: string, called: boolean): Final5MetricEvidence {
  const positive = caseId === "0";
  return { datasetDigest: "synthetic", client: "codex", variant, caseId, repeat: 1, inputComplete: true, intentComplete: true,
    scoring: { observation: { ...MEMORY_SEARCH_SUCCESS_TRACE, caseId, variantId: variant, attempts: called ? MEMORY_SEARCH_SUCCESS_TRACE.attempts : [] },
      gold: positive ? { ...MEMORY_SEARCH_GOLD, caseId } : { evaluationSchemaVersion: 2, caseId, expectation: "no-tool", attemptBudget: 0, allowedSequences: [] }, runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS } };
}
describe("Final5 metric evidence report", () => {
  it("does not turn absent evidence into zero false calls", () => {
    const report = buildFinal5MetricsReport(dataset, [], "codex");
    expect(report.coverage.pairedCases).toBe(0);
    expect(report.comparison.FCR_all.baseline.value).toBeNull();
    expect(report.status).toBe("incomplete-evidence");
  });
  it("computes all and conditional TSR with distinct denominators", () => {
    const rows = [evidence("server_team", "0", false), evidence("server_team", "1", true), evidence("V4", "0", true), evidence("V4", "1", false)];
    const report = buildFinal5MetricsReport(dataset, rows, "codex");
    expect(report.comparison.ECR.deltaPercentagePoints).toBe(100);
    expect(report.comparison.FCR_all.deltaPercentagePoints).toBe(-100);
    expect(report.comparison.TSR_all.baseline.value).toBe(0);
    expect(report.comparison.TSR_cond.baseline.value).toBeNull();
    expect(report.comparison.TSR_cond.final.value).toBe(1);
    expect(report.comparison.BSA.final.value).toBe(1);
    expect(report.metricSupport.usage.value).toBeNull();
  });
  it("requires intent coverage on both variants for paired Pair Exact", () => {
    const rows = [evidence("server_team", "0", true), evidence("server_team", "1", false), evidence("V4", "0", true), evidence("V4", "1", false)];
    rows[1].intentComplete = false;
    const report = buildFinal5MetricsReport(dataset, rows, "codex");
    expect(report.comparison.PairExact.baseline.denominator).toBe(0);
    expect(report.comparison.PairExact.final.denominator).toBe(0);
    expect(report.comparison.BSA.final.value).toBe(1);
  });
  it("counts wrong-family attempts as ECR but not TSR", () => {
    const rows = [evidence("server_team", "0", true), evidence("V4", "0", true)];
    rows[1].scoring.observation = { ...rows[1].scoring.observation, attempts: [{ attemptId: "wrong", executorBound: true, family: "skill", tool: "skill_search", endpoint: "/skill-bridge/v3/skill/search", method: "POST" }] };
    const report = buildFinal5MetricsReport(dataset, rows, "codex");
    expect(report.comparison.ECR.final.value).toBe(1);
    expect(report.comparison.TSR_all.final.value).toBe(0);
  });
  it("rejects best-of-N duplicate evidence and dataset mismatch", () => {
    const row = evidence("server_team", "0", true);
    expect(() => buildFinal5MetricsReport(dataset, [row, row], "codex")).toThrow(/Duplicate evidence/);
    expect(() => buildFinal5MetricsReport(dataset, [{ ...row, datasetDigest: "changed" }], "codex")).toThrow(/dataset/);
  });
});
