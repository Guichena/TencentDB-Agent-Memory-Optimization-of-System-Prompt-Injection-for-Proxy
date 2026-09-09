import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executionHash } from "./execution-checkpoint.js";
import type { Final5ExecutionReceipt } from "./final5-formal-execution.js";

export function verifyStageReceipt(receipt: Final5ExecutionReceipt, variant: "server_team" | "V4") {
  const { receiptSha256, ...body } = receipt;
  if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== receiptSha256) throw new Error("Receipt checksum mismatch");
  if (!receipt.executionContext?.comparison || receipt.executionContext.stage.variant !== variant) throw new Error("Missing or wrong stage metadata");
  if (receipt.executionContext.stage.profile !== (variant === "V4" ? "v4-compact" : "legacy")) throw new Error("Wrong profile");
  if (receipt.slotCount !== receipt.results.length || receipt.completed !== receipt.results.filter((r) => r.status === "completed").length || receipt.failed !== receipt.results.filter((r) => r.status === "failed").length) throw new Error("Receipt counts mismatch");
  const keys = receipt.results.map((row) => JSON.stringify([row.caseId, row.repeat]));
  if (new Set(keys).size !== keys.length || receipt.results.some((r) => r.variant !== variant || !["completed", "failed"].includes(r.status))) throw new Error("Invalid stage slots");
}

/** Pair execution evidence only. A completed process is not a correct answer. */
export function mergeStageReceipts(baseline: Final5ExecutionReceipt, candidate: Final5ExecutionReceipt) {
  verifyStageReceipt(baseline, "server_team");
  verifyStageReceipt(candidate, "V4");
  if (baseline.datasetDigest !== candidate.datasetDigest || executionHash(baseline.executionContext!.comparison) !== executionHash(candidate.executionContext!.comparison)) throw new Error("Incompatible experiment conditions; do not merge");
  const key = (row: { caseId: string; repeat: number }) => JSON.stringify([row.caseId, row.repeat]);
  const candidates = new Map(candidate.results.map((row) => [key(row), row]));
  if (baseline.results.length !== candidates.size || baseline.results.some((row) => !candidates.has(key(row)))) throw new Error("Unpaired slots");
  const pairs = baseline.results.map((row) => {
    const other = candidates.get(key(row))!;
    return { caseId: row.caseId, repeat: row.repeat, baseline: row, candidate: other, bothCompleted: row.status === "completed" && other.status === "completed" };
  });
  return { schemaVersion: "task1.paired-execution.v1", comparison: baseline.executionContext!.comparison,
    sources: { baseline: baseline.receiptSha256, candidate: candidate.receiptSha256 },
    pairs, pairedCount: pairs.length, bothCompleted: pairs.filter((pair) => pair.bothCompleted).length,
    scoring: "not-scored", note: "Execution completion is not task correctness. Failed pairs remain visible." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseline, candidate, output] = process.argv.slice(2);
  if (!baseline || !candidate || !output) throw new Error("Usage: merge-stage-receipts.ts baseline.json v4.json output.json");
  const merged = mergeStageReceipts(JSON.parse(readFileSync(baseline, "utf8")), JSON.parse(readFileSync(candidate, "utf8")));
  writeFileSync(output, JSON.stringify(merged, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ pairedCount: merged.pairedCount, bothCompleted: merged.bothCompleted, output }));
}
