import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFinal5Evidence } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/collect-final5-evidence.js';
import { inspectLock } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/process-lock.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [mode, directory, client, ...flags]=process.argv.slice(2);
if(flags.length && (flags.length!==2 || flags[0]!=='--variant' || !['both','baseline','V4'].includes(flags[1])))throw Error('Use --variant both|baseline|V4');
const variant=flags[1]==='baseline'?'server_team':flags[1]==='V4'?'V4':undefined;
if(!['status','score'].includes(mode)||!directory||!['codex','claude-code'].includes(client))throw Error('Usage: results.ts status|score <quick-run-directory> codex|claude-code');
const quick=resolve(root,directory), rel=relative(join(root,'runs'),quick);
if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Expected an experiment directory under runs/');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
if(mode==='status'){
  for(const variant of ['server_team','V4']){
    const stage=join(quick,client,variant), receipt=join(stage,'execution.json');
    if(existsSync(receipt)){
      const r=read(receipt);
      console.log(JSON.stringify({variant,finished:true,planned:r.slotCount,completed:r.completed,failed:r.failed,failedCaseIds:r.results.filter((x:any)=>x.status==='failed').map((x:any)=>x.caseId)}));
    }else{
      const checkpoints=join(stage,'execution.json.checkpoint');
      const attempts=existsSync(checkpoints)?readdirSync(checkpoints).filter(x=>x.endsWith('.json')&&x!=='config.json').flatMap(x=>{try{const cp=read(join(checkpoints,x));return cp.attempts?.length?[cp.attempts.at(-1)]:[];}catch{return [];}}):[];
      console.log(JSON.stringify({variant,finished:false,checkpointCompleted:attempts.filter(x=>x.status==='completed').length,checkpointFailed:attempts.filter(x=>x.status==='failed').length,note:'Checkpoint count is not an active-worker count; inspect worker and evidence logs.'}));
    }
  }
}else{
  const lockStatus=inspectLock(join(quick,'controller.lock')).state;
  if(lockStatus!=='missing')throw Error(`Controller lock is ${lockStatus}; use doctor before scoring.`);
  for(const required of variant?[variant]:['server_team','V4']){
    if(!existsSync(join(quick,client,required,'execution.json')))throw Error(`Missing ${required} receipt. For one arm use --variant baseline or --variant V4.`);
  }
  const config=read(join(quick,'launch-config.json'));
  const output=join(quick,client,'report-'+Date.now());
  const report=collectFinal5Evidence(resolve(quick,config.teamsRoot),join(quick,client),client as 'codex'|'claude-code',output,{variant});
  console.log(JSON.stringify({output,status:report.status,scope:report.scope,executionCoverage:report.executionCoverage,singleVariantMetrics:report.singleVariantMetrics,comparison:report.comparison,coverage:report.coverage}));
}
