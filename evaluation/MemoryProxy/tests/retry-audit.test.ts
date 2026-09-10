import { it,expect } from 'vitest';
import { mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { loadFinal5Dataset } from '../eval/tool-prompt-bench/final5-formal-datasource.js';
it('audits infrastructure failures, then selects earliest valid attempts after a retry',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),name='retry-test-'+randomUUID(),run=join(root,'runs',name);
 const write=(p:string,v:any)=>{mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,JSON.stringify(v));};
 try{
  const teams=join(run,'teams'), data=join(teams,'team','data');mkdirSync(data,{recursive:true});
  for(const [file,rows] of Object.entries({cases:[{case_id:'a'},{case_id:'b'}],gold:[{case_id:'a',should_call:false,expected_sequence:[]},{case_id:'b',should_call:false,expected_sequence:[]}],evidence:[{case_id:'a'},{case_id:'b'}]}))writeFileSync(join(data,file+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n'));
  write(join(data,'assets.json'),{});const dataset=loadFinal5Dataset(teams);
  write(join(run,'evaluation.json'),{plan:'plan.json',teamsRoot:'teams',outputRoot:'execution'});write(join(run,'plan.json'),{selectedCaseIds:['a','b'],datasetDigest:dataset.sourceDigest});
  const stage=(batch:string,ids:string[],failed:string[])=>{
   const dir=join(run,'execution',batch,'codex','server_team');mkdirSync(dir,{recursive:true});
   const results=ids.map(caseId=>{
    const directory=join(dir,'execution.json.evidence',caseId),sessionId=batch+caseId;
    mkdirSync(directory,{recursive:true});
    if(!failed.includes(caseId)){
     write(join(directory,'attempt-capture.json'),{schemaVersion:'final5-attempt-capture-v1',client:'codex',variant:'server_team',caseId,repeat:1,sessionId,captureAvailable:true,lifecycleComplete:true});
     const events=[{type:'input.start',id:'i'},{type:'input.end',id:'i'},{type:'provider.start',id:'p',path:'http://provider/v1/responses'},{type:'provider.end',id:'p',status:200,rawBody:JSON.stringify({usage:{input_tokens:10,output_tokens:2}})}].map(x=>({...x,sessionId,timestamp:'2026-09-10T00:00:00Z'}));
     writeFileSync(join(directory,'http-events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
    }
    const status=failed.includes(caseId)?'failed':'completed';
    return {caseId,variant:'server_team',repeat:1,status,attempts:[{attempt:0,status,startedAt:batch==='quick-1'?'2026-09-10T00:00:00Z':'2026-09-10T01:00:00Z',durationMs:100,retryable:false,evidenceDirectory:directory}]};
   });
   const receipt={schemaVersion:'task1.final5-execution-receipt.v1',campaignId:batch,datasetDigest:dataset.sourceDigest,planSha256:'fixture',slotCount:ids.length,completed:ids.length-failed.length,failed:failed.length,results,executionContext:{comparison:{client:'codex',model:'fixture'},stage:{variant:'server_team',profile:'legacy'}}};
   write(join(dir,'execution.json'),{...receipt,receiptSha256:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')});
  };
  const audit=()=>{const stdout=execFileSync(process.execPath,[join(root,'evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs'),join(root,'linux-reproduction/audit-retries.ts'),name,'codex','baseline'],{encoding:'utf8',timeout:60000});const summary=JSON.parse(stdout.trim());return {summary,manifest:JSON.parse(readFileSync(summary.audit,'utf8'))};};
  stage('quick-1',['a','b'],['b']);const first=audit();expect(first.manifest.retryCaseIds).toEqual(['b']);
  stage('quick-2',['a','b'],[]);const second=audit();expect(second.manifest.retryCaseIds).toEqual([]);expect(second.summary.selected).toBe(2);
  expect(second.manifest.rows.find((x:any)=>x.caseId==='a').source).toContain('quick-1');
 }finally{rmSync(run,{recursive:true,force:true});}
},120000);
