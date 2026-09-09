import fs from 'node:fs';
import path from 'node:path';

const runs = path.resolve('runs');
const output = path.join(runs, 'final5-test1k-20260909-completed-summary');
const groups = new Map();
const sources = [];
for (const root of fs.readdirSync(runs).filter(x => x.startsWith('final5-test1k-')).sort()) {
  for (const client of ['codex', 'claude-code']) {
    const file = path.join(runs, root, 'execution/live', `latest-metrics-${client}.json`);
    if (!fs.existsSync(file)) continue;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const manifest = path.join(runs, root, 'execution/experiment.json');
    const fingerprints = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')).sourceFingerprints : null;
    sources.push({file, modifiedAt:fs.statSync(file).mtime.toISOString(), datasetDigest:report.datasetDigest, fingerprints});
    for (const row of report.caseScores ?? []) {
      if (!row.behaviorEligible || !row.score) continue;
      const variant = row.variant === 'server_team' ? 'baseline' : row.variant;
      const key = `${client}/${variant}`;
      if (!groups.has(key)) groups.set(key, new Map());
      const cases = groups.get(key);
      if (!cases.has(row.caseId)) cases.set(row.caseId, {...row, source:file, fingerprint:fingerprints?.[variant === 'V4' ? 'v4' : 'baseline'] ?? null});
    }
  }
}
const ratio = (rows, field) => ({numerator:rows.filter(x=>x.score[field] === true).length, denominator:rows.length, percent:rows.length ? 100*rows.filter(x=>x.score[field] === true).length/rows.length:null});
function metrics(rows) {
  const pos=rows.filter(x=>x.shouldCall), neg=rows.filter(x=>!x.shouldCall);
  return {cases:rows.length,positive:pos.length,negative:neg.length,
    trigger:ratio(pos,'triggeredAttempt'),firstAction:ratio(pos,'firstActionSelectionCorrect'),terminal:ratio(pos,'terminalSelectionCorrect'),complete:ratio(pos,'completeChainSuccess'),strict:ratio(pos,'strictChainExact'),overcall:ratio(pos,'positiveOvercall'),falseCall:ratio(neg,'falseCallAttempt'),
    fingerprints:[...new Set(rows.map(x=>x.fingerprint))],failures:Object.fromEntries([...new Set(rows.map(x=>x.score.failureLayer ?? 'none'))].map(k=>[k,rows.filter(x=>(x.score.failureLayer ?? 'none')===k).length]))};
}
fs.mkdirSync(output,{recursive:true});
const summary={generatedAt:new Date().toISOString(),scope:'Deduplicated behavior-eligible case scores from saved live reports; not a fresh raw-capture census. First report in sorted run-root order wins; no selection by score.',sources,groups:{},paired:{}};
for (const [key,cases] of groups) {
  const rows=[...cases.values()]; summary.groups[key]=metrics(rows);
  const dir=path.join(output,key);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'case-scores.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
}
for (const client of ['codex','claude-code']) {
  const base=groups.get(`${client}/baseline`)??new Map(), v4=groups.get(`${client}/V4`)??new Map();
  const ids=[...base.keys()].filter(id=>v4.has(id));
  summary.paired[client]={cases:ids.length,baseline:metrics(ids.map(id=>base.get(id))),V4:metrics(ids.map(id=>v4.get(id)))};
}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
const pct=x=>x.percent===null?'N/A':`${x.numerator}/${x.denominator} (${x.percent.toFixed(2)}%)`;
let md='# Completed Case Results\n\nSaved live-report snapshot, deduplicated by client, variant and case ID. Not all raw captures have been rescored.\n\n| Group | Cases | Positive | Negative | Trigger | First action | Complete | Strict | False call | Overcall |\n|---|---:|---:|---:|---|---|---|---|---|---|\n';
for(const [key,m] of Object.entries(summary.groups)) md+=`| ${key} | ${m.cases} | ${m.positive} | ${m.negative} | ${pct(m.trigger)} | ${pct(m.firstAction)} | ${pct(m.complete)} | ${pct(m.strict)} | ${pct(m.falseCall)} | ${pct(m.overcall)} |\n`;
md+='\n## Paired Cases\n';
for(const [client,p] of Object.entries(summary.paired)) md+=`\n${client}: ${p.cases} paired cases; Complete ${pct(p.baseline.complete)} -> ${pct(p.V4.complete)}; Strict ${pct(p.baseline.strict)} -> ${pct(p.V4.strict)}; False call ${pct(p.baseline.falseCall)} -> ${pct(p.V4.falseCall)}.\n`;
fs.writeFileSync(path.join(output,'RESULTS.md'),md);
console.log(md);
console.log(JSON.stringify({fingerprints:Object.fromEntries(Object.entries(summary.groups).map(([k,v])=>[k,v.fingerprints])),sourceReports:sources.length,output}));
