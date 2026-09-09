import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeFinal5MetricsReport } from "../../final5-metrics-report.js";

it("writes independently parseable JSONL records and refuses to overwrite a report", () => {
  const directory = mkdtempSync(join(tmpdir(), "final5-report-"));
  try {
    const report = { caseScores: [{ caseId: "first", value: null }, { caseId: "second", value: 0 }], metricSupport: {} };
    writeFinal5MetricsReport(report as never, directory);
    const raw = readFileSync(join(directory, "case-scores.jsonl"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.trim().split("\n").map(line => JSON.parse(line))).toEqual(report.caseScores);
    expect(JSON.parse(readFileSync(join(directory, "comparison.json"), "utf8"))).toEqual(report);
    expect(() => writeFinal5MetricsReport(report as never, directory)).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
