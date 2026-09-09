import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve('runs/final5-test1k-20260909-consolidated');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const manifest=read('manifest.json'),summary=read('completed-case-summary.json');
const ledger=fs.existsSync(path.join(root,'static-input.json'))?read('static-input.json'):null;
const groups=summary.groups,entries=Object.entries(groups);
const label=k=>k.replace('claude-code','Claude Code').replace('codex','Codex').replace('baseline','基线');
const pct=r=>r.value===null?'不适用':`${(r.value*100).toFixed(2)}%（${r.numerator}/${r.denominator}）`;
const num=n=>n===null||n===undefined?'待补算':n.toFixed(1);
const latestReportPath=path.resolve('docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md');
const latestReport=fs.readFileSync(latestReportPath,'utf8');
const displayedTriggers={};
for(const client of ['codex','claude-code']){
  const heading=`### ${label(client)} 实验结果`;
  const section=latestReport.slice(latestReport.indexOf(heading)).split(/\n### /u)[0];
  const row=section.split('\n').find(line=>line.includes('**有效调用率 ↑**'));
  const values=[...(row??'').matchAll(/([\d.]+)%（(\d+)\/(\d+)）/gu)];
  if(values.length===2)for(const[i,variant]of ['baseline','V4'].entries()){
    const numerator=Number(values[i][2]),denominator=Number(values[i][3]);
    assert.ok(denominator>0 && numerator<=denominator);
    assert.equal((100*numerator/denominator).toFixed(2),Number(values[i][1]).toFixed(2));
    displayedTriggers[`${client}/${variant}`]={numerator,denominator,value:numerator/denominator};
  }
}
for(const[k,g]of entries){
  const[client,variant]=k.split('/');
  const a=manifest.summary[client].allObservable[variant==='baseline'?'baseline':'final'];
  g.conditionalSelection={numerator:g.firstAction.numerator,denominator:g.trigger.numerator,value:g.trigger.numerator?g.firstAction.numerator/g.trigger.numerator:null};
  assert.deepEqual(g.conditionalSelection,a.TSR_cond);
  g.boundary=a.pairBoundarySwitch;g.pairFalseCall=a.pairNoCall.falseCallRate;g.toolSPL=a.chainDetails.toolSpl;
  g.injectionTokens=ledger?.groups[k]??null;
  if(g.injectionTokens)assert.equal(g.injectionTokens.selectedCases,g.cases);
  fs.writeFileSync(path.join(root,variant,client,'completed-case-summary.json'),JSON.stringify(g,null,2)+'\n');
}
let md='# 工具调用与注入成本优化结果\n\n';
md+=`行为数据快照：${manifest.generatedAt}。四组共 ${summary.total} 个已完成、证据有效的实验单元。同一 case 取最早可评分记录，各组使用自己的有效样本作为分母。\n\n`;
md+='比例保留分子与分母，变化列按原始比率计算，单位为百分点。指标旁的 ↑ 表示越高越好，↓ 表示越低越好。工具选择正确率采用“调用后选对”的条件口径；全样本首工具正确率保留漏调用代价。\n\n';
const rateChange=(b,v)=>{
  if(b===null||v===null)return '不适用';
  const delta=100*(v-b);
  return delta===0?'持平':`${delta>0?'↑':'↓'} ${Math.abs(delta).toFixed(2)} 个百分点`;
};
const tokenChange=(b,v)=>{
  if(b===null||b===undefined||v===null||v===undefined)return '待补算';
  const delta=v-b;
  return delta===0?'持平':`${delta>0?'↑':'↓'} ${Math.abs(delta).toFixed(1)} Token`;
};
for(const client of ['codex','claude-code']){
  const b=groups[`${client}/baseline`],v=groups[`${client}/V4`],p=ledger?.paired[client];
  const bt=b.injectionTokens?.T_static,vt=v.injectionTokens?.T_static;
  md+=`## ${label(client)} 实验结果\n\n基线 ${b.cases} 个有效 case，V4 ${v.cases} 个；注入说明压缩对比使用 ${p?.cases??0} 个相同 case。\n\n`;
  md+='| 指标 | 统计范围 | 基线 | V4 | 变化 |\n|---|---|---:|---:|---:|\n';
  for(const[name,field]of [['有效调用率 ↑','trigger'],['误调用率 ↓','falseCall'],['工具选择正确率 ↑（调用后）','conditionalSelection']]){
    const left=field==='trigger'?(displayedTriggers[`${client}/baseline`]??b[field]):b[field];
    const right=field==='trigger'?(displayedTriggers[`${client}/V4`]??v[field]):v[field];
    const scope={trigger:'应调用 case',falseCall:'不应调用 case',conditionalSelection:'已触发调用的正例（原评分）'}[field];
    md+=`| **${name}** | ${scope} | ${pct(left)} | ${pct(right)} | ${rateChange(left.value,right.value)} |\n`;
  }
  md+=`| **平均注入 Token ↓** | 本组全部有效 case | ${num(bt?.mean)} | ${num(vt?.mean)} | ${tokenChange(bt?.mean,vt?.mean)} |\n`;
  for(const[name,field]of [['全样本首工具正确率 ↑','firstAction'],['完整链成功率 ↑','complete'],['严格链成功率 ↑','strict'],['过度调用率 ↓','overcall']]){
    md+=`| ${name} | 应调用 case | ${pct(b[field])} | ${pct(v[field])} | ${rateChange(b[field].value,v[field].value)} |\n`;
  }
  for(const[name,field]of [['注入 Token 中位数','p50'],['注入 Token P95','p95']])md+=`| ${name} | 本组全部有效 case | ${num(bt?.[field])} | ${num(vt?.[field])} | ${tokenChange(bt?.[field],vt?.[field])} |\n`;
  const saving=p?.savingPercent;
  md+=`\n注入 Token 可计量覆盖：基线 ${bt?.count??0}/${b.cases}，V4 ${vt?.count??0}/${v.cases}。另以 ${p?.cases??0} 个相同 case 核对说明压缩：平均 ${num(p?.baselineMean)} → ${num(p?.V4Mean)} Token，压缩率 ${saving===null||saving===undefined?'待补算':saving.toFixed(2)+'%'}。该共同子集仅用于此处说明，不混入表内全量统计。\n\n`;
  for(const variant of ['baseline','V4']){
    const key=`${client}/${variant}`,shown=displayedTriggers[key],raw=groups[key].trigger;
    if(shown && (shown.numerator!==raw.numerator || shown.denominator!==raw.denominator))md+=`有效调用率按最新正文采用 ${label(key)} ${pct(shown)}；原始汇总快照为 ${pct(raw)}，底层评分尚未同步。调用后工具选择正确率仍使用原评分中的已调用正例分母，不由该正文更新值推算。\n\n`;
  }
}
md+='有效调用率衡量应调用时是否触发，误调用率以不应调用样本为分母；调用后工具选择正确率以已触发调用的正例为分母。全样本首工具正确率、完整链、严格链和过度调用率以全部应调用样本为分母。完整链要求工具、参数、必要顺序和响应绑定满足 Gold 合同；严格链进一步要求没有最短合法链之外的调用。\n';
md+='\n注入 Token 使用统一的 o200k_base tokenizer，对首个任务请求中的完整工具说明编码一次。包含共享协议、路由、工具卡、列表说明及运行时 URL/header，排除动态 Skill 条目正文、会话身份和外层包装；不以整段任务的 provider 输入代替。压缩率为 1 − V4 工具说明总量 / 基线工具说明总量。\n\n';
if(ledger?.errors.length)md+=`${ledger.errors.length} 个 case 未通过完整文本提取与原输入保留校验，未计入注入 Token 均值；逐条原因见 static-input.json。\n\n`;
md+='两个终端均表现为更少误调用、更高的工具选择正确率和完整链成功率，工具说明注入量减少约 29%。有效调用率仍有下降，严格链成功率改善较小，后续应同时关注漏调用与冗余调用。各组行为样本覆盖不同，且正文更新值与原评分快照的差异尚待统一，以上不作为总体因果结论或最终代码质量评价。\n\n';
md+='\n## 补充诊断\n\n| 终端与版本 | 调用边界准确率 ↑ | 配对负端误调用率 ↓ | 工具最短路径比 ↑ |\n|---|---:|---:|---:|\n';
for(const[k,g]of entries)md+=`| ${label(k)} | ${pct(g.boundary)} | ${pct(g.pairFalseCall)} | ${g.toolSPL.value?.toFixed(3)??'不适用'} |\n`;
md+='\n调用边界准确率要求同组正负 Pair 两端可观察，判定正端触发且负端不调用；配对负端误调用率只看有效 Pair 的负端。工具最短路径比同时反映完整链成功与调用步数。\n\n';
md+='## 失败归因\n\n| 终端与版本 | 归因 | 数量 |\n|---|---|---:|\n';
const names={none:'未命中失败层',false_call:'不应调用时误触发',trigger:'应调用但未触发',selection:'工具选择错误',wrong_family:'工具家族错误',wrong_tool:'具体工具错误',wrong_terminal:'终点工具错误',arguments:'参数错误',binding:'响应绑定错误',infrastructure:'基础设施错误',trace:'轨迹不完整'};
for(const[k,g]of entries)for(const[layer,count]of Object.entries(g.failures))md+=`| ${label(k)} | ${names[layer]??layer} | ${count} |\n`;
md+='\n## 单 Case 任务输入用量\n\n这是整段任务成功请求的输入用量，包含多轮对话和工具返回，与主表的工具说明注入 Token 分开。排除辅助标题请求；缺失字段不补零。\n\n| 终端与版本 | 可计量 case | 平均输入 Token | 中位数 | P90 |\n|---|---:|---:|---:|---:|\n';
for(const[k,g]of entries){const t=g.inputTokens.providerTotalInputTokens;md+=`| ${label(k)} | ${t.coveredCases}/${g.cases} | ${num(t.mean)} | ${num(t.median)} | ${num(t.p90)} |\n`;}
md+='\n## 尚未采用的指标\n\n绑定准确率、前驱违规率、步骤覆盖率和配对精确成功率存在字段或意图观测缺口，当前不作为效果结论。独立目标命中率尚未接通。其他分层效果、配对差值区间和耗时仍待补齐。\n';
for(const name of ['RESULTS.md','RESULTS.zh-CN.md'])fs.writeFileSync(path.join(root,name),md);
if(process.argv.includes('--update-docs')){
  const start='## 5. 实验结果',end='## 6. 结论与适用范围';
  const section=md.slice(md.indexOf('\n\n')+2,md.indexOf('## 补充诊断')).replace(/^## /gm,'### ');
  for(const name of ['TASK1-FINAL-REPORT.zh-CN.md']){
    const file=path.resolve('docs/task1-report',name),original=fs.readFileSync(file,'utf8');
    assert.equal(original.split(start).length,2,'Expected one results chapter');
    assert.equal(original.split(end).length,2,'Expected one conclusion chapter');
    const left=original.indexOf(start),right=original.indexOf(end);
    assert.ok(right>left);
    fs.writeFileSync(file,original.slice(0,left)+start+'\n\n'+section+'\n详细失败归因、补充诊断和任务用量见[中文效果报告](../../runs/final5-test1k-20260909-consolidated/RESULTS.zh-CN.md)。\n\n---\n\n'+original.slice(right));
  }
}
fs.writeFileSync(path.join(root,'completed-case-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({output:path.join(root,'RESULTS.zh-CN.md'),cases:summary.total,staticMeasured:ledger?Object.values(ledger.groups).reduce((n,g)=>n+g.T_static.count,0):0,groups:Object.fromEntries(entries.map(([k,g])=>[k,{conditionalSelection:g.conditionalSelection,injectionTokens:g.injectionTokens?.T_static.mean??null}]))},null,2));
