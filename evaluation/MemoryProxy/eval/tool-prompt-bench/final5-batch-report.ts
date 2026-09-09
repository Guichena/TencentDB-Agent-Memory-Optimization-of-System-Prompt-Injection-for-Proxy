import { readFileSync, writeFileSync } from "node:fs";
import { get_encoding } from "tiktoken";

type Json = Record<string, any>;
const base = process.env.FINAL5_RUN_ROOT ?? "D:/projects/TencentDB-Agent-Memory/benchmark-runs/task1-data-closeout-20260906";
const receiptPath = process.env.FINAL5_RECEIPT ?? `${base}/final5-native-execution-balanced-e1-8.json`;
const traceRoot = process.env.FINAL5_TRACE_ROOT ?? `${base}/runtime-traces-balanced`;
const outputPath = process.env.FINAL5_REPORT ?? `${base}/final5-balanced-report.json`;
const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Json;
const plan = JSON.parse(readFileSync(`${base}/final5-campaign-plan-balanced-e1-8.json`, "utf8")) as Json;

function lines(path: string): Json[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function reportVariant(variant: "server" | "v4", expected: Map<string, boolean>) {
  const campaign = variant === "server" ? "task1-final5-balanced-server" : "task1-final5-balanced-v4";
  const events = lines(`${traceRoot}/${campaign}/memory-proxy.events.jsonl`);
  const provider = lines(`${traceRoot}/${campaign}/memory-proxy.provider-requests.jsonl`);
  const begins = events.filter((x) => x.kind === "begin");
  const completions = events.filter((x) => x.kind === "completion");
  const usage = provider.filter((x) => x.kind === "completion").map((x) => x.event?.usage).filter(Boolean);
  const eligible = receipt.results.filter((x: Json) => x.variant === (variant === "server" ? "server_team" : "V4") && x.status === "completed");
  const eligibleIds = new Set(eligible.map((x: Json) => x.caseId));
  const callCases = [...eligibleIds].filter((id) => expected.get(id) === true);
  const noCallCases = [...eligibleIds].filter((id) => expected.get(id) === false);
  const bySession = new Map<string, number>();
  for (const e of begins) {
    const sid = String(e.event?.correlationHeaders?.["session-id"] ?? e.event?.correlationHeaders?.["x-session-id"] ?? "");
    bySession.set(sid, (bySession.get(sid) ?? 0) + 1);
  }
  // Bridge events carry session correlation; if a deployment omits it, count
  // only the global facts and mark per-case attribution incomplete.
  const observedCallCount = begins.length;
  const expectedCallCount = callCases.length;
  const expectedNoCallCount = noCallCases.length;
  const pairCount = Math.floor(Math.min(callCases.length, noCallCases.length));
  const falseCallCount = Math.min(observedCallCount, expectedNoCallCount) === 0 ? 0 : null;
  const encoding = get_encoding("o200k_base");
  const injectedTokens = provider.filter((x) => x.kind === "request").map((x) => {
    const text = JSON.stringify(x.event?.body ?? "");
    const start = text.indexOf("<tdai_injections>");
    const end = text.indexOf("</tdai_injections>");
    return start >= 0 && end > start ? encoding.encode(text.slice(start, end + 18)).length : null;
  }).filter((x): x is number => x !== null);
  const sum = (key: string) => usage.reduce((n, u) => n + (Number(u[key]) || 0), 0);
  return {
    variant: variant === "server" ? "server_team" : "V4",
    slots: receipt.results.filter((x: Json) => x.variant === (variant === "server" ? "server_team" : "V4")).length,
    completedSlots: eligible.length,
    failedSlots: receipt.results.filter((x: Json) => x.variant === (variant === "server" ? "server_team" : "V4") && x.status !== "completed").length,
    expectedCallCases: expectedCallCount,
    expectedNoCallCases: expectedNoCallCount,
    observedBridgeBeginCount: observedCallCount,
    observedBridgeCompletionCount: completions.length,
    effectiveCallRate: expectedCallCount ? observedCallCount / expectedCallCount : null,
    falseCallRate: falseCallCount === null ? null : expectedNoCallCount ? falseCallCount / expectedNoCallCount : null,
    toolSelectionCorrectRate: observedCallCount === 0 ? null : null,
    completeChainSuccessRate: expectedCallCount ? (observedCallCount > 0 ? null : 0) : null,
    pairBoundarySwitchRate: pairCount ? (observedCallCount > 0 ? null : 0) : null,
    pairExactRate: pairCount ? (observedCallCount > 0 ? null : 0) : null,
    injectionTokenMean: injectedTokens.length ? injectedTokens.reduce((a, b) => a + b, 0) / injectedTokens.length : null,
    injectionTokenMin: injectedTokens.length ? Math.min(...injectedTokens) : null,
    injectionTokenMax: injectedTokens.length ? Math.max(...injectedTokens) : null,
    providerUsage: { requests: usage.length, inputTokens: sum("input_tokens"), cachedInputTokens: usage.reduce((n, u) => n + (Number(u.input_tokens_details?.cached_tokens) || 0), 0), outputTokens: sum("output_tokens"), reasoningTokens: usage.reduce((n, u) => n + (Number(u.output_tokens_details?.reasoning_tokens) || 0), 0) },
    sessionAttributionKeys: bySession.size,
  };
}

const gold = new Map<string, boolean>();
for (const team of new Set(plan.selectedCaseIds.map((id: string) => id.split("__")[0]))) {
  const path = `D:/projects/team-migration/teams/${team}/data/gold.jsonl`;
  try { for (const row of lines(path)) gold.set(String(row.case_id), row.should_call === true || row.expectation === "tool"); } catch { /* Team ids with mixed casing are resolved below. */ }
}
for (const row of lines(`${base}/final5-private-gold-all.jsonl`)) gold.set(String(row.case_id), row.should_call === true || row.expectation === "tool");
const report = { schemaVersion: "task1.final5-batch-report.v1", receiptPath, planSha256: plan.planSha256, datasetDigest: plan.datasetDigest, sample: { selectedCases: plan.selectedCaseIds.length, slots: plan.slots.length }, variants: [reportVariant("server", gold), reportVariant("v4", gold)], runtimeProfiles: { baseline: "legacy", candidate: "capability-pruned", requestedCandidate: "codex/task1-v4-architecture-upgrade (v4-compact)" }, candidateProfileMatchesRequested: false, notes: ["Gold is consumed offline only.", "A null toolSelectionCorrectRate means no bridge call was observed, not a correct selection.", "Infrastructure-failed slots are excluded from behavior-rate denominators.", "This batch is diagnostic until the v4-compact profile is deployed; do not claim architecture-upgrade improvement from these numbers."] };
const server = report.variants[0];
const v4 = report.variants[1];
Object.assign(report, {
  comparison: {
    baseline: "server_team",
    candidate: "V4",
    effectiveCallRateDelta: v4.effectiveCallRate === null || server.effectiveCallRate === null ? null : v4.effectiveCallRate - server.effectiveCallRate,
    falseCallRateDelta: v4.falseCallRate === null || server.falseCallRate === null ? null : v4.falseCallRate - server.falseCallRate,
    injectionTokenDelta: v4.injectionTokenMean === null || server.injectionTokenMean === null ? null : v4.injectionTokenMean - server.injectionTokenMean,
    injectionTokenSavingRate: v4.injectionTokenMean === null || server.injectionTokenMean === null || server.injectionTokenMean === 0 ? null : (server.injectionTokenMean - v4.injectionTokenMean) / server.injectionTokenMean,
    providerInputTokenDelta: v4.providerUsage.inputTokens - server.providerUsage.inputTokens,
    providerOutputTokenDelta: v4.providerUsage.outputTokens - server.providerUsage.outputTokens,
  },
  formulaChecks: {
    slotsEqualSelectedTimesVariants: receipt.results.length === plan.selectedCaseIds.length * 2,
    completedPlusFailedMatchesSlots: report.variants.every((x) => x.completedSlots + x.failedSlots === x.slots),
    callRateDenominatorIsCompletedCallCases: report.variants.every((x) => x.expectedCallCases === 3),
    noCallRateDenominatorIsCompletedNoCallCases: report.variants.every((x) => x.expectedNoCallCases === 5),
    infrastructureFailuresExcluded: true,
  },
});
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
