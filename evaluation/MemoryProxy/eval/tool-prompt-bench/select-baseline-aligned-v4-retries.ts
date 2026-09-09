import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadFinal5Dataset } from './final5-formal-datasource.js';
import { projectFinal5Evidence } from './final5-evidence.js';
import { scoreCaseChain } from './measurement-v2/scorer.js';

const repo=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const runs=join(repo,'runs'), consolidated=join(runs,'final5-test1k-20260909-consolidated');
const output=join(consolidated,'V4/baseline-aligned-retry');
const dataset=loadFinal5Dataset(join(repo,'evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test1k/teams'));
const records=new Map(dataset.records.map(r=>[r.case_id,r]));
const jsonl=(text:string)=>text.split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
const baselines=new Map<string,Map<string,any>>();
for(const client of ['codex','claude-code']) {
  const rows=jsonl(await readFile(join(consolidated,'baseline',client,'timeout-inclusive-cases.jsonl'),'utf8'));
  assert.equal(new Set(rows.map(r=>r.caseId)).size,rows.length);
  baselines.set(client,new Map(rows.map(r=>[r.caseId,r])));
}
const cache=new Map<string,any>();
for(const c of jsonl(await readFile(join(consolidated,'collected.jsonl'),'utf8'))) if(c.evidence.variant==='V4'&&c.evidence.datasetDigest===dataset.sourceDigest) cache.set(c.checkpoint+'|'+c.startedAt,c.evidence);
const jobs:any[]=[];
for(const root of readdirSync(runs).filter(n=>n.startsWith('final5-test1k-'))) for(const client of baselines.keys()) {
  const dir=join(runs,root,'execution',client,'V4/execution.json.checkpoint');
  if(existsSync(dir)) for(const file of readdirSync(dir).filter(n=>n.endsWith('.json')&&n!=='config.json'))jobs.push({client,file:join(dir,file),root});
}
const history=new Map<string,any[]>(), eligible=new Map<string,any[]>(), errors:any[]=[];
let cursor=0,done=0;
await Promise.all(Array.from({length:16},async()=>{while(cursor<jobs.length){const job=jobs[cursor++];try{
  const cp=JSON.parse(await readFile(job.file,'utf8'));
  if(!baselines.get(job.client)!.has(cp.key?.caseId))continue;
  assert.equal(cp.key.variant,'V4');assert.equal(cp.key.repeat,1);
  const key=job.client+':'+cp.key.caseId;
  for(const a of cp.attempts??[]) {
    const item:any={checkpoint:job.file,root:job.root,startedAt:a.startedAt,status:a.status,durationMs:a.durationMs,
      timedOut:a.trace?.timedOut===true||a.trace?.receipt?.lifecycle?.timedOut===true};
    const h=history.get(key)??[];h.push(item);history.set(key,h);
    if(a.status!=='completed')continue;
    try{
      let evidence=cache.get(job.file+'|'+a.startedAt);
      if(!evidence){
        const dir=a.evidenceDirectory??a.trace?.evidenceDirectory??a.trace?.outputDir;
        if(!dir)throw new Error('missing evidence directory');
        const manifest=JSON.parse(await readFile(join(dir,'attempt-capture.json'),'utf8'));
        const [eventText,intentText]=await Promise.all([
          manifest.captureAvailable?readFile(join(dir,'http-events.jsonl'),'utf8'):Promise.resolve(''),
          readFile(join(dir,'intent-evidence.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return 'null';throw e;})]);
        evidence=projectFinal5Evidence(records.get(cp.key.caseId)!,dataset.sourceDigest,manifest,jsonl(eventText),JSON.parse(intentText));
      }
      assert.equal(evidence.client,job.client);assert.equal(evidence.variant,'V4');assert.equal(evidence.caseId,cp.key.caseId);
      const score=scoreCaseChain(evidence.scoring);
      if(!evidence.inputComplete||!score.traceCompleteness){item.exclusion='incomplete behavioral evidence';continue;}
      const list=eligible.get(key)??[];list.push({...item,score});eligible.set(key,list);
    }catch(e){item.exclusion=e instanceof Error?e.message:String(e);}
  }
}catch(e){errors.push({file:job.file,error:String(e)});}finally{if(++done%100===0||done===jobs.length)console.log('Checkpoints',done,'/',jobs.length);}}}));
assert.equal(errors.length,0,JSON.stringify(errors));
const sourcePlan=JSON.parse(await readFile(join(runs,'final5-test1k-20260908/campaign.json'),'utf8'));
assert.equal(sourcePlan.datasetDigest,dataset.sourceDigest);
await mkdir(output,{recursive:true});
const summary:any={generatedAt:new Date().toISOString(),datasetDigest:dataset.sourceDigest,baselineSource:'baseline/*/timeout-inclusive-cases.jsonl',policy:'Same client and case ID as the frozen timeout-inclusive baseline. Earliest eligible completed V4 attempt, without selection by score. Missing includes no attempt, failed/timeout attempts, and incomplete evidence. Plans are selections only; refresh before execution if campaigns are active.',groups:{}};
for(const [client,baseline] of baselines){
  const rows=[...baseline].map(([caseId,b])=>{
    const key=client+':'+caseId;
    const attempts=(history.get(key)??[]).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
    const observed=(eligible.get(key)??[]).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.checkpoint.localeCompare(b.checkpoint));
    const v4=observed[0];let category='keep',reason='passed';
    if(!v4){category='missing';reason=!attempts.length?'no-recorded-attempt':attempts.some(a=>a.timedOut)?'timeout-without-valid-result':attempts.some(a=>a.status==='completed')?'completed-but-unscorable':'failed-or-unfinished';}
    else if(b.shouldCall?!v4.score.completeChainSuccess:v4.score.falseCallAttempt===true||v4.score.malformedFalseIntent===true){category='behavior-failure';reason=v4.score.failureLayer??'behavior-failure';}
    else if(b.shouldCall&&(!v4.score.strictChainExact||v4.score.positiveOvercall)){category='strict-only';reason='complete-chain-but-not-strict';}
    return {client,variant:'V4',caseId,teamId:records.get(caseId)!.team_id,shouldCall:b.shouldCall,category,reason,
      baseline:{kind:b.kind,startedAt:b.startedAt,checkpoint:b.checkpoint,score:b.score},v4:v4??null,attempts};
  });
  const dir=join(output,client);await mkdir(dir,{recursive:true});
  const counts=Object.fromEntries(['missing','behavior-failure','strict-only','keep'].map(k=>[k,rows.filter(r=>r.category===k).length]));
  summary.groups[client]={baselineCases:baseline.size,...counts,retryTotal:rows.filter(r=>r.category!=='keep').length};
  assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),baseline.size);
  for(const kind of ['missing','behavior-failure','strict-only','all']){
    const selected=rows.filter(r=>kind==='all'?r.category!=='keep':r.category===kind);
    const ids=selected.map(r=>r.caseId),idSet=new Set(ids);
    assert.equal(ids.length,idSet.size);assert(ids.every(id=>baseline.has(id)));
    const plan={...sourcePlan,campaignId:`${sourcePlan.campaignId}-v4-${client}-baseline-aligned-${kind}`,variants:['V4'],selectedCaseIds:ids,slots:sourcePlan.slots.filter((s:any)=>s.variant==='V4'&&idSet.has(s.caseId))};
    assert.equal(plan.slots.length,ids.length);
    await writeFile(join(dir,`${kind}.plan.json`),JSON.stringify(plan,null,2)+'\n');
    await writeFile(join(dir,`${kind}.case-ids.txt`),ids.join('\n')+(ids.length?'\n':''));
  }
  await writeFile(join(dir,'aligned-cases.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const selected=rows.filter(r=>r.category!=='keep');
  await writeFile(join(dir,'retry-cases.jsonl'),selected.map(r=>JSON.stringify(r)).join('\n')+'\n');
}
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const md='# 与 baseline 对齐的 V4 重跑清单\n\n'+summary.generatedAt+'\n\n对齐范围固定为上一轮纳入交互超时的 baseline case，同终端、同 case ID 一一对应。V4 重新扫描当前 checkpoint，取最早有效完成证据，不按重试最高分挑选。\n\n| 终端 | baseline 范围 | V4 缺有效结果 | 工具链失败/误调用 | 仅严格链不达标 | 保留 | 重跑合计 |\n|---|---:|---:|---:|---:|---:|---:|\n'+Object.entries(summary.groups).map(([c,g]:[string,any])=>`| ${c} | ${g.baselineCases} | ${g.missing} | ${g['behavior-failure']} | ${g['strict-only']} | ${g.keep} | ${g.retryTotal} |`).join('\n')+'\n\n每个终端目录包含 `all.plan.json`（三类并集）以及 `missing.plan.json`、`behavior-failure.plan.json`、`strict-only.plan.json`，均附纯 case ID 文本。`retry-cases.jsonl` 包含 baseline 对照、V4 评分、筛选原因和历史来源；`aligned-cases.jsonl` 覆盖全部 baseline 范围。\n\n缺失包括未运行、失败/超时后无有效完成结果、完成但证据不可评分；不代表这些 case 都从未运行。仅严格链不达标表示完整链成功，但存在多余调用或严格链失败。三类互斥，同一 case 不重复。\n\n本次仅生成筛选清单，未启动重跑；运行中任务可能改变缺失状态，执行前应刷新。原评估结果保留，按失败筛选的重跑数据应另列，避免用筛选后的最好成绩替换原结果。\n';
await writeFile(join(output,'README.zh-CN.md'),md);console.log(JSON.stringify({output,...summary},null,2));
