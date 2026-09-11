import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ATTEMPT_POLICY } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/attempt-policy.js';
import { inspectLock } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/process-lock.mjs';
import { extractStatic, systemText } from '../scripts/final5-static-input.mjs';
import { distribution } from '../scripts/summarize-final5-complete.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const lines = (path: string) => readFileSync(path, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));

function loadAudits(files: string[]) {
  if (files.length !== 2) throw Error('Usage: measure-static.ts <baseline retry.json> <V4 retry.json>');
  const audits = files.map(file => {
    const path = resolve(root, file);
    const { sha256, ...audit } = JSON.parse(readFileSync(path, 'utf8'));
    if (sha(JSON.stringify(audit)) !== sha256 || audit.policy !== ATTEMPT_POLICY) throw Error('Audit was modified or policy changed');
    const raw = readFileSync(join(dirname(path), 'selected-evidence.jsonl'), 'utf8');
    if (sha(raw) !== audit.evidenceSha256) throw Error('Selected evidence was modified');
    return audit;
  });
  const [left, right] = audits;
  if (left.variant !== 'server_team' || right.variant !== 'V4' || left.runName !== right.runName || left.client !== right.client || left.datasetDigest !== right.datasetDigest || !left.signature || left.signature !== right.signature) throw Error('Audits must share run/client/model/provider/runner and use baseline then V4 order');
  if (!/^[\w-]+$/.test(left.runName)) throw Error('Invalid run name');
  const run = join(root, 'runs', left.runName);
  const config = JSON.parse(readFileSync(join(run, 'evaluation.json'), 'utf8'));
  for (const audit of audits) {
    const execution = resolve(run, config.outputRoot);
    const current = readdirSync(execution).filter(dir => dir.startsWith('quick-') && existsSync(join(execution, dir, audit.client, audit.variant))).map(dir => join(execution, dir)).sort();
    if (JSON.stringify(current) !== JSON.stringify([...audit.sourceRuns].sort())) throw Error('New runs exist; re-audit before merging');
    if (current.some(dir => inspectLock(join(dir, 'controller.lock')).state !== 'missing')) throw Error('Execution is not stopped');
  }
  return { left, right, run };
}

function measureCapturedRequest(events: any[], client: 'codex' | 'claude-code', variant: 'server_team' | 'V4', encoding: { encode(text: string): { length: number } }) {
  const inputs = new Map(events.filter(x => x.type === 'input.start').map(x => [x.id, x]));
  const provider = events.find(x => x.type === 'provider.start' && inputs.has(x.parentId)
    && !(inputs.get(x.parentId).body?.messages?.length === 1 && !inputs.get(x.parentId).body?.tools?.length
      && JSON.stringify(inputs.get(x.parentId).body.messages[0].content).includes('Write the title in the predominant language of the session')));
  assert.ok(provider, 'Missing first task provider input');
  const incoming = inputs.get(provider.parentId);
  const actual = systemText(provider.body, client), original = systemText(incoming.body, client);
  const extracted = extractStatic(actual, variant);
  const normalize = (s: string) => s.replace(/\s+/gu, ' ').trim();
  assert.equal(normalize(extracted.remainder), normalize(original), 'Unaccounted prompt modification');
  return {
    providerRequestId: provider.id,
    T_static: encoding.encode(extracted.staticText).length,
    T_dynamic_listing: encoding.encode(extracted.assetText).length,
    T_prompt: encoding.encode(actual).length,
    chars: extracted.staticText.length,
    utf8Bytes: Buffer.byteLength(extracted.staticText),
    staticSha256: sha(extracted.staticText),
    dynamicSha256: sha(extracted.assetText),
    residualPreserved: true,
    sections: extracted.sections,
  };
}

function pairStaticMeasurements(baselineCases: any[], v4Cases: any[]) {
  const right = new Map(v4Cases.map(x => [x.caseId, x]));
  const pairs: { caseId: string; baseline: number; V4: number; savingPercent: number }[] = [];
  const dynamicMismatch: string[] = [];
  for (const b of baselineCases) {
    const v = right.get(b.caseId);
    if (!v) continue;
    if (b.dynamicSha256 !== v.dynamicSha256) { dynamicMismatch.push(b.caseId); continue; }
    pairs.push({ caseId: b.caseId, baseline: b.T_static, V4: v.T_static, savingPercent: 100 * (1 - v.T_static / b.T_static) });
  }
  const baselineSum = pairs.reduce((n, p) => n + p.baseline, 0);
  const v4Sum = pairs.reduce((n, p) => n + p.V4, 0);
  return { pairs, dynamicMismatch, staticSavingPercent: pairs.length && baselineSum > 0 ? 100 * (1 - v4Sum / baselineSum) : null };
}

function measureRows(rows: any[], client: 'codex' | 'claude-code', variant: 'server_team' | 'V4', encoding: { encode(text: string): { length: number } }) {
  const cases: any[] = [];
  const missing: { caseId: string; reason: string }[] = [];
  for (const row of rows) {
    if (!row.scorable) continue;
    try {
      if (!row.directory) throw Error('missing-evidence-directory');
      const path = join(row.directory, 'http-events.jsonl');
      if (!existsSync(path)) throw Error('Missing http-events.jsonl');
      cases.push({ caseId: row.caseId, path, sourceSha256: sha(readFileSync(path)), ...measureCapturedRequest(lines(path), client, variant, encoding) });
    } catch (error) {
      missing.push({ caseId: row.caseId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    cases,
    missing,
    T_static: distribution(cases.map(row => row.T_static)),
    T_dynamic_listing: distribution(cases.map(row => row.T_dynamic_listing)),
    T_prompt: distribution(cases.map(row => row.T_prompt)),
  };
}

const files = process.argv.slice(2);
const { left, right, run } = loadAudits(files);
const tokenizerDirectory = join(root, 'evaluation', 'MemoryProxy');
const require = createRequire(join(tokenizerDirectory, 'package.json'));
const { get_encoding } = require('tiktoken');
const version = JSON.parse(readFileSync(join(tokenizerDirectory, 'node_modules/tiktoken/package.json'), 'utf8')).version;
const encoding = get_encoding('o200k_base');
try {
  const variants = {
    server_team: measureRows(left.rows, left.client, 'server_team', encoding),
    V4: measureRows(right.rows, right.client, 'V4', encoding),
  };
  const paired = pairStaticMeasurements(variants.server_team.cases, variants.V4.cases);
  const output = join(run, 'reports', 'static-' + Date.now() + '-' + randomUUID());
  mkdirSync(output, { recursive: true });
  const ledger = {
    schemaVersion: 'final5.first-static-input.v1',
    tokenizer: { name: 'o200k_base', library: 'tiktoken', version },
    policy: 'Linux audit-selected earliest scorable attempt. One first task request per case. Complete injected static tool instructions including shared protocol, routing, listing wrapper, runtime-bound URLs/headers; exclude skill entries and session identity block. Encode the complete extracted text once in provider order, joined by two newlines; never add block counts. Outer tdai transport wrapper is excluded. This is rendered instruction length, not billed token cost. Savings use same-case identical-dynamic-listing pairs only. Unmeasurable cases are listed as missing, not zero.',
    client: left.client,
    runName: left.runName,
    audits: files,
    variants,
    pairs: paired.pairs,
    dynamicMismatch: paired.dynamicMismatch,
    staticSavingPercent: paired.staticSavingPercent,
    coverage: {
      selectedBaseline: left.rows.filter((row: any) => row.scorable).length,
      selectedFinal: right.rows.filter((row: any) => row.scorable).length,
      measuredBaseline: variants.server_team.cases.length,
      measuredFinal: variants.V4.cases.length,
      paired: paired.pairs.length,
      missingBaseline: variants.server_team.missing.map((row: { caseId: string }) => row.caseId),
      missingFinal: variants.V4.missing.map((row: { caseId: string }) => row.caseId),
      dynamicMismatch: paired.dynamicMismatch,
    },
  };
  writeFileSync(join(output, 'static-input.json'), JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, client: left.client, paired: paired.pairs.length, staticSavingPercent: paired.staticSavingPercent, coverage: ledger.coverage }));
} finally { encoding.free(); }
