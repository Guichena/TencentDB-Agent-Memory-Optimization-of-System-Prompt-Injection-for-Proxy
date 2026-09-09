import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { extractStatic, systemText } from './final5-static-input.mjs';
import { distribution } from './summarize-final5-complete.mjs';

const root = path.resolve('runs/final5-test1k-20260909-consolidated');
const require = createRequire(path.resolve('evaluation/MemoryProxy/package.json'));
const { get_encoding } = require('tiktoken');
const encoding = get_encoding('o200k_base');
const hash = text => createHash('sha256').update(text).digest('hex');
const jobs = [];
for (const client of ['codex', 'claude-code']) for (const variant of ['baseline', 'V4']) {
  const rows = fs.readFileSync(path.join(root,variant,client,'case-index.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const row of rows) jobs.push({client,variant,...row});
}
const rows = [], errors = [];
let cursor = 0, finished = 0;
if(process.argv.includes('--summarize-existing')){
  rows.push(...fs.readFileSync(path.join(root,'static-input-cases.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
  assert.equal(rows.length,jobs.length,'Only resume a fully measured ledger');
  cursor=jobs.length;
}
try {
  await Promise.all(Array.from({length: 12}, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const checkpoint = JSON.parse(await readFile(job.checkpoint,'utf8'));
        const attempt = checkpoint.attempts.find(a=>a.status==='completed' && a.startedAt===job.startedAt);
        assert.ok(attempt,'Selected attempt not found');
        const directory = attempt.evidenceDirectory ?? attempt.trace?.evidenceDirectory ?? attempt.trace?.outputDir;
        const file = path.join(directory,'http-events.jsonl');
        const text = await readFile(file,'utf8');
        const events = text.split(/\r?\n/u).filter(Boolean).map(JSON.parse);
        const inputs = new Map(events.filter(e=>e.type==='input.start').map(e=>[e.id,e]));
        const provider = events.find(e=>e.type==='provider.start' && inputs.has(e.parentId)
          && !(inputs.get(e.parentId).body?.messages?.length===1 && !inputs.get(e.parentId).body?.tools?.length
            && JSON.stringify(inputs.get(e.parentId).body.messages[0].content).includes('Write the title in the predominant language of the session')));
        assert.ok(provider,'Missing first task provider input');
        const actual = systemText(provider.body,job.client), original = systemText(inputs.get(provider.parentId).body,job.client);
        const extracted = extractStatic(actual,job.variant==='baseline'?'server_team':'V4');
        const normalize = s=>s.replace(/\s+/gu,' ').trim();
        assert.equal(normalize(extracted.remainder),normalize(original),'Unaccounted prompt modification');
        rows.push({client:job.client,variant:job.variant,caseId:checkpoint.key.caseId,checkpoint:job.checkpoint,
          source:file,sourceSha256:hash(text),providerRequestId:provider.id,
          T_static:encoding.encode(extracted.staticText).length,T_dynamic:encoding.encode(extracted.assetText).length,
          staticText:extracted.staticText,staticSha256:hash(extracted.staticText),dynamicSha256:hash(extracted.assetText),sections:extracted.sections});
      } catch(error) { errors.push({key:job.key,client:job.client,variant:job.variant,checkpoint:job.checkpoint,reason:error.message}); }
      finally { finished++; if(finished%100===0 || finished===jobs.length) console.log(JSON.stringify({finished,total:jobs.length,measured:rows.length,errors:errors.length})); }
    }
  }));
} finally { encoding.free(); }
rows.sort((a,b)=>`${a.client}/${a.variant}/${a.caseId}`.localeCompare(`${b.client}/${b.variant}/${b.caseId}`));
const groups = {};
for(const client of ['codex','claude-code']) for(const variant of ['baseline','V4']) {
  const selected = rows.filter(r=>r.client===client && r.variant===variant);
  groups[`${client}/${variant}`]={T_static:distribution(selected.map(r=>r.T_static)),T_dynamic:distribution(selected.map(r=>r.T_dynamic)),
    selectedCases:jobs.filter(r=>r.client===client && r.variant===variant).length};
}
const paired = {};
for(const client of ['codex','claude-code']) {
  const baseline = rows.filter(r=>r.client===client && r.variant==='baseline');
  const v4 = new Map(rows.filter(r=>r.client===client && r.variant==='V4').map(r=>[r.caseId,r]));
  const matches = baseline.flatMap(b=>{const v=v4.get(b.caseId);return v && b.dynamicSha256===v.dynamicSha256 ? [{caseId:b.caseId,baseline:b.T_static,V4:v.T_static}] : [];});
  const total = field=>matches.reduce((n,r)=>n+r[field],0);
  paired[client]={cases:matches.length,baselineMean:matches.length?total('baseline')/matches.length:null,V4Mean:matches.length?total('V4')/matches.length:null,
    savingPercent:total('baseline')?100*(1-total('V4')/total('baseline')):null,caseValues:matches};
}
fs.writeFileSync(path.join(root,'static-input-cases.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(path.join(root,'static-input.json'),JSON.stringify({generatedAt:new Date().toISOString(),tokenizer:'o200k_base',
  tokenizerVersion:JSON.parse(fs.readFileSync(path.resolve('evaluation/MemoryProxy/node_modules/tiktoken/package.json'),'utf8')).version,policy:'First task provider input; complete tool instructions and routing, including runtime URLs/headers, excluding skill entries, session identity and outer wrapper; identical extraction and tokenizer for four groups. Savings use same-case identical-dynamic-listing pairs only.',groups,paired,errors},null,2)+'\n');
console.log(JSON.stringify({groups,paired:Object.fromEntries(Object.entries(paired).map(([k,v])=>[k,{...v,caseValues:undefined}])),errorReasons:[...new Set(errors.map(e=>e.reason))]},null,2));
