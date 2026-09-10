import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { loadFinal5Dataset } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-formal-datasource.js';
import { assessAttempt } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/assess-attempt.js';
import { ATTEMPT_POLICY } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/attempt-policy.js';
import { inspectLock } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/process-lock.mjs';
import { verifyStageReceipt } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/merge-stage-receipts.js';
import { executionHash } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/execution-checkpoint.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [name,client,arm]=process.argv.slice(2);
if(!name||!/^[\w-]+$/.test(name)||!['codex','claude-code'].includes(client)||!['baseline','V4'].includes(arm))throw Error('Usage: audit-retries.ts <run-name> codex|claude-code baseline|V4');
const variant=arm==='baseline'?'server_team':'V4';
const run=join(root,'runs',name), read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const config=read(join(run,'evaluation.json')), plan=read(resolve(run,config.plan));
const dataset=loadFinal5Dataset(resolve(run,config.teamsRoot));
if(dataset.sourceDigest!==plan.datasetDigest)throw Error('Dataset changed');
const candidates=new Map<string,any[]>(), signatures=new Set<string>();
const sourceRuns:string[]=[];
for(const entry of readdirSync(resolve(run,config.outputRoot),{withFileTypes:true})){
 if(!entry.isDirectory()||!entry.name.startsWith('quick-'))continue;
 const quick=join(resolve(run,config.outputRoot),entry.name), stage=join(quick,client,variant), receiptFile=join(stage,'execution.json');
 if(!existsSync(stage))continue;
 if(inspectLock(join(quick,'controller.lock')).state!=='missing'||existsSync(join(stage,'execution.json.checkpoint/runner.lock')))throw Error('Run may still be active: '+quick);
 const provenanceKnown=existsSync(receiptFile);
 let receipt:any;
 if(provenanceKnown){
  receipt=read(receiptFile);const comparison=receipt.executionContext?.comparison;
  verifyStageReceipt(receipt,variant);
  if(receipt.datasetDigest!==dataset.sourceDigest||comparison?.client!==client)throw Error('Receipt identity mismatch');
  signatures.add(JSON.stringify(Object.fromEntries(['client','model','provider','reasoningEffort','verbosity','historyTransport','datasetDigest','runnerSha256'].map(k=>[k,comparison[k]??null]))));
 }else{
  const checkpoints=join(stage,'execution.json.checkpoint');
  const results=existsSync(checkpoints)?readdirSync(checkpoints).filter(x=>x.endsWith('.json')&&x!=='config.json').map(file=>{
   const cp=read(join(checkpoints,file));if(cp.attemptsHash!==executionHash(cp.attempts)||cp.key.variant!==variant)throw Error('Invalid checkpoint');return {...cp.key,attempts:cp.attempts};
  }):[];
  receipt={results};
 }
 sourceRuns.push(quick);
 for(const result of receipt.results){
  if(!plan.selectedCaseIds.includes(result.caseId))continue;
  for(const a of result.attempts??[]){
   const dir=a.evidenceDirectory??a.trace?.evidenceDirectory??a.trace?.outputDir??result.trace?.evidenceDirectory??result.trace?.outputDir;
   if(dir && existsSync(dir)){const rel=relative(realpathSync(stage),realpathSync(dir));if(rel.startsWith('..')||isAbsolute(rel))throw Error('Evidence escapes stage');}
   const row=dataset.records.find(r=>r.case_id===result.caseId)!;
   let assessment:any=dir?assessAttempt({...a,trace:a.trace??result.trace},client as any,variant,row,dataset.sourceDigest,dir):{category:'retry',reason:'missing-evidence-directory',retryRequired:true,scorable:false};
   if(!provenanceKnown&&assessment.scorable)assessment={...assessment,scorable:false,retryRequired:false,reviewRequired:true,reason:'stage-receipt-missing-review-provenance'};
   const {evidence,...decision}=assessment as any;
   const list=candidates.get(row.case_id)??[];
   list.push({...decision,caseId:row.case_id,startedAt:a.startedAt,source:receiptFile,directory:dir,evidence});candidates.set(row.case_id,list);
  }
 }
}
if(signatures.size>1)throw Error('Mixed model/provider/runner conditions. Do not silently combine these runs.');
const selected:any[]=[], retryCaseIds:string[]=[], reviewCaseIds:string[]=[], rows:any[]=[];
for(const caseId of plan.selectedCaseIds){
 const attempts=(candidates.get(caseId)??[]).sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)));
 const good=attempts.find(a=>a.scorable);
 if(good){const {evidence,...decision}=good;rows.push(decision);selected.push(evidence);}
 else if(attempts.some(a=>a.reviewRequired)){reviewCaseIds.push(caseId);const {evidence,...decision}=attempts.find(a=>a.reviewRequired);rows.push(decision);}
 else{retryCaseIds.push(caseId);rows.push({caseId,category:'retry',reason:attempts.at(-1)?.reason??'not-run',retryRequired:true});}
}
const directory=join(run,'retry-audits',Date.now()+'-'+randomUUID());mkdirSync(directory,{recursive:true});
const evidenceText=selected.map(r=>JSON.stringify(r)).join('\n')+(selected.length?'\n':'');
const result={schemaVersion:'retry-audit-v1',policy:ATTEMPT_POLICY,runName:name,client,variant,datasetDigest:dataset.sourceDigest,signature:[...signatures][0]??null,sourceRuns,createdAt:new Date().toISOString(),retryCaseIds,reviewCaseIds,rows,evidenceSha256:createHash('sha256').update(evidenceText).digest('hex')};
const serialized=JSON.stringify(result);const manifest={...result,sha256:createHash('sha256').update(serialized).digest('hex')};
writeFileSync(join(directory,'retry.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
writeFileSync(join(directory,'selected-evidence.jsonl'),evidenceText,{flag:'wx'});
console.log(JSON.stringify({audit:join(directory,'retry.json'),selected:selected.length,retry:retryCaseIds.length,needsReview:reviewCaseIds.length,policy:ATTEMPT_POLICY}));
