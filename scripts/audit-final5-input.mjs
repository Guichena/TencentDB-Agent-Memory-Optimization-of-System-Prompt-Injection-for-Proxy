import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { distribution } from './summarize-final5-complete.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => readFileSync(path, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
export function frames(raw) {
  try { return [JSON.parse(raw)]; } catch { /* Captured SSE, not a single JSON message. */ }
  return raw.replace(/\r\n/gu, '\n').split('\n\n').flatMap(frame => {
    const text = frame.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
    if (!text || text === '[DONE]') return [];
    return [JSON.parse(text)];
  });
}
export function wireUsage(raw, anthropic) {
  let usage = {}, messageId;
  for (const frame of frames(raw)) {
    messageId ??= frame.message?.id ?? frame.response?.id ?? frame.id;
    const update = anthropic ? frame.type === 'message_start' ? frame.message?.usage : frame.usage : frame.response?.usage ?? frame.usage;
    if (update) usage = { ...usage, ...update };
  }
  for (const value of [usage.input_tokens, usage.output_tokens]) assert.ok(Number.isSafeInteger(value) && value >= 0, 'Missing/invalid successful wire usage');
  const readCache = anthropic ? usage.cache_read_input_tokens : usage.input_tokens_details?.cached_tokens;
  const writeCache = anthropic ? usage.cache_creation_input_tokens : usage.input_tokens_details?.cache_write_tokens;
  assert.ok(Number.isSafeInteger(readCache) && Number.isSafeInteger(writeCache), 'Missing input-category coverage');
  const ordinary = anthropic ? usage.input_tokens : usage.input_tokens - readCache - writeCache;
  return { messageId: messageId ?? null, rawUsage: usage,
    providerTotalInputTokens: anthropic ? ordinary + readCache + writeCache : usage.input_tokens,
    ordinaryInputTokens: ordinary, cacheReadInputTokens: readCache, cacheWriteInputTokens: writeCache, outputTokens: usage.output_tokens };
}
const sum = xs => xs.reduce((a, b) => a + b, 0);
const fields = ['providerTotalInputTokens', 'ordinaryInputTokens', 'cacheReadInputTokens', 'cacheWriteInputTokens', 'outputTokens'];
const totals = requests => Object.fromEntries(fields.map(f => [f, sum(requests.map(x => x[f]))]));
const title = body => !body?.tools?.length && body?.messages?.length === 1 && body.messages[0].role === 'user'
  && JSON.stringify(body.messages[0].content).includes('Write the title in the predominant language of the session');

export function auditInput(root, reportsRoot) {
  const result = { policy: 'Independent wire recount, matched by capture request ID; last cumulative output, disjoint input categories; successful main-task requests only. First input means first successful task request, not static prompt length.', clients: {}, sources: [] };
  for (const client of ['codex', 'claude-code']) {
    const normalized = lines(join(reportsRoot, client, 'normalized-evidence.jsonl'));
    const derived = read(join(reportsRoot, client, 'comparison.json'));
    const variants = {};
    for (const variant of ['server_team', 'V4']) {
      const receipt = read(join(root, client, variant, 'execution.json'));
      const cases = [];
      const identities = new Set();
      for (const slot of receipt.results) {
        const path = join(slot.trace.evidenceDirectory ?? slot.trace.outputDir, 'http-events.jsonl');
        result.sources.push({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
        const events = lines(path), unique = new Map();
        for (const e of events) { const key = e.type + ':' + e.id; if (unique.has(key)) assert.deepEqual(unique.get(key), e); unique.set(key, e); }
        const starts = [...unique.values()].filter(x => x.type === 'provider.start');
        const ev = normalized.find(x => x.caseId === slot.caseId && x.variant === variant);
        assert.ok(ev && ev.providerUsageScope === 'task-only-excluding-cli-title');
        const requestMap = new Map([...ev.providerUsage.requests, ...ev.auxiliaryProviderUsage.requests].map(x => [x.requestId, x]));
        assert.equal(starts.length, requestMap.size);
        const task = [], auxiliary = [], failed = [];
        for (const start of starts) {
          const input = unique.get('input.start:' + start.parentId);
          assert.ok(input, 'Provider must be attributable to a captured CLI input');
          const isTitle = title(input.body);
          const end = unique.get('provider.end:' + start.id) ?? unique.get('provider.failed:' + start.id);
          const records = frames(end?.rawBody ?? '{}');
          const closed = client === 'claude-code' ? records.some(x => x.type === 'message_stop') : records.some(x => x.type === 'response.completed');
          const succeeded = end?.type === 'provider.end' && end.status >= 200 && end.status < 300 && closed && !records.some(x => x.error || x.type === 'error' || x.type === 'response.failed');
          const projected = requestMap.get(start.id);
          assert.equal(succeeded, projected.succeeded, 'Success classification differs');
          if (!succeeded) { failed.push({ requestId: start.id, title: isTitle, status: end?.status ?? null }); continue; }
          const wire = wireUsage(end.rawBody, client === 'claude-code');
          for (const f of fields) assert.equal(wire[f], projected.normalization.usage[f], 'Wire/normalizer mismatch: ' + f);
          if (wire.messageId) { assert.ok(!identities.has(wire.messageId), 'Repeated successful provider message ID'); identities.add(wire.messageId); }
          (isTitle ? auxiliary : task).push({ requestId: start.id, inputId: start.parentId, timestamp: start.timestamp, ...wire });
        }
        assert.equal(task.length, ev.providerUsage.requestCount);
        const total = totals(task);
        for (const f of fields) assert.equal(total[f], ev.providerUsage.fields[f].value);
        cases.push({ caseId: slot.caseId, shouldCall: ev.scoring.gold.expectation === 'tool', expected: ev.scoring.gold.allowedSequences.map(x => x.steps.map(s => s.tool)),
          observed: ev.scoring.observation.attempts.filter(x => x.executorBound).map(x => ({ tool: x.tool, status: x.status, arguments: x.arguments })),
          successfulTaskRequests: task.length, failedTaskRequests: failed.filter(x => !x.title).length,
          successfulAuxiliaryRequests: auxiliary.length, failedAuxiliaryRequests: failed.filter(x => x.title).length,
          firstSuccessfulInput: task[0]?.providerTotalInputTokens ?? null, taskTotals: total, auxiliaryTotals: totals(auxiliary), requests: task, auxiliaryRequests: auxiliary });
      }
      const taskTotal = Object.fromEntries(fields.map(f => [f, sum(cases.map(x => x.taskTotals[f]))]));
      for (const f of fields) assert.equal(taskTotal[f], derived.providerUsage[variant].fields[f].value);
      variants[variant] = { cases, taskTotals: taskTotal, auxiliaryTotals: Object.fromEntries(fields.map(f => [f, sum(cases.map(x => x.auxiliaryTotals[f]))])),
        firstSuccessfulInput: distribution(cases.map(x => x.firstSuccessfulInput)),
        episodeInput: distribution(cases.map(x => x.taskTotals.providerTotalInputTokens)),
        successfulTaskRequests: sum(cases.map(x => x.successfulTaskRequests)) };
    }
    const pairs = variants.server_team.cases.map(b => {
      const v = variants.V4.cases.find(x => x.caseId === b.caseId);
      return { caseId: b.caseId, shouldCall: b.shouldCall, baselineInput: b.taskTotals.providerTotalInputTokens, V4Input: v.taskTotals.providerTotalInputTokens,
        deltaInput: v.taskTotals.providerTotalInputTokens - b.taskTotals.providerTotalInputTokens,
        baselineFirstInput: b.firstSuccessfulInput, V4FirstInput: v.firstSuccessfulInput,
        baselineRequests: b.successfulTaskRequests, V4Requests: v.successfulTaskRequests,
        expected: b.expected, baselineTools: b.observed, V4Tools: v.observed };
    });
    result.clients[client] = { variants, pairs, pairedInputChanges: { lower: pairs.filter(x => x.deltaInput < 0).length, higher: pairs.filter(x => x.deltaInput > 0).length,
      equal: pairs.filter(x => x.deltaInput === 0).length, deltaMean: sum(pairs.map(x => x.deltaInput)) / pairs.length,
      largestIncreases: [...pairs].sort((a, b) => b.deltaInput - a.deltaInput).slice(0, 3).map(x => ({ caseId: x.caseId, deltaInput: x.deltaInput })) } };
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, reportsRoot, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: audit-final5-input.mjs <execution root> <corrected reports root> <output directory>');
  const data = auditInput(resolve(root), resolve(reportsRoot));
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'input-audit.json'), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(data.clients).map(([c, x]) => [c, { input: Object.fromEntries(Object.entries(x.variants).map(([v, y]) => [v, { total: y.taskTotals.providerTotalInputTokens, firstInput: y.firstSuccessfulInput, requests: y.successfulTaskRequests }])), paired: x.pairedInputChanges }]))));
}
