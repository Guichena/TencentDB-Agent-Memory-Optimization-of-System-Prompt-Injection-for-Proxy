import { createHash } from "node:crypto";
import { loadFinal5Dataset, selectFinal5Cases, type Final5Dataset } from "./final5-formal-datasource.js";
import type { Final5CampaignPlan } from "./final5-campaign-builder.js";
import { withExecutionCheckpoint, type RecordedAttempt } from "./execution-checkpoint.js";

export interface Final5SlotResult {
  caseId: string; variant: "server_team" | "V4"; repeat: number;
  status: "completed" | "failed"; trace?: unknown; error?: string;
  attempts?: RecordedAttempt[]; resumed?: boolean;
}
export interface Final5ExecutionReceipt {
  executionContext?: { comparison: Record<string, unknown>; stage: Record<string, unknown> };
  schemaVersion: "task1.final5-execution-receipt.v1"; campaignId: string; datasetDigest: string;
  planSha256: string; slotCount: number; completed: number; failed: number;
  results: Final5SlotResult[]; receiptSha256: string;
}
export async function executeFinal5Campaign(input: {
  teamsRoot: string; plan: Final5CampaignPlan; concurrency?: number;
  dataset?: Final5Dataset;
  executionContext?: Final5ExecutionReceipt["executionContext"];
  checkpoint?: { directory: string; config: unknown; resume: boolean; maxRetries: number };
  executor: (slot: Final5CampaignPlan["slots"][number], row: ReturnType<typeof selectFinal5Cases>[number]) => Promise<unknown>;
}): Promise<Final5ExecutionReceipt> {
  const dataset = input.dataset ?? loadFinal5Dataset(input.teamsRoot);
  if (input.plan.datasetDigest !== dataset.sourceDigest) throw new Error("final5 dataset digest mismatch");
  const rows = selectFinal5Cases(dataset, input.plan.selectedCaseIds);
  const byId = new Map(rows.map((r) => [r.case_id, r]));
  const concurrency = input.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("final5 concurrency must be an integer from 1 to 10");
  const run = async (record?: Parameters<Parameters<typeof withExecutionCheckpoint>[1]>[0]) => {
    const results: Final5SlotResult[] = new Array(input.plan.slots.length);
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        const slot = input.plan.slots[index];
        if (!slot) return;
        const row = byId.get(slot.caseId);
        if (!row) throw new Error("Unknown selected case: " + slot.caseId);
        if (record) {
          const recorded = await record(slot, () => input.executor(slot, row));
          const last = recorded.attempts.at(-1)!;
          results[index] = { ...slot, status: last.status, trace: last.trace, error: last.error, resumed: recorded.resumed,
            attempts: recorded.attempts.map(({ trace, ...summary }) => ({ ...summary, evidenceDirectory: (trace as any)?.evidenceDirectory ?? (trace as any)?.outputDir })) };
        } else {
          try { results[index] = { ...slot, status: "completed", trace: await input.executor(slot, row) }; }
          catch (error) { results[index] = { ...slot, status: "failed", error: String(error) }; }
        }
      }
    };
    // Drain every worker before releasing the checkpoint lock on an I/O failure.
    const workers = await Promise.allSettled(Array.from({ length: concurrency }, worker));
    const failure = workers.find((item) => item.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const base = { schemaVersion: "task1.final5-execution-receipt.v1" as const, campaignId: input.plan.campaignId,
      datasetDigest: dataset.sourceDigest, planSha256: input.plan.planSha256, slotCount: results.length,
      completed: results.filter((r) => r.status === "completed").length, failed: results.filter((r) => r.status === "failed").length, results,
      ...(input.executionContext ? { executionContext: input.executionContext } : {}) };
    return { ...base, receiptSha256: createHash("sha256").update(JSON.stringify(base)).digest("hex") };
  };
  return input.checkpoint ? withExecutionCheckpoint(input.checkpoint, run) : run();
}
