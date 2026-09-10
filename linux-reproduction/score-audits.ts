import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { loadFinal5Dataset } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-formal-datasource.js';
import { buildFinal5MetricsReport, writeFinal5MetricsReport } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-metrics-report.js';
import { ATTEMPT_POLICY } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/attempt-policy.js';
import { inspectLock } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/process-lock.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=process.argv.slice(2);
if(files.length!==2)throw Error('Usage: score-audits.ts <baseline retry.json> <V4 retry.json>');
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const audits=files.map(file=>{
 const path=resolve(root,file),{sha256,...audit}=JSON.parse(readFileSync(path,'utf8'));
 if(sha(JSON.stringify(audit))!==sha256||audit.policy!==ATTEMPT_POLICY)throw Error('Audit was modified or policy changed');
 const raw=readFileSync(join(dirname(path),'selected-evidence.jsonl'),'utf8');
 if(sha(raw)!==audit.evidenceSha256)throw Error('Selected evidence was modified');
 return {audit,evidence:raw.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))};
});
const [left,right]=audits.map(x=>x.audit);
if(left.variant!=='server_team'||right.variant!=='V4'||left.runName!==right.runName||left.client!==right.client||left.datasetDigest!==right.datasetDigest||!left.signature||left.signature!==right.signature)throw Error('Audits must share run/client/model/provider/runner and use baseline then V4 order');
if(!/^[\w-]+$/.test(left.runName))throw Error('Invalid run name');
const run=join(root,'runs',left.runName),config=JSON.parse(readFileSync(join(run,'evaluation.json'),'utf8'));
const plan=JSON.parse(readFileSync(resolve(run,config.plan),'utf8'));
for(const {audit} of audits){
 const execution=resolve(run,config.outputRoot);
 const current=readdirSync(execution).filter(dir=>dir.startsWith('quick-')&&existsSync(join(execution,dir,audit.client,audit.variant))).map(dir=>join(execution,dir)).sort();
 if(JSON.stringify(current)!==JSON.stringify([...audit.sourceRuns].sort()))throw Error('New runs exist; re-audit before merging');
 if(current.some(dir=>inspectLock(join(dir,'controller.lock')).state!=='missing'))throw Error('Execution is not stopped');
}
const dataset=loadFinal5Dataset(resolve(run,config.teamsRoot));
if(dataset.sourceDigest!==left.datasetDigest)throw Error('Dataset changed');
const report=buildFinal5MetricsReport({...dataset,records:dataset.records.filter(r=>plan.selectedCaseIds.includes(r.case_id))},audits.flatMap(x=>x.evidence),left.client);
const output=join(run,'reports','merged-'+Date.now()+'-'+randomUUID());mkdirSync(output,{recursive:true});
writeFinal5MetricsReport(report,output);
writeFileSync(join(output,'selection-provenance.json'),JSON.stringify({policy:ATTEMPT_POLICY,audits:files,remainingRetries:[left.retryCaseIds,right.retryCaseIds],needsReview:[left.reviewCaseIds,right.reviewCaseIds],selected:[left.rows,right.rows]},null,2));
console.log(JSON.stringify({output,status:report.status,coverage:report.coverage,comparison:report.comparison}));
