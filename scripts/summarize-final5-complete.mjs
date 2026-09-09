import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function distribution(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const q = p => a.length ? a[Math.max(0, Math.ceil(p * a.length) - 1)] : null;
  return { count: a.length, totalCount: values.length, sum: a.length ? a.reduce((x, y) => x + y, 0) : null,
    mean: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, p50: q(.5), p95: q(.95), min: a[0] ?? null, max: a.at(-1) ?? null };
}
const ratio = (n, d) => ({ numerator: n, denominator: d, value: d ? n / d : null });
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const lines = p => readFileSync(p, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = x => x === null || x === undefined ? 'NA' : Number.isInteger(x) ? String(x) : x.toFixed(3);

export function reportDirectory(root, client, reportsRoot) {
  return reportsRoot ? join(reportsRoot, client) : join(root, client, 'report');
}
export function summarize(root, reportsRoot, staticLedger) {
  const output = { schemaVersion: 'final5.complete-summary.v1', sources: [], clients: {},
    policy: { usage: 'Successful task provider requests only; title traffic is separate and failed requests remain diagnostics. No CLI/provider double counting.',
      quantiles: 'Nearest-rank quantiles over available observations.', scheduling: 'Use the execution receipts for actual concurrency and stage scheduling.',
      limitations: 'Results cover only the selected cases. Timing and cache differences are descriptive. No weighted overall score.' } };
  for (const client of ['codex', 'claude-code']) {
    const base = join(root, client);
    const reportDir = reportDirectory(root, client, reportsRoot);
    const reportPath = join(reportDir, 'comparison.json');
    const report = read(reportPath);
    const evidence = lines(join(reportDir, 'normalized-evidence.jsonl'));
    if (report.providerUsageScope !== 'task-only-excluding-cli-title') throw new Error('Stale or unspecified usage scope; recollect raw evidence into an explicit reports root');
    if (report.status !== 'behavior-scored' || report.coverage.pairedCases !== report.coverage.plannedCasesPerVariant) throw new Error('Incomplete paired evidence');
    const c = { coverage: report.coverage, comparison: report.comparison, binaryStatistics: report.binaryStatistics, variants: {}, unavailable: {
      PairExact: 'Unbound malformed CLI intentions are not fully observed.',
      malformedIntentRate: 'HTTP-only zero does not prove absence of malformed intentions.',
      T_static: 'Static text boundary and uniform tokenizer ledger were not captured.',
      T_dynamic: 'Dynamic text boundary and uniform tokenizer ledger were not captured.',
      T_prompt: 'Complete prompt tokenizer ledger not connected; provider input is not this metric.',
      staticSaving: 'Requires T_static for both variants.',
      bindingSlotAccuracy: 'Independent slot-level alignment/denominator not emitted by frozen scorer; Complete does validate bindings.',
      bindingCaseAccuracy: 'Independent binding-case diagnostic not emitted; do not substitute complete-chain success.',
      stepCoverage: 'Frozen scorer does not emit correctly matched prefix K; not equivalent to call count divided by Gold length.',
      prerequisiteViolation: 'Separate prerequisite-path diagnostic not emitted; wrong_terminal is not an equivalent count.',
      targetHit: 'Stable response target identity mapping not connected.',
      targetAwareChain: 'Requires response target identity mapping.',
      naturalCodingIntrusion: 'No independent natural-coding-negative analysis is emitted by this summary.',
      siblingConfusion: 'Frozen sibling-group mapping unavailable; raw expected/observed tool matrix included.',
      TTFT: 'First stdout is available, but provider first-content timing is not.',
      currencyCost: 'No frozen actual provider/model price table; tokens are reported without inventing prices.',
    } };
    for (const variant of ['server_team', 'V4']) {
      const receiptPath = join(base, variant, 'execution.json');
      const receipt = read(receiptPath);
      output.sources.push(...[reportPath, receiptPath, join(reportDir, 'normalized-evidence.jsonl')].map(path => ({ path: resolve(path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })));
      const ev = evidence.filter(x => x.variant === variant);
      const scores = report.caseScores.filter(x => x.variant === variant);
      const positive = scores.filter(x => x.shouldCall);
      const behavior = report.paired[variant === 'server_team' ? 'baseline' : 'final'];
      const usage = report.providerUsage[variant];
      const cases = ev.map(e => {
        const requests = e.providerUsage.requests.filter(x => x.succeeded);
        const tokens = Object.fromEntries(Object.keys(usage.fields).map(field => {
          const values = requests.map(r => r.normalization?.ok ? r.normalization.usage?.[field] : null);
          return [field, values.length && values.every(Number.isFinite) ? sum(values) : null];
        }));
        tokens.totalInputPlusOutput = tokens.providerTotalInputTokens !== null && tokens.outputTokens !== null ? tokens.providerTotalInputTokens + tokens.outputTokens : null;
        const r = receipt.results.find(x => x.caseId === e.caseId);
        const t = r.trace.timings, s = r.trace.slotTimings;
        const elapsed = { clientMs: t?.clientMs ?? null, prepareMs: s ? s.workspaceMs + t.prepareMs : t?.prepareMs ?? null,
          cleanupMs: s?.cleanupMs ?? t?.cleanupMs ?? null, totalMs: s?.totalMs ?? t?.totalMs ?? null,
          firstOutputMs: t?.firstOutputMs ?? null };
        return { caseId: e.caseId, successfulRequests: requests.length, excludedFailedRequests: e.providerUsage.requests.filter(x => !x.succeeded).length,
          tokens, timings: elapsed, score: scores.find(x => x.caseId === e.caseId).score };
      });
      const confusion = { family: {}, tool: {} };
      for (const e of ev.filter(x => x.scoring.gold.expectation === 'tool')) {
        const first = e.scoring.observation.attempts.find(x => x.executorBound);
        for (const field of ['family', 'tool']) {
          const expected = [...new Set(e.scoring.gold.allowedSequences.map(x => x.steps[0][field]))].sort().join('|');
          const key = expected + ' -> ' + (first?.[field] ?? 'NO_CALL');
          confusion[field][key] = (confusion[field][key] ?? 0) + 1;
        }
      }
      const reached = positive.filter(x => x.score.completeChainSuccess);
      const after = reached.filter(x => x.score.behaviorValidTerminalAttemptIndex !== null && x.score.observedAttemptCount > x.score.behaviorValidTerminalAttemptIndex + 1);
      const chain = { ...behavior.chainDetails, malformedFalseIntentRate: { value: null, reason: c.unavailable.malformedIntentRate } };
      c.variants[variant] = { behavior: { ...behavior, chainDetails: chain,
        allNoCall: { ...behavior.allNoCall, malformedIntentRate: { value: null, reason: c.unavailable.malformedIntentRate } },
        pairNoCall: { ...behavior.pairNoCall, malformedIntentRate: { value: null, reason: c.unavailable.malformedIntentRate } } },
        postTerminalRate: { ...ratio(after.length, reached.length), caseIds: after.map(x => x.caseId), denominatorCaseIds: reached.map(x => x.caseId) },
        confusion, toolAttempts: { all: distribution(scores.map(x => x.score.observedAttemptCount)), positives: distribution(positive.map(x => x.score.observedAttemptCount)), negatives: distribution(scores.filter(x => !x.shouldCall).map(x => x.score.observedAttemptCount)) },
        provider: { successfulRequests: usage.requestCount, observedRequests: usage.observedRequestCount, excludedFailedRequests: usage.failedRequestCount,
          fields: usage.fields, cacheReadRatio: usage.cacheReadRatio,
          caseTokens: Object.fromEntries(Object.keys(cases[0].tokens).map(field => [field, distribution(cases.map(x => x.tokens[field]))])),
          requestDurationMs: distribution(usage.requests.filter(x => x.succeeded).map(x => x.durationMs)),
          requestsPerCase: distribution(cases.map(x => x.successfulRequests)) },
        timings: Object.fromEntries(Object.keys(cases[0].timings).map(field => [field, distribution(cases.map(x => x.timings[field]))])), cases };
    }
    c.tokenChanges = Object.fromEntries(Object.keys(c.variants.server_team.provider.caseTokens).map(field => {
      const b = c.variants.server_team.provider.caseTokens[field], v = c.variants.V4.provider.caseTokens[field];
      const complete = b.count === b.totalCount && v.count === v.totalCount;
      return [field, { baseline: complete ? b.sum : null, V4: complete ? v.sum : null, savingPercent: complete && b.sum > 0 ? 100 * (1 - v.sum / b.sum) : null }];
    }));
    if (staticLedger) {
      c.staticInput = staticLedger.clients[client];
      for (const variant of ['server_team', 'V4']) {
        const expected = new Set(c.variants[variant].cases.map(x => x.caseId));
        const actual = c.staticInput.variants[variant].cases;
        if (actual.length !== expected.size || actual.some(x => !expected.has(x.caseId) || !x.residualPreserved)) throw new Error('Static ledger case coverage mismatch');
      }
      c.staticInputPolicy = staticLedger.policy;
      c.tokenizer = staticLedger.tokenizer;
      delete c.unavailable.T_static;
      delete c.unavailable.T_prompt;
      delete c.unavailable.staticSaving;
      c.unavailable.T_dynamic = 'Frozen Skill listing text is measured separately; no claim of a complete dynamic-asset ledger.';
    }
    output.clients[client] = c;
  }
  return output;
}

export function render(data) {
  const out = ['# Final5 Complete Metrics', '', data.policy.usage, '', data.policy.quantiles, '', data.policy.scheduling, '', data.policy.limitations];
  for (const [client, c] of Object.entries(data.clients)) {
    const b = c.variants.server_team, v = c.variants.V4;
    out.push('', '## ' + client, '', `${c.coverage.pairedCases} cases paired across variants. Rates below are fractions, not percentages.`, '', '| Behavior | Baseline | V4 |', '|---|---:|---:|');
    const rate = x => x?.value === null ? 'NA' : `${fmt(x.value)} (${x.numerator ?? x.sum}/${x.denominator})`;
    for (const [name, x] of Object.entries(c.comparison)) out.push(`| ${name} | ${rate(x.baseline)} | ${rate(x.final)} |`);
    for (const name of ['terminalSelectionRate', 'conditionalTerminalAccuracy', 'runtimeAcceptedChainRate', 'falseCallAcceptedRate', 'toolSpl', 'shortestExactRate']) out.push(`| ${name} | ${rate(b.behavior.chainDetails[name])} | ${rate(v.behavior.chainDetails[name])} |`);
    out.push(`| postTerminalRate | ${rate(b.postTerminalRate)} | ${rate(v.postTerminalRate)} |`);
    const dist = x => [x.mean, x.p50, x.p95].map(fmt).join(' / ');
    if (c.staticInput) {
      out.push('', '### Static Instruction Input (Primary)', '', c.staticInputPolicy, '', '| First-request text | Baseline mean / P50 / P95 | V4 mean / P50 / P95 |', '|---|---:|---:|');
      for (const name of ['T_static', 'T_dynamic_listing', 'T_prompt']) out.push(`| ${name} | ${dist(c.staticInput.variants.server_team[name])} | ${dist(c.staticInput.variants.V4[name])} |`);
      out.push('', `Static instruction saving: ${fmt(c.staticInput.staticSavingPercent)}%. Uniform tokenizer: ${c.tokenizer.name}, ${c.tokenizer.library} ${c.tokenizer.version}.`, '', 'T_prompt is system/developer text only, excluding native tool schemas, user messages and provider framing. It is not billed input usage.');
    }
    out.push('', '### Runtime Usage Appendix (Not Improvement Evidence)', '', 'Episode totals mix tool paths, repeated context and local execution. Do not use them to evaluate instruction compression.', '', '| Input field | Baseline total | V4 total | Saving % |', '|---|---:|---:|---:|');
    const inputFields = ['providerTotalInputTokens', 'ordinaryInputTokens', 'cacheReadInputTokens', 'cacheWriteInputTokens'];
    for (const name of inputFields) { const x = c.tokenChanges[name]; out.push(`| ${name} | ${fmt(x.baseline)} | ${fmt(x.V4)} | ${fmt(x.savingPercent)} |`); }
    out.push('', '| Usage | Baseline | V4 |', '|---|---:|---:|');
    for (const name of ['successfulRequests', 'excludedFailedRequests', 'cacheReadRatio']) out.push(`| ${name} | ${fmt(b.provider[name])} | ${fmt(v.provider[name])} |`);
    out.push('', '| Per-case tokens | Baseline mean / P50 / P95 | V4 mean / P50 / P95 |', '|---|---:|---:|');
    for (const name of inputFields) out.push(`| ${name} | ${dist(b.provider.caseTokens[name])} | ${dist(v.provider.caseTokens[name])} |`);
    out.push('', '| Timing (ms) | Baseline mean / P50 / P95 | V4 mean / P50 / P95 |', '|---|---:|---:|');
    for (const name of Object.keys(b.timings)) out.push(`| ${name} | ${dist(b.timings[name])} | ${dist(v.timings[name])} |`);
    out.push(`| Successful provider request duration | ${dist(b.provider.requestDurationMs)} | ${dist(v.provider.requestDurationMs)} |`, '', '| Tool attempts per case | Baseline mean / P50 / P95 | V4 mean / P50 / P95 |', '|---|---:|---:|');
    for (const name of Object.keys(b.toolAttempts)) out.push(`| ${name} | ${dist(b.toolAttempts[name])} | ${dist(v.toolAttempts[name])} |`);
    out.push('', '### Supplementary Tokens (Not Headline Results)', '', '| Field | Baseline total | V4 total |', '|---|---:|---:|');
    for (const name of ['outputTokens', 'reasoningOrThinkingTokens', 'totalInputPlusOutput']) { const x = c.tokenChanges[name]; out.push(`| ${name} | ${fmt(x.baseline)} | ${fmt(x.V4)} |`); }
    out.push('', '### Diagnostic Counts', '', '```json', JSON.stringify({ baseline: { confusion: b.confusion, failures: b.behavior.chainDetails.failureLayerCounts }, V4: { confusion: v.confusion, failures: v.behavior.chainDetails.failureLayerCounts } }, null, 2), '```', '', '### Unavailable Metrics', '');
    for (const [name, reason] of Object.entries(c.unavailable)) out.push('- ' + name + ': NA. ' + reason);
  }
  return out.join('\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, output, reportsRoot, staticLedgerPath] = process.argv.slice(2);
  if (!root || !output) throw new Error('Usage: node scripts/summarize-final5-complete.mjs <execution root> <new output directory> [reports root] [static ledger.json]');
  const data = summarize(resolve(root), reportsRoot && resolve(reportsRoot), staticLedgerPath && read(staticLedgerPath));
  mkdirSync(output, { recursive: true });
  for (const [name, text] of [['comparison.json', JSON.stringify(data, null, 2) + '\n'], ['report.md', render(data)]]) writeFileSync(join(output, name), text, { flag: 'wx' });
  console.log(JSON.stringify({ clients: Object.keys(data.clients), output: resolve(output) }));
}
