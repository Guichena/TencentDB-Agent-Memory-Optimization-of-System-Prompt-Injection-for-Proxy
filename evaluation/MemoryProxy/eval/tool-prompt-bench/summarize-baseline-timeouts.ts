import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { loadFinal5Dataset } from './final5-formal-datasource.js';
import { projectFinal5Evidence } from './final5-evidence.js';
import { scoreCaseChain } from './measurement-v2/scorer.js';

const root=resolve('../../runs/final5-test1k-20260909-consolidated');
const dataset=loadFinal5Dataset(resolve('eval/tool-prompt-bench/formal-dataset/final5/test1k/teams'));
const records=new Map(dataset.records.map(r=>[r.case_id,r]));
const census=JSON.parse(await readFile(join(root,'baseline/attempt-census.json'),'utf8'));
const jsonl=(text:string)=>text.split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
const candidates:any[]=[];
for(const client of ['codex','claude-code']) {
  const indexes=jsonl(await readFile(join(root,'baseline',client,'case-index.jsonl'),'utf8'));
  const evidence=jsonl(await readFile(join(root,'baseline',client,'evidence.jsonl'),'utf8'));
  const byId=new Map(indexes.map(x=>[x.key.split(':').slice(2).join(':'),x]));
  for(const e of evidence) candidates.push({client,caseId:e.caseId,startedAt:byId.get(e.caseId).startedAt,checkpoint:byId.get(e.caseId).checkpoint,kind:'completed',shouldCall:records.get(e.caseId)!.gold.should_call,score:scoreCaseChain(e.scoring)});
}
const audit:any[]=[];
const jobs=census.filter((a:any)=>a.timeout);let cursor=0;
await Promise.all(Array.from({length:12},async()=>{while(cursor<jobs.length){
  const a=jobs[cursor++];const check:any={client:a.client,caseId:a.caseId,startedAt:a.startedAt,checkpoint:a.file,directory:a.directory,durationMs:a.durationMs};
  try {
    if(!a.directory) throw new Error('missing capture directory');
    const manifest=JSON.parse(await readFile(join(a.directory,'attempt-capture.json'),'utf8'));
    assert.equal(manifest.client,a.client);assert.equal(manifest.caseId,a.caseId);assert.equal(manifest.variant,'server_team');assert.equal(manifest.repeat,1);
    const events=jsonl(await readFile(join(a.directory,'http-events.jsonl'),'utf8'));
    const intent=JSON.parse(await readFile(join(a.directory,'intent-evidence.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return 'null';throw e;}));
    const evidence=projectFinal5Evidence(records.get(a.caseId)!,dataset.sourceDigest,manifest,events,intent);
    const successful=evidence.providerUsage!.requests.filter(r=>r.succeeded);
    const successIds=new Set(successful.map(r=>r.requestId));
    const endAt=Date.parse(a.startedAt)+a.durationMs;
    const successes=events.filter(e=>e.type==='provider.end'&&successIds.has(e.id));
    const lastSuccess=Math.max(0,...successes.map(e=>Date.parse(e.timestamp)));
    const hardErrors=events.filter(e=>(e.type==='provider.end'&&e.status>=400 || e.type==='provider.failed')&&Date.parse(e.timestamp)>lastSuccess&&Date.parse(e.timestamp)<endAt-5000);
    check.successfulRequests=successful.length;check.lastSuccessfulResponseAgeMs=endAt-lastSuccess;check.terminalProviderErrors=hardErrors.length;
    // A bounded, auditable activity rule distinguishes continued work from a stalled provider.
    check.eligible=a.durationMs>=480000&&successful.length>=2&&endAt-lastSuccess<=120000&&hardErrors.length===0;
    check.reason=check.eligible?'interactive-deadline':a.durationMs<480000?'shorter-than-eight-minutes':successful.length<2?'insufficient-successful-interaction':hardErrors.length?'terminal-provider-error':'no-successful-response-in-final-two-minutes';
    check.observedScore=scoreCaseChain(evidence.scoring);
    if(check.eligible) candidates.push({client:a.client,caseId:a.caseId,startedAt:a.startedAt,checkpoint:a.file,kind:'interactive-timeout',shouldCall:records.get(a.caseId)!.gold.should_call,score:check.observedScore,activity:check});
  } catch(error) {check.eligible=false;check.reason=error instanceof Error?error.message:String(error);}
  audit.push(check);
}}));
const selected=new Map<string,any>();
for(const c of candidates.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.checkpoint.localeCompare(b.checkpoint))){const k=c.client+':'+c.caseId;if(!selected.has(k))selected.set(k,c);}
const ratio=(rows:any[],predicate:(r:any)=>boolean)=>({numerator:rows.filter(predicate).length,denominator:rows.length,percent:rows.length?100*rows.filter(predicate).length/rows.length:null});
const groups:any={};
for(const client of ['codex','claude-code']){
  const rows=[...selected.values()].filter(r=>r.client===client),pos=rows.filter(r=>r.shouldCall),neg=rows.filter(r=>!r.shouldCall);
  assert.equal(new Set(rows.map(r=>r.caseId)).size,rows.length);
  const timed=rows.filter(r=>r.kind==='interactive-timeout');
  groups[client]={cases:rows.length,positive:pos.length,negative:neg.length,completed:rows.length-timed.length,interactiveTimeouts:timed.length,timeoutPositive:timed.filter(r=>r.shouldCall).length,timeoutNegative:timed.filter(r=>!r.shouldCall).length,
    trigger:ratio(pos,r=>r.score.triggeredAttempt===true),firstTool:ratio(pos,r=>r.score.firstActionSelectionCorrect===true),
    complete:ratio(pos,r=>r.kind==='completed'&&r.score.completeChainSuccess===true),strict:ratio(pos,r=>r.kind==='completed'&&r.score.strictChainExact===true),
    falseCall:ratio(neg,r=>r.score.falseCallAttempt===true),overcall:ratio(pos,r=>r.score.positiveOvercall===true),
    observedChainBeforeTimeout:timed.filter(r=>r.shouldCall&&r.score.completeChainSuccess===true).length,
    overallSuccess:ratio(rows,r=>r.kind==='completed'&&(r.shouldCall?r.score.completeChainSuccess===true:r.score.falseCallAttempt===false)),
    timeoutAttempts: audit.filter(a=>a.client===client).length,eligibleTimeoutAttempts:audit.filter(a=>a.client===client&&a.eligible).length};
  const dir=join(root,'baseline',client);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'timeout-inclusive-cases.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
}
const result={generatedAt:new Date().toISOString(),policy:'Baseline only. Earliest completed or interactive timeout per case. Interactive timeout: >=480000 ms, >=2 successful task provider responses, last success within 120000 ms of termination, no later provider error before final 5000 ms cancellation window. All selected interactive timeouts fail deadline success; observed tool facts retained separately. Raw partial traces are not relabeled complete.',groups};
await writeFile(join(root,'baseline/timeout-audit.json'),JSON.stringify(audit,null,2));
await writeFile(join(root,'baseline/timeout-inclusive-summary.json'),JSON.stringify(result,null,2));
const pct=(r:any)=>r.percent===null?'N/A':`${r.numerator}/${r.denominator} (${r.percent.toFixed(2)}%)`;
const md='# Baseline：纳入交互超时的统计\n\n'+result.generatedAt+'\n\n| 终端 | 有效 case | 完成记录 | 交互超时失败 | 正/负样本 | 限时完整链 | 限时严格链 | 误调用率 | 总体成功率 |\n|---|---:|---:|---:|---|---|---|---|---|\n'+Object.entries(groups).map(([c,g]:[string,any])=>`| ${c} | ${g.cases} | ${g.completed} | ${g.interactiveTimeouts} | ${g.positive}/${g.negative} | ${pct(g.complete)} | ${pct(g.strict)} | ${pct(g.falseCall)} | ${pct(g.overallSuccess)} |`).join('\n')+'\n\n按同一 case 最早有效尝试去重，包括先超时、后重试成功的情形。交互超时纳入有效分母并计为限时失败；超时前已经完成的工具链事实单独保留，不直接归因为“没找到工具”。完整链/严格链分母为正样本，误调用率分母为负样本，总体成功率分母为全部有效 case；负样本超时是限时失败，不凭空认定发生误调用。\n\n交互证据规则：运行至少 480 秒，至少两次成功的任务模型响应，终止前两分钟内仍有成功响应，且最后成功响应之后、终止前五秒之前没有 provider 错误。最后五秒用于容纳时限取消。该规则是保守的可复核操作定义，未满足者暂不纳入，详见 timeout-audit.json；不能断言所有排除项都属于基础设施失败。\n\n'+Object.entries(groups).map(([c,g]:[string,any])=>`${c}：${g.timeoutAttempts} 次超时记录中 ${g.eligibleTimeoutAttempts} 次符合交互证据规则，去重后选中 ${g.interactiveTimeouts} 次。其中 ${g.observedChainBeforeTimeout} 个正样本已在超时前完成工具链，仍按限时失败列入。`).join('\n\n')+'\n';
await writeFile(join(root,'baseline/RESULTS-timeout-inclusive.zh-CN.md'),md);
console.log(JSON.stringify(result,null,2));
